/**
 * Unified Search Service
 * Orchestrates metadata from TMDB and links from Moviesda
 */

import { searchTMDBMovie, getTMDBMovieDetails } from './tmdb.js';
import { searchMoviesDirect, getMovieDownloadLinks, cleanTitle, getQuickPoster } from './scraper.js';
import { searchMovies, insertMovie, getUnifiedMovie, insertUnifiedMovie } from './database.js';
import logger from '../utils/logger.js';

const TMDB_GENRES = {
    28: 'Action', 12: 'Adventure', 16: 'Animation', 35: 'Comedy', 80: 'Crime',
    99: 'Documentary', 18: 'Drama', 10751: 'Family', 14: 'Fantasy', 36: 'History',
    27: 'Horror', 10402: 'Music', 9648: 'Mystery', 10749: 'Romance', 878: 'Sci-Fi',
    10770: 'TV Movie', 53: 'Thriller', 10752: 'War', 37: 'Western',
    10759: 'Action & Adventure', 10762: 'Kids', 10763: 'News', 10764: 'Reality',
    10765: 'Sci-Fi & Fantasy', 10766: 'Soap', 10767: 'Talk', 10768: 'War & Politics'
};

/**
 * Perform a unified search for a movie
 * @param {string} query - Movie title
 * @returns {Promise<Object>} Unified search results
 */
