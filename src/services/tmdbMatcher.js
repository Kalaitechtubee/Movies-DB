/**
 * PRODUCTION-LEVEL: Tamil-Aware TMDB + Moviesda Matching System
 * 
 * Features:
 * ✅ Confidence-based matching (min score: 60)
 * ✅ Tamil + Tamil-Dubbed detection
 * ✅ Only list Moviesda-available movies
 * ✅ Correct trailer selection (Tamil first)
 * ✅ Duplicate prevention via tmdb_id
 * ✅ Language-smart TMDB search
 */

import axios from 'axios';
import logger from '../utils/logger.js';
import { insertUnifiedMovie, getUnifiedMovieByTMDBId } from './database.js';
import { TMDB_API_KEY } from '../config.js';

const TMDB_BASE_URL = 'https://api.themoviedb.org/3';

// ============================================================================
// 1️⃣ NORMALIZATION & DETECTION
// ============================================================================

/**
 * Normalize title for accurate matching
 * Removes: brackets, language tags, quality info, year
 */
function normalizeTitle(title) {
  if (!title) return '';

  return title
    .toLowerCase()
    .replace(/\(.*?\)/g, '')                    // remove (year), (Season), etc
    .replace(/\[.*?\]/g, '')                    // remove [Tamil], [Dub]
    .replace(/isaidub|moviesda|isaimini|tamilgun|tamilrockers/gi, '') // site names
    .replace(/tamil|dubbed|movie|hdrip|webrip|bluray|dvdrip|web|series/gi, '') // metadata
    .replace(/part\s*\d+/gi, '')                // remove Part 1, Part 2
    .replace(/season\s*\d+/gi, '')              // remove Season 01
    .replace(/original\s*content/gi, '')        // remove Original Content
    .replace(/[^a-z0-9\s]/g, '')                // remove special chars
    .replace(/\s+/g, ' ')                       // normalize spaces
    .trim();
}

/**
 * Extract 4-digit year from any string
 */
function extractYear(text) {
  const match = text.match(/\b(19|20)\d{2}\b/);
  return match ? match[0] : null;
}

/**
 * Detect if content is Tamil-Dubbed
 * Tamil movies: original_language === 'ta'
 * Tamil Dub: original_language !== 'ta' but tagged as dubbed
 */
function detectLanguageType(title, tmdbLanguage) {
  const isDubbed = /dub|dubbed|tamil\s*dub/i.test(title);

  if (tmdbLanguage === 'ta') {
    return 'tamil';                    // Original Tamil
  } else if (isDubbed) {
    return 'tamil_dubbed';             // Tamil Dubbed
  }

  return 'unknown';
}

// ============================================================================
// 2️⃣ TMDB SEARCH (Language-Smart)
// ============================================================================

async function searchTMDBWithFallback(query, year = null, isSeries = false) {
  const cleanQuery = normalizeTitle(query);

  if (!cleanQuery) {
    logger.warn('Empty query after normalization');
    return [];
  }

  const type = isSeries ? 'tv' : 'movie';
  logger.debug(`TMDB search (${type}) - Original: "${query}", Clean: "${cleanQuery}", Year: ${year}`);

  try {
    const searches = [];

    // 1️⃣ Try English search with year (Prioritize for Latin titles)
    searches.push(
      tmdbSearchByLanguage(cleanQuery, year, 'en', type)
        .catch(e => {
          logger.debug(`English (en) ${type} search failed: ${e.message}`);
          return [];
        })
    );

    // 2️⃣ Try English search without year
    if (year) {
      searches.push(
        tmdbSearchByLanguage(cleanQuery, null, 'en', type)
          .catch(e => [])
      );
    }

    // 3️⃣ Try Tamil search with year
    searches.push(
      tmdbSearchByLanguage(cleanQuery, year, 'ta', type)
        .catch(e => {
          logger.debug(`Tamil (ta) ${type} search failed: ${e.message}`);
          return [];
        })
    );

    // 4️⃣ Try Tamil search without year
    if (year) {
      searches.push(
        tmdbSearchByLanguage(cleanQuery, null, 'ta', type)
          .catch(e => [])
      );
    }

    // Fallback: If no results for series, maybe it's listed as movie (or vice versa)
    const results = await Promise.all(searches);
    let flattened = results.flat();

    if (flattened.length === 0) {
      logger.debug(`No results for ${type}, trying fallback type...`);
      const fallbackType = isSeries ? 'movie' : 'tv';
      const fallbackResults = await tmdbSearchByLanguage(cleanQuery, year, 'en', fallbackType).catch(e => []);
      flattened = fallbackResults;
    }

    // Flatten & deduplicate by TMDB ID
    const uniqueMap = new Map();
    flattened.forEach(item => {
      if (item.id && !uniqueMap.has(item.id)) {
        uniqueMap.set(item.id, item);
      }
    });

    return Array.from(uniqueMap.values());

  } catch (error) {
    logger.error(`TMDB search error for "${query}":`, error.message);
    return [];
  }
}

