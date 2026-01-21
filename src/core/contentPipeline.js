/**
 * Content Pipeline - Scrape → Match → Enrich
 * 
 * This is the unified processing pipeline for all content.
 * Same pipeline for any provider - no duplication!
 */

import { createUnifiedContent, TMDBStatus, detectContentType, detectLanguage } from './contentTypes.js';
import { normalizeTitle } from '../matching/normalizeTitle.js';
import { calculateConfidence } from '../matching/confidenceScore.js';
import logger from '../utils/logger.js';

// Lazy import to avoid circular deps
let tmdbService = null;

async function getTMDBService() {
    if (!tmdbService) {
        const module = await import('../services/tmdb/client.js');
        tmdbService = module.default || module;
    }
    return tmdbService;
}

/**
 * Process a single item through the pipeline
 * 
 * Steps:
 * 1. Normalize title
 * 2. Detect content type
 * 3. Match with TMDB
 * 4. Calculate confidence
 * 5. Return unified object
 * 
 * @param {Object} item - Raw scraped item
 * @param {string} providerId - Provider that scraped this
 * @returns {Promise<Object>} Processed item
 */
export async function processItem(item, providerId) {
    // 1. Create unified structure
    const unified = createUnifiedContent(item, providerId);

    // 2. Normalize title for matching
    const normalized = normalizeTitle(item.title);
    unified.normalized_title = normalized;

    // 3. Detect content type
    unified.content_type = detectContentType(item);
    unified.language_type = detectLanguage(item);

    // 4. Try TMDB matching
    try {
        const tmdb = await getTMDBService();
        const type = unified.content_type === 'series' ? 'tv' : 'movie';
        const match = await tmdb.search(normalized, type, unified.year);

        if (match) {
            const tmdbTitle = match.name || match.title;
            unified.tmdb_id = match.id;
            unified.tmdb_status = TMDBStatus.MATCHED;
            unified.confidence_score = calculateConfidence(normalized, tmdbTitle, match, unified.year);

            // Enrich with TMDB data
            unified.title = tmdbTitle || unified.title;
            unified.poster_url = match.poster_path
                ? `https://image.tmdb.org/t/p/w500${match.poster_path}`
                : unified.poster_url;
            unified.backdrop_url = match.backdrop_path
                ? `https://image.tmdb.org/t/p/original${match.backdrop_path}`
                : null;
            unified.rating = match.vote_average || null;
            unified.year = match.release_date?.split('-')[0] || match.first_air_date?.split('-')[0] || unified.year;
            unified.overview = match.overview || unified.synopsis;
            unified.genres = match.genre_ids || [];
        } else {
            unified.tmdb_status = TMDBStatus.PENDING;
        }
    } catch (error) {
        logger.debug(`TMDB match failed for "${item.title}": ${error.message}`);
        unified.tmdb_status = TMDBStatus.FAILED;
    }

    return unified;
}

/**
 * Process a batch of items
 * @param {Array} items - Raw scraped items
 * @param {string} providerId - Provider ID
 * @param {Object} options - Processing options
 * @returns {Promise<Array>} Processed items
 */
export async function processBatch(items, providerId, options = {}) {
    const {
        concurrency = 5,
        matchTMDB = true,
        limit = 100
    } = options;

    const toProcess = items.slice(0, limit);
    const results = [];

    logger.info(`📦 Processing ${toProcess.length} items from ${providerId}`);

    // Process in batches for rate limiting
    for (let i = 0; i < toProcess.length; i += concurrency) {
        const batch = toProcess.slice(i, i + concurrency);

        const batchResults = await Promise.all(
            batch.map(item => processItem(item, providerId))
        );

        results.push(...batchResults);

        // Progress log
        if ((i + concurrency) % 20 === 0) {
            logger.debug(`📦 Processed ${Math.min(i + concurrency, toProcess.length)}/${toProcess.length}`);
        }
    }

    // Summary stats
    const matched = results.filter(r => r.tmdb_status === TMDBStatus.MATCHED).length;
    const pending = results.filter(r => r.tmdb_status === TMDBStatus.PENDING).length;

    logger.info(`📦 Complete: ${matched} matched, ${pending} pending, ${results.length - matched - pending} failed`);

    return results;
}

/**
 * Enrich an item with additional TMDB details (cast, crew, trailer)
 * @param {Object} item - Item to enrich
 * @returns {Promise<Object>} Enriched item
 */
export async function enrichWithTMDBDetails(item) {
    if (!item.tmdb_id) {
        return item;
    }

    try {
        const tmdb = await getTMDBService();
        const type = item.content_type === 'series' ? 'tv' : 'movie';
        const details = await tmdb.getDetails(item.tmdb_id, type);

        if (details) {
            return {
                ...item,
                runtime: details.runtime || details.episode_run_time?.[0],
                genres: details.genres?.map(g => g.name) || item.genres,
                cast: details.credits?.cast?.slice(0, 10).map(c => ({
                    name: c.name,
                    character: c.character,
                    profile_path: c.profile_path
                        ? `https://image.tmdb.org/t/p/w185${c.profile_path}`
                        : null
                })) || [],
                director: details.credits?.crew?.find(c => c.job === 'Director')?.name,
                trailer_key: details.videos?.results?.find(v => v.type === 'Trailer')?.key,
                production_companies: details.production_companies?.map(c => c.name) || [],
                overview: details.overview || item.overview
            };
        }
    } catch (error) {
        logger.debug(`Failed to enrich ${item.title}: ${error.message}`);
    }

    return item;
}

/**
 * Quick enrich for poster/rating only (fast path)
 * @param {Object} item - Item to enrich
 * @param {Function} fallbackPosterFn - Fallback function to get poster from page
 * @returns {Promise<Object>} Enriched item
 */
export async function quickEnrich(item, fallbackPosterFn = null) {
    // Already has good data?
    if (item.poster_url && item.rating && !item.poster_url.includes('folder')) {
        return item;
    }

    // Try TMDB quick match
    if (!item.tmdb_id) {
        try {
            const tmdb = await getTMDBService();
            const normalized = normalizeTitle(item.title);

            // Detect type for search
            const typeValue = detectContentType(item);
            const type = (typeValue === 'series' || typeValue === 'webseries') ? 'tv' : 'movie';

            const match = await tmdb.search(normalized, type, item.year);

            if (match) {
                item.tmdb_id = match.id;
                item.poster_url = match.poster_path
                    ? `https://image.tmdb.org/t/p/w500${match.poster_path}`
                    : item.poster_url;
                item.rating = match.vote_average || item.rating;
            }
        } catch {
            // Silent fail
        }
    }

    // Fallback to page scraping for poster
    if ((!item.poster_url || item.poster_url.includes('folder')) && fallbackPosterFn) {
        try {
            logger.debug(`🎨 Fallback poster scrape for: ${item.title}`);
            const poster = await fallbackPosterFn(item.url);
            if (poster) {
                logger.debug(`🎨 Found poster via fallback: ${poster}`);
                item.poster_url = poster;
            } else {
                logger.debug(`🎨 No poster found on page: ${item.url}`);
            }
        } catch (err) {
            logger.debug(`🎨 Fallback poster scrape failed: ${err.message}`);
        }
    }

    return item;
}

export default {
    processItem,
    processBatch,
    enrichWithTMDBDetails,
    quickEnrich
};