export async function performUnifiedSearch(query) {
    logger.info(`Starting deterministic unified search for: ${query}`);

    try {
        // 1. Search TMDB first (Metadata Authority)
        const isSeries = query.toLowerCase().includes('season') ||
            query.toLowerCase().includes('web series') ||
            query.toLowerCase().includes('episode');

        const tmdbMetadata = await searchTMDBMovie(query, 'Unknown', isSeries ? 'series' : 'movie');

        // 2. Normalize title and year for Moviesda search
        const searchTitle = tmdbMetadata ? tmdbMetadata.title : query;
        const searchYear = tmdbMetadata ? tmdbMetadata.year : 'Unknown';

        // Check Cache first for EXACT deterministic result
        const cached = await getUnifiedMovie(searchTitle, searchYear);
        if (cached && cached.downloads && cached.downloads.length > 0) {
            logger.info(`Deterministic cache hit for: ${searchTitle} (${searchYear})`);
            return {
                query,
                found: true,
                source: { metadata: cached.details?.metadata_source || 'cache', links: 'cache' },
                movie: {
                    title: cached.title,
                    year: cached.year,
                    url: cached.url || '',
                    rating: cached.rating,
                    poster: cached.poster_url,
                    backdrop: cached.backdrop_url,
                    overview: cached.overview,
                    details: cached.details,
                    downloads: cached.downloads
                }
            };
        }

        logger.debug(`Unified Search: Searching Moviesda for links only`);

        // 3. Search Moviesda for technical links
        let moviesdaResults = await searchMovies(searchTitle);
        if (moviesdaResults.length === 0) {
            moviesdaResults = await searchMoviesDirect(searchTitle);
        }

        // 4. Find best match on Moviesda (Strictly for links)
        let bestMatch = null;
        if (moviesdaResults.length > 0) {
            if (tmdbMetadata) {
                bestMatch = moviesdaResults.find(m => {
                    const mYear = m.year || '';
                    const titleMatch = m.title.toLowerCase().includes(tmdbMetadata.title.toLowerCase()) ||
                        tmdbMetadata.title.toLowerCase().includes(m.title.toLowerCase());
                    const yearMatch = (mYear === tmdbMetadata.year || mYear === 'Unknown');
                    return titleMatch && yearMatch;
                });
            }
            if (!bestMatch) bestMatch = moviesdaResults[0];
        }

        // 5. Build Unified Response (Metadata-First Decision logic)
        let unifiedMovie = null;

        if (bestMatch || tmdbMetadata) {
            // Get download links from Moviesda if match found
            if (bestMatch && (!bestMatch.resolutions || bestMatch.resolutions.length === 0)) {
                const fullDetails = await getMovieDownloadLinks(bestMatch.url, query);
                if (fullDetails) {
                    bestMatch = { ...bestMatch, ...fullDetails };
                }
            }

            // ✅ SMART HYBRID VALIDATION - Pick best source for EACH field independently
            const tmdbHasPoster = tmdbMetadata && tmdbMetadata.poster;
            const tmdbHasOverview = tmdbMetadata && tmdbMetadata.overview &&
                tmdbMetadata.overview.trim().length > 30;

            // Determine poster source (priority: TMDB > Moviesda > placeholder)
            let finalPoster = null;
            let posterFrom = 'none';

            if (tmdbHasPoster) {
                finalPoster = tmdbMetadata.poster;
                posterFrom = 'tmdb';
            } else {
                // FALLBACK: Try to get poster from Moviesda if TMDB failed
                const moviesdaPoster = bestMatch?.poster_url || (bestMatch?.url ? await getQuickPoster(bestMatch.url) : null);
                if (moviesdaPoster) {
                    finalPoster = moviesdaPoster;
                    posterFrom = 'moviesda';
                } else {
                    posterFrom = 'placeholder';
                }
            }

            // Determine overview source (priority: TMDB > Moviesda > Placeholder)
            let finalOverview = null;
            let overviewFrom = 'none';

            if (tmdbHasOverview) {
                finalOverview = tmdbMetadata.overview;
                overviewFrom = 'tmdb';
            } else if (bestMatch?.synopsis) {
                finalOverview = bestMatch.synopsis;
                overviewFrom = 'moviesda';
            } else if (tmdbMetadata?.overview) {
                // Fallback to TMDB even if short, if Moviesda has nothing
                finalOverview = tmdbMetadata.overview;
                overviewFrom = 'tmdb';
            } else {
                finalOverview = 'Description not available.';
                overviewFrom = 'placeholder';
            }

            // Final source is determined by poster source (poster is primary)
            const metadataSource = posterFrom;

            const finalGenres = tmdbMetadata ?
                (tmdbMetadata.genres || []).map(id => TMDB_GENRES[id]).filter(Boolean).join(', ') :
                (bestMatch?.genres || '');

            unifiedMovie = {
                title: tmdbHasPoster ? tmdbMetadata.title : (bestMatch?.title || query),
                year: tmdbHasPoster ? tmdbMetadata.year : (bestMatch?.year !== 'Unknown' ? bestMatch?.year : null),
                url: bestMatch?.url || '', // ✅ CRITICAL: Top-level URL for Flutter detaill page
                rating: tmdbHasPoster ? tmdbMetadata.rating : (bestMatch?.rating || null),
                poster: finalPoster,
                backdrop: tmdbHasPoster ? tmdbMetadata.backdrop : null,
                overview: finalOverview,
                type: bestMatch?.type || 'movie',
                details: {
                    director: tmdbMetadata?.director || bestMatch?.director,
                    starring: tmdbMetadata?.cast || bestMatch?.starring,
                    genres: finalGenres,
                    quality: bestMatch?.quality,
                    source_url: bestMatch?.url,
                    tmdb_id: tmdbMetadata?.tmdb_id || null,
                    metadata_source: metadataSource,
                    poster_from: posterFrom,
                    overview_from: overviewFrom
                },
                // Explicit metadata tracking for Flutter
                metadata: {
                    poster_from: posterFrom,
                    overview_from: overviewFrom,
                    source: metadataSource
                },
                downloads: (bestMatch?.resolutions || []).map(r => ({
                    name: r.name,
                    quality: r.quality,
                    size: r.size || 'Unknown',
                    season: r.season,
                    episode: r.episode,
                    link: r.downloadUrl,
                    direct_link: r.directUrl,
                    watch_link: r.watchUrl,
                    stream_source: r.streamSource
                }))
            };
        }

        // 6. Cache the FINAL decision
        if (unifiedMovie) {
            await insertUnifiedMovie(unifiedMovie);
        }

        return {
            query,
            found: !!unifiedMovie,
            source: unifiedMovie?.details?.metadata_source || 'none',
            movie: unifiedMovie
        };

    } catch (error) {
        logger.error(`Unified search failed for "${query}":`, error.message);
        throw error;
    }
}

/**
 * Enrich a single movie object with TMDB metadata (Deterministic)
 * Priority order:
 * 1️⃣ TMDB (if poster + overview available with length > 30)
 * 2️⃣ Moviesda (only if TMDB missing/incomplete)
 * 3️⃣ Placeholder (last fallback)
 *
 * @param {Object} movie - Movie object to enrich
 * @returns {Promise<Object>} Enriched movie
 */