/**
 * TMDB search for specific language
 */
async function tmdbSearchByLanguage(query, year, language, type = 'movie') {
  const endpoint = type === 'tv' ? 'search/tv' : 'search/movie';
  const yearParam = type === 'tv' ? 'first_air_date_year' : 'year';

  let url = `${TMDB_BASE_URL}/${endpoint}?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(query)}&language=${language}&include_adult=false`;

  if (year && /^\d{4}$/.test(year)) {
    url += `&${yearParam}=${year}`;
  }

  const response = await axios.get(url, { timeout: 5000 });
  return response.data.results || [];
}

// ============================================================================
// 3️⃣ CONFIDENCE SCORING (THE CORE ALGORITHM)
// ============================================================================

/**
 * Calculate confidence score for TMDB movie match
 * 
 * Score breakdown:
 * - Title similarity: 40 points
 * - Year match: 25 points
 * - Language (Tamil): 20 points
 * - Language (Tamil Dubbed): 15 points
 * - Popularity: 5 bonus points
 * 
 * Minimum confidence: 60 points (strict filter)
 */
function calculateScore(tmdbMovie, moviesdbTitle, moviesdbYear, languageType) {
  let score = 0;

  const tmdbTitle = normalizeTitle(tmdbMovie.title || tmdbMovie.original_title);
  const cleanMoviesdbTitle = normalizeTitle(moviesdbTitle);

  // 1️⃣ Title Similarity (40 points max)
  let titleScore = 0;
  if (tmdbTitle && cleanMoviesdbTitle) {
    if (tmdbTitle === cleanMoviesdbTitle) {
      titleScore = 40;  // Perfect match
    } else if (tmdbTitle.includes(cleanMoviesdbTitle) || cleanMoviesdbTitle.includes(tmdbTitle)) {
      titleScore = 30;  // Substring match
    } else {
      const sim = calculateTitleSimilarity(tmdbTitle, cleanMoviesdbTitle);
      if (sim > 0.8) titleScore = 25;
      else if (sim > 0.6) titleScore = 15;
    }
  } else if (!tmdbTitle && cleanMoviesdbTitle) {
    // If TMDB title is empty after normalization (common for regional scripts)
    // We give a mid-range score (20) if it's the right language context
    titleScore = 20;
  }
  score += titleScore;

  // 2️⃣ Year Match (25 points)
  if (moviesdbYear) {
    const tmdbYear = (tmdbMovie.release_date || tmdbMovie.first_air_date)?.split('-')[0];
    if (tmdbYear === moviesdbYear) {
      score += 25;  // Exact year match
    } else if (tmdbYear && Math.abs(parseInt(tmdbYear) - parseInt(moviesdbYear)) === 1) {
      score += 12;  // Off by one year (common case)
    }
  } else {
    score += 5;    // No year info = slight boost for having TMDB data
  }

  // 3️⃣ Language Detection (20-15 points)
  const isSouthIndian = ['ta', 'te', 'ml', 'kn'].includes(tmdbMovie.original_language);

  if (tmdbMovie.original_language === 'ta') {
    score += 20;   // Original Tamil movie
  } else if (isSouthIndian) {
    score += 12;   // Other South Indian regional (often correct on Moviesda)
  } else if (languageType === 'tamil_dubbed') {
    score += 15;   // Explicitly tagged as Tamil-dubbed
  }

  // 4️⃣ Popularity Bonus (5 points max)
  if (tmdbMovie.vote_count > 100) {
    score += 5;    // Popular movie = more trustworthy
  }

  // 4.5️⃣ Recent Release Bonus
  const currentYear = new Date().getFullYear();
  const tmdbYearNum = parseInt((tmdbMovie.release_date || tmdbMovie.first_air_date)?.split('-')[0]);
  if (tmdbYearNum >= currentYear - 1) {
    score += 5;    // Give +5 for current/previous year movies (likely what user is looking for)
  }

  // 5️⃣ Vote average consideration (slight boost)
  if (tmdbMovie.vote_average > 6.0) {
    score += 2;
  }

  logger.debug(
    `Score for "${cleanMoviesdbTitle}" vs "${tmdbTitle}": ${score} ` +
    `(lang: ${tmdbMovie.original_language}, type: ${languageType})`
  );

  return score;
}

