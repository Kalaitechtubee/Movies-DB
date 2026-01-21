/**
 * Unified Search Service
 * Orchestrates metadata from TMDB and links from Moviesda
 */

import { searchTMDBMovie, getTMDBMovieDetails } from './tmdb.js';
import { searchMoviesDirect, getMovieDownloadLinks, cleanTitle, getQuickPoster } from './scraper.js';
import {
    searchMovies,
    insertMovie,
    getUnifiedMovie,
    insertUnifiedMovie,
    getUnifiedMovieByTMDBId
} from './database.js';
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
    logger.info(`Starting TMDB-anchored unified search for: ${query}`);

    try {
        // 1. Search Moviesda FIRST (Availability is key)
        let moviesdaResults = await searchMovies(query);
        if (moviesdaResults.length === 0) {
            moviesdaResults = await searchMoviesDirect(query);
        }

        if (moviesdaResults.length === 0) {
            logger.info(`No results found on Moviesda for: ${query}`);
            return { query, found: false, movie: null };
        }

        // 2. Take the most relevant result and find its TMDB ID
        const primaryMatch = moviesdaResults[0];
        const isSeries = primaryMatch.type === 'series' ||
            primaryMatch.url.includes('web-series') ||
            query.toLowerCase().includes('season') ||
            query.toLowerCase().includes('episode');

        // Check cache by title/year first
        const cached = await getUnifiedMovie(primaryMatch.title, primaryMatch.year);
        if (cached && cached.downloads && cached.downloads.length > 0) {
            logger.info(`Unified cache hit for: ${primaryMatch.title} (${primaryMatch.year})`);
            return {
                query,
                found: true,
                movie: {
                    ...cached,
                    poster: cached.poster_url,
                    backdrop: cached.backdrop_url,
                    tmdb_id: cached.tmdb_id || cached.details?.tmdb_id
                }
            };
        }

        // 3. Search TMDB using the CLEAN title from Moviesda
        const tmdbMetadata = await searchTMDBMovie(primaryMatch.title, primaryMatch.year, isSeries ? 'series' : 'movie');

        // 4. If TMDB match found, get FULL details (Trailers, Cast, etc.)
        let fullMetadata = tmdbMetadata;
        if (tmdbMetadata?.tmdb_id) {
            // Check if we have this TMDB ID cached specifically
            const tmdbCached = await getUnifiedMovieByTMDBId(tmdbMetadata.tmdb_id);

            if (tmdbCached) {
                // Merge Moviesda links into cached TMDB entry
                const scraperDetails = await getMovieDownloadLinks(primaryMatch.url, query);
                const updatedMovie = {
                    ...tmdbCached,
                    downloads: scraperDetails?.resolutions?.map(r => ({
                        name: r.name,
                        quality: r.quality,
                        size: r.size || 'Unknown',
                        link: r.downloadUrl,
                        direct_link: r.directUrl,
                        watch_link: r.watchUrl,
                        stream_source: r.streamSource
                    })) || []
                };
                await insertUnifiedMovie(updatedMovie);
                return { query, found: true, movie: updatedMovie };
            }

            // Fetch full details if not cached or to refresh
            const detailed = await getTMDBMovieDetails(tmdbMetadata.tmdb_id, tmdbMetadata.type || (isSeries ? 'series' : 'movie'));
            if (detailed) {
                fullMetadata = { ...tmdbMetadata, ...detailed };
            }
        }

        // 5. Get download links from Moviesda
        const scraperDetails = await getMovieDownloadLinks(primaryMatch.url, query);

        // 6. Assemble Final TMDB-Anchored Movie
        const currentYear = new Date().getFullYear();
        const movieYear = parseInt(fullMetadata?.year || primaryMatch.year);
        let tmdbStatus = 'matched';

        if (!fullMetadata?.tmdb_id) {
            // If it's this year or last year, treat as pending. Older is not_found.
            if (movieYear >= (currentYear - 1) || !movieYear) {
                tmdbStatus = 'pending';
            } else {
                tmdbStatus = 'not_found';
            }
        }

        const unifiedMovie = {
            tmdb_id: fullMetadata?.tmdb_id || null,
            tmdb_status: tmdbStatus, // New explicit status field
            title: fullMetadata?.title || primaryMatch.title,
            year: fullMetadata?.year || primaryMatch.year,
            url: primaryMatch.url,
            rating: fullMetadata?.rating || primaryMatch.rating,
            poster: fullMetadata?.poster || primaryMatch.poster_url || primaryMatch.poster,
            backdrop: fullMetadata?.backdrop || null,
            overview: fullMetadata?.overview || scraperDetails?.synopsis || 'Description not available yet. We are waiting for official metadata release.',
            trailer: fullMetadata?.trailer || null,
            type: primaryMatch.type || (isSeries ? 'series' : 'movie'),
            details: {
                director: fullMetadata?.director || scraperDetails?.director,
                starring: fullMetadata?.cast || scraperDetails?.starring,
                genres: fullMetadata?.genres || scraperDetails?.genres,
                tmdb_id: fullMetadata?.tmdb_id || null,
                tmdb_status: tmdbStatus,
                metadata_source: fullMetadata ? 'tmdb' : 'scraper',
            },
            downloads: (scraperDetails?.resolutions || []).map(r => ({
                name: r.name,
                quality: r.quality,
                size: r.size || 'Unknown',
                link: r.downloadUrl,
                direct_link: r.directUrl,
                watch_link: r.watchUrl,
                stream_source: r.streamSource
            }))
        };

        // 7. Cache the result
        if (unifiedMovie) {
            await insertUnifiedMovie(unifiedMovie);
        }

        return {
            query,
            found: true,
            source: fullMetadata ? 'tmdb' : 'moviesda',
            movie: unifiedMovie
        };

    } catch (error) {
        logger.error(`Unified TMDB search failed for "${query}":`, error.message);
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
        const titleLower = movie.title.toLowerCase();
        const isSeries = movie.type === 'series' ||
            movie.url.includes('web-series') ||
            titleLower.includes('season') ||
            titleLower.includes('episode') ||
            titleLower.includes('web series') ||
            titleLower.includes('original content');

        // 2. Fetch TMDB metadata (passing series type)
        let tmdb = await searchTMDBMovie(movie.title, movie.year, isSeries ? 'series' : 'movie');

        // 3. If TMDB match found, get FULL details (Trailers, Cast, Director)
        if (tmdb?.tmdb_id) {
            const detailed = await getTMDBMovieDetails(tmdb.tmdb_id, tmdb.type || (isSeries ? 'series' : 'movie'));
            if (detailed) {
                tmdb = { ...tmdb, ...detailed };
            }
        }

        // ✅ SMART HYBRID VALIDATION - Pick best source for EACH field independently
        const tmdbHasPoster = tmdb && tmdb.poster;
        const tmdbHasOverview = tmdb && tmdb.overview && tmdb.overview.trim().length > 30;

        // Determine TMDB Status
        const currentYear = new Date().getFullYear();
        const movieYear = parseInt(tmdb?.year || movie.year);
        let tmdbStatus = 'matched';

        if (!tmdb?.tmdb_id) {
            if (movieYear >= currentYear || !movieYear) {
                tmdbStatus = 'pending';
            } else {
                tmdbStatus = 'not_found';
            }
        }

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
            director: tmdb?.director || movie.director,
            trailer: tmdb?.trailer || null,
            tmdb_id: tmdb?.tmdb_id || null,
            tmdb_status: tmdbStatus,
            source: tmdbHasPoster ? 'tmdb-enriched' : 'moviesda-fallback',
            // Explicit source tracking for debugging and Flutter
            metadata: {
                poster_from: posterSource,
                overview_from: overviewSource,
                source: metadataSource,
                tmdb_status: tmdbStatus
            }
        };
    } catch (err) {
        logger.error(`Enrichment failed for "${movie.title}":`, err.message);

        // Determine status even on error
        const currentYear = new Date().getFullYear();
        const movieYear = parseInt(movie.year);
        let tmdbStatus = 'not_found';
        if (movieYear >= (currentYear - 1) || !movieYear) {
            tmdbStatus = 'pending';
        }

        return {
            ...movie,
            tmdb_id: movie.tmdb_id || null,
            tmdb_status: tmdbStatus,
            synopsis: movie.synopsis || movie.description || (tmdbStatus === 'pending'
                ? 'Official metadata pending release. We will update as soon as it becomes available.'
                : 'Description currently unavailable.'),
            source: 'moviesda-fallback',
            metadata: {
                poster_from: 'original',
                overview_from: 'original',
                source: 'error-fallback',
                tmdb_status: tmdbStatus
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
