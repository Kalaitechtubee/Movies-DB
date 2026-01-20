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
        // 1. Fetch metadata from TMDB first (Deterministic Selection)
        const tmdbMetadata = await searchTMDBMovie(query);

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
                    await insertMovie(bestMatch);
                }
            }

            // DECISION: Final resolved fields
            const finalPoster = tmdbMetadata?.poster || (bestMatch?.poster_url || null);
            const posterFrom = tmdbMetadata?.poster ? 'tmdb' : (bestMatch?.poster_url ? 'moviesda' : 'none');

            const finalOverview = tmdbMetadata?.overview || (bestMatch?.synopsis || null);
            const overviewFrom = tmdbMetadata?.overview ? 'tmdb' : (bestMatch?.synopsis ? 'moviesda' : 'none');

            const finalGenres = tmdbMetadata ?
                (tmdbMetadata.genres || []).map(id => TMDB_GENRES[id]).filter(Boolean).join(', ') :
                (bestMatch?.genres || '');

            unifiedMovie = {
                title: tmdbMetadata ? tmdbMetadata.title : bestMatch.title,
                year: tmdbMetadata ? tmdbMetadata.year : (bestMatch.year !== 'Unknown' ? bestMatch.year : null),
                rating: tmdbMetadata ? tmdbMetadata.rating : bestMatch.rating,
                poster: finalPoster,
                backdrop: tmdbMetadata?.backdrop || null,
                overview: finalOverview,
                type: bestMatch?.type || (tmdbMetadata ? 'movie' : 'movie'),
                details: {
                    director: tmdbMetadata?.director || bestMatch?.director,
                    starring: tmdbMetadata?.cast || bestMatch?.starring,
                    genres: finalGenres,
                    quality: bestMatch?.quality,
                    source_url: bestMatch?.url,
                    tmdb_id: tmdbMetadata?.tmdb_id,
                    metadata_source: tmdbMetadata ? 'tmdb' : 'moviesda',
                    poster_from: posterFrom,
                    overview_from: overviewFrom
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
 * @param {Object} movie - Movie object to enrich
 * @returns {Promise<Object>} Enriched movie
 */
export async function enrichMovie(movie) {
    if (!movie) return null;

    try {
        // Deterministic check: Priority 1 - TMDB
        const tmdb = await searchTMDBMovie(movie.title, movie.year);

        if (tmdb) {
            const genreNames = (tmdb.genres || [])
                .map(id => TMDB_GENRES[id])
                .filter(Boolean)
                .join(', ');

            return {
                ...movie,
                title: tmdb.title || movie.title,
                year: (tmdb.year && tmdb.year !== 'Unknown') ? tmdb.year : movie.year,
                poster_url: tmdb.poster || movie.poster_url,
                backdrop_url: tmdb.backdrop || movie.backdrop_url,
                rating: tmdb.rating || movie.rating,
                synopsis: tmdb.overview || movie.synopsis || movie.description,
                genres: genreNames || movie.genres || movie.genre,
                cast: tmdb.cast || movie.cast || movie.starring,
                director: tmdb.director || movie.director,
                tmdb_id: tmdb.tmdb_id,
                source: 'tmdb-enriched'
            };
        }

        // Priority 2: Fallback to Moviesda meta-tags (if missing, scraper might have it)
        if (!movie.poster_url || movie.poster_url.includes('folder')) {
            const quickPoster = await getQuickPoster(movie.url);
            if (quickPoster) {
                return {
                    ...movie,
                    poster_url: quickPoster,
                    source: 'moviesda-fallback'
                };
            }
        }

        return movie;
    } catch (err) {
        logger.error(`Enrichment failed for "${movie.title}":`, err.message);
        return movie;
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