/**
 * Simple string similarity ratio (0-1)
 * Using Levenshtein-like comparison
 */
function calculateTitleSimilarity(str1, str2) {
  if (!str1 || !str2) return 0;
  if (str1 === str2) return 1;

  const s1 = str1.split(' ');
  const s2 = str2.split(' ');

  // Count how many words in s1 are in s2
  let matches = 0;
  s1.forEach(word => {
    if (word && s2.includes(word)) matches++;
  });

  const wordSimilarity = matches / Math.max(s1.length, s2.length);

  // Character level fallback for single-word titles
  if (s1.length === 1 && s2.length === 1) {
    const len = Math.max(str1.length, str2.length);
    let charMatches = 0;
    for (let i = 0; i < Math.min(str1.length, str2.length); i++) {
      if (str1[i] === str2[i]) charMatches++;
    }
    return Math.max(wordSimilarity, charMatches / len);
  }

  return wordSimilarity;
}

/**
 * Select best TMDB match with confidence threshold
 * Minimum score: 60 (strict to avoid wrong matches)
 */
function selectBestMatch(tmdbResults, moviesdbTitle, moviesdbYear, languageType) {
  const scored = tmdbResults.map(movie => {
    let score = calculateScore(movie, moviesdbTitle, moviesdbYear, languageType);

    // Bonus: If it's the ONLY result and it's a regional movie that matches the year
    if (tmdbResults.length === 1 && moviesdbYear) {
      const tmdbYear = (movie.release_date || movie.first_air_date)?.split('-')[0];
      if (tmdbYear === moviesdbYear) {
        score += 15; // Significant boost for unique year-match
        logger.debug(`Sole result bonus (+15) applied for "${moviesdbTitle}"`);
      }
    }

    return { ...movie, confidenceScore: score };
  });

  // Sort by score descending
  const sorted = scored.sort((a, b) => b.confidenceScore - a.confidenceScore);

  // Filter minimum confidence threshold
  const qualified = sorted.filter(m => m.confidenceScore >= 60);

  if (qualified.length === 0) {
    logger.warn(
      `No TMDB match with confidence >= 60 for "${moviesdbTitle}" (${moviesdbYear}). ` +
      `Best score: ${sorted[0]?.confidenceScore || 0}`
    );
    return null;
  }

  logger.info(
    `✅ Selected TMDB match for "${moviesdbTitle}": "${qualified[0].title}" ` +
    `(score: ${qualified[0].confidenceScore})`
  );

  return qualified[0];
}

// ============================================================================
// 4️⃣ TMDB DETAILS FETCHING
// ============================================================================

/**
 * Get full movie details from TMDB including trailers, cast, etc
 */