export async function enrichMovie(movie) {
    if (!movie) return null;

    try {
        // 1. Determine if this is a series
        const isSeries = movie.type === 'series' ||
            movie.url.includes('web-series') ||
            movie.title.toLowerCase().includes('season') ||
            movie.title.toLowerCase().includes('episode');

        // 2. Fetch TMDB metadata (passing series type)
        const tmdb = await searchTMDBMovie(movie.title, movie.year, isSeries ? 'series' : 'movie');

        // 🔍 DEBUG LOGGING
        logger.debug(`[ENRICH] "${movie.title}" (${movie.year || 'no year'}) - Series: ${isSeries}`);
        if (tmdb) {
            logger.debug(`  → TMDB: poster=${!!tmdb.poster}, overview=${tmdb.overview?.length || 0} chars`);
        } else {
            logger.debug(`  → TMDB: NOT FOUND`);
        }

        // ✅ SMART HYBRID VALIDATION - Pick best source for EACH field independently
        const tmdbHasPoster = tmdb && tmdb.poster;
        const tmdbHasOverview = tmdb && tmdb.overview && tmdb.overview.trim().length > 30;

        // Decision logic: Pick best poster
        let finalPoster = null;
        let posterSource = 'none';

        if (tmdbHasPoster) {
            finalPoster = tmdb.poster;
            posterSource = 'tmdb';
        } else {
            // FALLBACK: Try existing movie poster, then scrape if missing
            const existingPoster = movie.poster_url || movie.poster;
            if (existingPoster && !existingPoster.includes('placeholder') && !existingPoster.includes('folder')) {
                finalPoster = existingPoster;
                posterSource = 'moviesda';
            } else {
                const scrapedPoster = await getQuickPoster(movie.url);
                if (scrapedPoster) {
                    finalPoster = scrapedPoster;
                    posterSource = 'moviesda';
                } else {
                    finalPoster = null;
                    posterSource = 'placeholder';
                }
            }
        }

        // Determine overview source (priority: TMDB > Moviesda > Placeholder)
        let finalOverview = null;
        let overviewSource = 'none';

        if (tmdbHasOverview) {
            finalOverview = tmdb.overview;
            overviewSource = 'tmdb';
        } else if (movie.synopsis || movie.description) {
            finalOverview = movie.synopsis || movie.description;
            overviewSource = 'moviesda';
        } else if (tmdb?.overview) {
            finalOverview = tmdb.overview;
            overviewSource = 'tmdb';
        } else {
            finalOverview = 'Description not available.';
            overviewSource = 'placeholder';
        }

        // Final source is determined by poster source (primary badge)
        const metadataSource = posterSource;

        logger.debug(`  → Result: poster=${posterSource}, overview=${overviewSource}, source=${metadataSource}`);

        // Build enriched movie object
        const genreNames = tmdb ?
            (tmdb.genres || []).map(id => TMDB_GENRES[id]).filter(Boolean).join(', ') :
            (movie.genres || movie.genre || '');

        return {
            ...movie,
            // Use TMDB title only if we have valid TMDB data
            title: tmdbHasPoster ? (tmdb.title || movie.title) : movie.title,
            year: tmdbHasPoster ?
                ((tmdb.year && tmdb.year !== 'Unknown') ? tmdb.year : movie.year) :
                movie.year,
            poster_url: finalPoster,
            backdrop_url: tmdbHasPoster ? tmdb.backdrop : (movie.backdrop_url || null),
            rating: tmdbHasPoster ? tmdb.rating : (movie.rating || null),
            synopsis: finalOverview,
            genres: genreNames || movie.genres || movie.genre || '',
            cast: tmdb?.cast || movie.cast || movie.starring,
            tmdb_id: tmdb?.tmdb_id || null,
            source: tmdbHasPoster ? 'tmdb-enriched' : 'moviesda-fallback',
            // Explicit source tracking for debugging and Flutter
            metadata: {
                poster_from: posterSource,
                overview_from: overviewSource,
                source: metadataSource
            }
        };
    } catch (err) {
        logger.error(`Enrichment failed for "${movie.title}":`, err.message);
        return {
            ...movie,
            source: 'moviesda-fallback',
            metadata: {
                poster_from: 'original',
                overview_from: 'original',
                source: 'error-fallback'
            }
        };
    }
}

/**
 * Enrich a list of movies with TMDB metadata
 * @param {Array} movies - List of movies
 * @returns {Promise<Array>} Enriched movies
 */
export async function enrichMovieList(movies) {
    if (!movies || movies.length === 0) return [];

    logger.info(`Deterministic enrichment for ${movies.length} movies...`);

    return Promise.all(movies.map(movie => enrichMovie(movie)));
}