async function getTMDBFullDetails(tmdbId, type = 'movie') {
  try {
    const endpoint = type === 'tv' ? 'tv' : 'movie';
    const url = `${TMDB_BASE_URL}/${endpoint}/${tmdbId}?api_key=${TMDB_API_KEY}&language=ta&append_to_response=credits,videos`;

    const response = await axios.get(url, { timeout: 5000 });
    const data = response.data;

    return {
      tmdb_id: data.id,
      title: data.title || data.name,
      year: (data.release_date || data.first_air_date)?.split('-')[0] || 'Unknown',
      rating: data.vote_average ? data.vote_average.toFixed(1) : '0',
      poster: data.poster_path ? `https://image.tmdb.org/t/p/w500${data.poster_path}` : null,
      backdrop: data.backdrop_path ? `https://image.tmdb.org/t/p/original${data.backdrop_path}` : null,
      overview: data.overview || 'No description available',
      genres: data.genres ? data.genres.map(g => g.name).join(', ') : '',
      runtime: data.runtime || null,
      director: data.credits?.crew?.find(c => c.job === 'Director')?.name || null,
      cast: data.credits?.cast?.slice(0, 10).map(c => ({
        name: c.name,
        image: c.profile_path ? `https://image.tmdb.org/t/p/w200${c.profile_path}` : null,
        character: c.character
      })) || [],
      trailer: selectTrailer(data.videos?.results || []),
      original_language: data.original_language
    };
  } catch (error) {
    logger.error(`Failed to fetch TMDB details for ID ${tmdbId}:`, error.message);
    return null;
  }
}

/**
 * Select best trailer: Tamil first, then English, then first available
 */
function selectTrailer(videos) {
  if (!videos || videos.length === 0) return null;

  // 1️⃣ Prefer Tamil trailer
  const tamil = videos.find(
    v => v.type === 'Trailer' && v.iso_639_1 === 'ta' && v.site === 'YouTube'
  );
  if (tamil) {
    logger.debug(`✅ Selected Tamil trailer: ${tamil.key}`);
    return tamil.key;
  }

  // 2️⃣ Fallback to English trailer
  const english = videos.find(
    v => v.type === 'Trailer' && v.iso_639_1 === 'en' && v.site === 'YouTube'
  );
  if (english) {
    logger.debug(`✅ Selected English trailer: ${english.key}`);
    return english.key;
  }

  // 3️⃣ Any trailer
  const any = videos.find(v => v.type === 'Trailer' && v.site === 'YouTube');
  if (any) {
    logger.debug(`✅ Selected generic trailer: ${any.key}`);
    return any.key;
  }

  return null;
}

// ============================================================================
// 5️⃣ MAIN MATCHING ENGINE
// ============================================================================

/**
 * Match Moviesda movie with TMDB
 * 
 * Returns unified movie object ONLY if:
 * ✅ TMDB match found with confidence >= 60
 * ✅ Moviesda links are provided
 * 
 * Returns null if no confident match
 */
export async function matchMoviesdbWithTMDB(moviesdbMovie, moviesdbLinks = []) {
  logger.info(`🔍 Matching Moviesda: "${moviesdbMovie.title}" (${moviesdbMovie.year})`);

  // 1️⃣ Validate input
  if (!moviesdbMovie.title) {
    logger.warn('❌ Missing title - skipping match');
    return null;
  }

  // 2️⃣ Detect series type
  const isSeries = moviesdbMovie.title.toLowerCase().includes('web series') ||
    moviesdbMovie.title.toLowerCase().includes('webseries') ||
    moviesdbMovie.source === 'webseries';

  // 3️⃣ Detect language type (Tamil vs Tamil Dubbed)
  const languageType = detectLanguageType(moviesdbMovie.title, 'unknown');

  // 3.5️⃣ Enhance year detection (use title if year is missing or Unknown)
  let bestYear = moviesdbMovie.year;
  if (!bestYear || bestYear === 'Unknown') {
    bestYear = extractYear(moviesdbMovie.title);
    if (bestYear) {
      logger.debug(`Extracted year from title: ${bestYear}`);
    }
  }

  logger.debug(`Language type detected: ${languageType}, Series: ${isSeries}, Year: ${bestYear}`);

  // 4️⃣ Search TMDB with language fallback
  const tmdbResults = await searchTMDBWithFallback(
    moviesdbMovie.title,
    bestYear,
    isSeries
  );

  if (tmdbResults.length === 0) {
    logger.warn(`❌ No TMDB results found for "${moviesdbMovie.title}"`);
    return null;
  }

  // 4️⃣ Find best match with confidence scoring
  const bestMatch = selectBestMatch(
    tmdbResults,
    moviesdbMovie.title,
    bestYear,
    languageType
  );

  if (!bestMatch) {
    logger.warn(`❌ No confident TMDB match (score < 60) for "${moviesdbMovie.title}"`);
    return null;
  }

  // 5️⃣ Check cache: already have this TMDB movie?
  const cached = await getUnifiedMovieByTMDBId(bestMatch.id);
  if (cached && cached.download_links && cached.download_links.length > 0) {
    logger.info(`📦 Cache hit for TMDB ID ${bestMatch.id}`);
    return cached;
  }

  // 6️⃣ Fetch full TMDB details
  const tmdbType = isSeries ? 'tv' : 'movie';
  const tmdbFull = await getTMDBFullDetails(bestMatch.id, tmdbType);
  if (!tmdbFull) {
    logger.warn(`❌ Failed to fetch TMDB details for ID ${bestMatch.id}`);
    return null;
  }

  // 7️⃣ Build unified movie object
  const unifiedMovie = {
    tmdb_id: bestMatch.id,
    language_type: languageType,
    title: tmdbFull.title,
    year: tmdbFull.year,
    rating: tmdbFull.rating,
    poster_url: tmdbFull.poster,
    backdrop_url: tmdbFull.backdrop,
    overview: tmdbFull.overview,
    genres: tmdbFull.genres,
    runtime: tmdbFull.runtime,
    cast: tmdbFull.cast,
    director: tmdbFull.director,
    trailer_key: tmdbFull.trailer,
    watch_links: moviesdbLinks
      .filter(link => link.watchUrl || link.watch_link)
      .map(link => ({
        quality: link.quality || 'Unknown',
        url: link.watchUrl || link.watch_link
      })),
    download_links: moviesdbLinks
      .map(link => ({
        quality: link.quality || 'Unknown',
        size: link.size || 'Unknown',
        url: link.downloadUrl || link.link
      }))
      .filter(link => link.url),
    source: 'moviesda',
    confidence_score: bestMatch.confidenceScore || 75,
    updated_at: new Date().toISOString()
  };

  // 8️⃣ Save to database
  try {
    await insertUnifiedMovie(unifiedMovie);
    logger.info(`✅ Saved unified movie: TMDB#${bestMatch.id} - ${tmdbFull.title}`);
  } catch (dbError) {
    logger.error(`DB save error:`, dbError.message);
    // Still return the object even if DB fails
  }

  return unifiedMovie;
}

/**
 * Batch match multiple Moviesda movies with TMDB
 * Only returns movies with successful matches (confidence >= 60)
 */
export async function batchMatchMoviesdbWithTMDB(movies) {
  logger.info(`📦 Batch matching ${movies.length} movies...`);

  const results = [];
  const CONCURRENCY = 3;  // Max 3 parallel TMDB requests to avoid rate limit

  for (let i = 0; i < movies.length; i += CONCURRENCY) {
    const batch = movies.slice(i, i + CONCURRENCY);

    const batchResults = await Promise.all(
      batch.map(movie => matchMoviesdbWithTMDB(movie, movie.links || []))
    );

    // Filter null results (failed matches)
    results.push(...batchResults.filter(m => m !== null));
  }

  logger.info(`✅ Batch matching complete: ${results.length}/${movies.length} matched`);
  return results;
}

/**
 * EXPORT: Process raw Moviesda scrape + Moviesda links → Unified catalog
 */
export async function processMoviesdbCatalog(movies) {
  logger.info(`🎬 Processing Moviesda catalog with ${movies.length} movies...`);

  const unifiedMovies = await batchMatchMoviesdbWithTMDB(movies);

  return {
    total_input: movies.length,
    successful_matches: unifiedMovies.length,
    match_rate: ((unifiedMovies.length / movies.length) * 100).toFixed(1) + '%',
    movies: unifiedMovies
  };
}