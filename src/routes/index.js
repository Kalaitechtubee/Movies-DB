/**
 * ROUTES INTEGRATION: Express API endpoints for TMDB-matched catalog
 * 
 * These routes replace old scraper-only endpoints and ensure:
 * ✅ Only Moviesda-available movies
 * ✅ TMDB metadata for all
 * ✅ Proper trailers
 * ✅ No duplicates (tmdb_id is key)
 */

import express from 'express';
import {
    matchMoviesdbWithTMDB,
    batchMatchMoviesdbWithTMDB,
    processMoviesdbCatalog
} from '../services/tmdbMatcher.js';
import {
    getMovieDownloadLinks,
    searchMoviesDirect,
    getLatestUpdates,
    getIsaidubLatest,
    getWebSeriesLatest,
    searchAllDirect,
    getQuickPoster
} from '../services/scraper.js';
import axios from 'axios';
import { REQUEST_HEADERS } from '../config.js';
import {
    getAllMovies,
    getStats,
    searchMovies as searchMoviesDB,
    getAllUnifiedMovies,
    getUnifiedMovieByTMDBId
} from '../services/database.js';
import logger from '../utils/logger.js';
import supabase from '../utils/supabase.js';

/**
 * Shared Enrichment Helper
 * Checks DB -> TMDB -> Page Scrape for posters/rating
 */
async function enrichMovie(movie, index = 0) {
    try {
        // 1. Check local unified database first (fastest)
        const cleanTitleMatch = movie.title.split('(')[0].trim().replace(/\[.*?\]/g, '').trim();
        const { data: cached } = await supabase
            .from('unified_movies')
            .select('poster_url, rating, genres, tmdb_id')
            .ilike('title', `%${cleanTitleMatch}%`)
            .limit(1)
            .maybeSingle();

        if (cached?.poster_url) {
            return {
                ...movie,
                poster: cached.poster_url,
                rating: cached.rating,
                genre: cached.genres,
                tmdb_id: cached.tmdb_id,
                is_verified: true
            };
        }

        // 2. TMDB Matching (only for top items to keep it fast)
        if (index < 12) {
            const matched = await matchMoviesdbWithTMDB(movie, []);
            if (matched && matched.poster_url) {
                return {
                    ...movie,
                    poster: matched.poster_url,
                    rating: matched.rating,
                    tmdb_id: matched.tmdb_id,
                    is_matched: true
                };
            }
        }

        // 3. Page Scrape Fallback (if still no poster)
        if (!movie.poster || movie.poster.includes('folder') || index < 6) {
            const scrapedPoster = await getQuickPoster(movie.url);
            if (scrapedPoster) {
                return { ...movie, poster: scrapedPoster };
            }
        }
    } catch (err) {
        // Silently continue
        logger.debug(`Enrichment failed for ${movie.title}: ${err.message}`);
    }
    return movie;
}

const router = express.Router();

// ============================================================================
// ENDPOINT 1: Search with TMDB Matching
// ============================================================================

/**
 * GET /api/search-unified
 * 
 * Search movies in Moviesda + match with TMDB
 * Returns ONLY movies with confidence >= 60
 * 
 * Query params:
 * - q: search query (required)
 * - language: 'tamil' or 'tamil_dubbed' (optional filter)
 */
router.get('/api/search-unified', async (req, res) => {
    const { q: query, language } = req.query;

    if (!query) {
        return res.status(400).json({
            error: 'Missing query parameter (q)',
            example: '/api/search-unified?q=Jawan&language=tamil_dubbed'
        });
    }

    try {
        logger.info(`🔍 Unified search: "${query}" (language filter: ${language || 'none'})`);

        // 1️⃣ Search Moviesda + isaiDub + Web Series
        const moviesdbResults = await searchAllDirect(query);

        if (moviesdbResults.length === 0) {
            return res.json({
                query,
                found: false,
                results: [],
                message: 'No movies found in Moviesda'
            });
        }

        logger.debug(`Found ${moviesdbResults.length} in Moviesda`);

        // 2️⃣ For each result, get download links
        const moviesWithLinks = await Promise.all(
            moviesdbResults.slice(0, 5).map(async (movie) => {
                try {
                    const details = await getMovieDownloadLinks(movie.url);
                    return {
                        ...movie,
                        links: details?.resolutions || []
                    };
                } catch (err) {
                    logger.warn(`Failed to get links for ${movie.url}`);
                    return { ...movie, links: [] };
                }
            })
        );

        // 3️⃣ Match each with TMDB
        const unifiedResults = await Promise.all(
            moviesWithLinks.map(movie => matchMoviesdbWithTMDB(movie, movie.links))
        );

        // 4️⃣ Filter successful matches
        const successful = unifiedResults.filter(m => m !== null);

        // 5️⃣ Apply language filter if specified
        let filtered = successful;
        if (language === 'tamil') {
            filtered = successful.filter(m => m.language_type === 'tamil');
        } else if (language === 'tamil_dubbed') {
            filtered = successful.filter(m => m.language_type === 'tamil_dubbed');
        }

        res.json({
            query,
            found: filtered.length > 0,
            total_matches: filtered.length,
            language_filter: language || 'none',
            results: filtered.map(m => ({
                tmdb_id: m.tmdb_id,
                title: m.title,
                year: m.year,
                rating: m.rating,
                language_type: m.language_type,
                poster: m.poster_url,
                trailer: m.trailer_key,
                confidence_score: m.confidence_score,
                has_watch_links: m.watch_links?.length > 0,
                has_download_links: m.download_links?.length > 0,
                has_links: (m.download_links?.length > 0) || (m.watch_links?.length > 0)
            }))
        });

    } catch (error) {
        logger.error(`Search error: ${error.message}`);
        res.status(500).json({
            error: 'Search failed',
            message: error.message
        });
    }
});

// ============================================================================
// ENDPOINT 2: Get Movie Details (Full - TMDB + Links)
// ============================================================================

/**
 * GET /api/movie/:tmdbId
 * 
 * Get full movie details including trailer, cast, watch/download links
 * 
 * Example: /api/movie/965483
 */
router.get('/api/movie/:tmdbId', async (req, res) => {
    const { tmdbId } = req.params;

    try {
        // Check database cache first
        const cached = await getUnifiedMovieByTMDBId(parseInt(tmdbId));

        if (cached && cached.download_links && cached.download_links.length > 0) {
            logger.info(`📦 Cache hit for TMDB#${tmdbId}`);
            return res.json({
                source: 'cache',
                movie: {
                    tmdb_id: cached.tmdb_id,
                    title: cached.title,
                    year: cached.year,
                    rating: cached.rating,
                    poster: cached.poster_url,
                    backdrop: cached.backdrop_url,
                    overview: cached.overview,
                    genres: cached.genres,
                    runtime: cached.runtime,
                    cast: cached.cast || cached.movie_cast || [],
                    director: cached.director,
                    trailer: cached.trailer_key,
                    language_type: cached.language_type,
                    confidence_score: cached.confidence_score,
                    watch_links: cached.watch_links || [],
                    download_links: cached.download_links || []
                }
            });
        }

        res.status(404).json({
            error: 'Movie not found in catalog',
            tmdb_id: tmdbId,
            message: 'This movie may not be available in Moviesda'
        });

    } catch (error) {
        logger.error(`Movie detail error: ${error.message}`);
        res.status(500).json({ error: 'Failed to fetch movie details' });
    }
});

// ============================================================================
// ENDPOINT 3: Batch Process (Admin Only)
// ============================================================================

/**
 * POST /api/admin/process-catalog
 * 
 * Reprocess entire Moviesda catalog and match with TMDB
 * Protected endpoint - requires admin token
 * 
 * Body:
 * {
 *   "limit": 100  // max movies to process
 * }
 */
router.post('/api/admin/process-catalog', async (req, res) => {
    const adminToken = req.headers['x-admin-token'];

    if (adminToken !== process.env.ADMIN_TOKEN) {
        return res.status(403).json({ error: 'Unauthorized' });
    }

    const { limit = 100 } = req.body;

    try {
        logger.warn(`⚠️  Starting batch TMDB processing for ${limit} movies...`);

        // 1️⃣ Get movies from DB
        const movies = await getAllMovies(limit);

        if (movies.length === 0) {
            return res.json({ message: 'No movies in database' });
        }

        // 2️⃣ For each, fetch links
        const withLinks = await Promise.all(
            movies.map(async (movie) => {
                try {
                    const details = await getMovieDownloadLinks(movie.url);
                    return {
                        ...movie,
                        links: details?.resolutions || []
                    };
                } catch {
                    return { ...movie, links: [] };
                }
            })
        );

        // 3️⃣ Process with TMDB matching
        const results = await processMoviesdbCatalog(withLinks);

        res.json({
            status: 'completed',
            ...results,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        logger.error(`Batch processing error: ${error.message}`);
        res.status(500).json({
            error: 'Batch processing failed',
            message: error.message
        });
    }
});

// ============================================================================
// ENDPOINT 4: Browse Categories (Tamil Only)
// ============================================================================

/**
 * GET /api/catalog/tamil
 * 
 * Get all Tamil + Tamil-dubbed movies available in Moviesda
 * Paginated for performance
 * 
 * Query params:
 * - page: page number (default: 1)
 * - limit: items per page (default: 20, max: 100)
 * - language: 'tamil' or 'tamil_dubbed'
 */
router.get('/api/catalog/tamil', async (req, res) => {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 20);
    const language = req.query.language;  // optional filter
    const offset = (page - 1) * limit;

    try {
        const movies = await getAllUnifiedMovies(limit, offset, language);

        // Get total count for pagination
        let countQuery = supabase.from('unified_movies').select('*', { count: 'exact', head: true });
        if (language) countQuery = countQuery.eq('language_type', language);
        const { count: totalCount } = await countQuery;

        res.json({
            page,
            limit,
            language_filter: language || 'all',
            total_items: totalCount || 0,
            movies: movies.map(m => ({
                tmdb_id: m.tmdb_id,
                title: m.title,
                year: m.year,
                language_type: m.language_type,
                rating: m.rating,
                poster: m.poster_url,
                trailer: m.trailer_key,
                has_watch_links: m.watch_links?.length > 0,
                has_download_links: m.download_links?.length > 0
            }))
        });

    } catch (error) {
        logger.error(`Catalog error: ${error.message}`);
        res.status(500).json({ error: 'Failed to fetch catalog' });
    }
});

// ============================================================================
// ENDPOINT 5: Trending (Most Recent Unified)
// ============================================================================

/**
 * GET /api/catalog/trending
 * 
 * Get trending Tamil movies (sorted by recent updates)
 */
router.get('/api/catalog/trending', async (req, res) => {
    try {
        // For now, trending is just the most recently updated/added movies
        const movies = await getAllUnifiedMovies(10, 0);

        res.json({
            count: movies.length,
            movies: movies.map(m => ({
                tmdb_id: m.tmdb_id,
                title: m.title,
                rating: m.rating,
                year: m.year,
                poster: m.poster_url,
                language_type: m.language_type
            }))
        });
    } catch (error) {
        logger.error(`Trending error: ${error.message}`);
        res.status(500).json({ error: 'Failed to fetch trending' });
    }
});

// ============================================================================
// ENDPOINT 6: Scraper Fallbacks (Legacy Support for Home Screen)
// ============================================================================

/**
 * GET /api/movies/latest
 * Get recent updates directly from Moviesda
 */
router.get('/api/movies/latest', async (req, res) => {
    try {
        const movies = await getLatestUpdates();

        // Try to find posters for these movies
        const enriched = await Promise.all(movies.map((m, i) => enrichMovie(m, i)));
        res.json(enriched);
    } catch (error) {
        logger.error(`Latest updates error: ${error.message}`);
        res.status(500).json({ error: 'Failed to fetch latest updates' });
    }
});

/**
 * GET /api/movies/webseries
 * Get latest web series from Moviesda
 */
router.get('/api/movies/webseries', async (req, res) => {
    try {
        const series = await getWebSeriesLatest();
        const enriched = await Promise.all(series.map((m, i) => enrichMovie(m, i)));
        res.json(enriched);
    } catch (error) {
        logger.error(`Web series error: ${error.message}`);
        res.status(500).json({ error: 'Failed to fetch web series' });
    }
});

/**
 * GET /api/movies/isaidub
 * Get latest dubbed movies from isaiDub
 */
router.get('/api/movies/isaidub', async (req, res) => {
    try {
        const movies = await getIsaidubLatest();
        const enriched = await Promise.all(movies.map((m, i) => enrichMovie(m, i)));
        res.json(enriched);
    } catch (error) {
        logger.error(`Isaidub error: ${error.message}`);
        res.status(500).json({ error: 'Failed to fetch dubbed movies' });
    }
});

// ============================================================================
// ENDPOINT 8: Standard Search (Scraper Only)
// ============================================================================

const detailsCache = new Map();

/**
 * GET /api/search
 * Legacy search for the Flutter app
 */
router.get('/api/search', async (req, res) => {
    const { q: query } = req.query;
    if (!query) return res.status(400).json({ error: 'Missing query' });

    try {
        const results = await searchAllDirect(query);
        res.json({
            results,
            count: results.length,
            source: 'scraper'
        });
    } catch (error) {
        logger.error(`Search error: ${error.message}`);
        res.status(500).json({ error: 'Search failed' });
    }
});

/**
 * GET /api/movies/details
 * Detailed info for a scraped movie URL
 */
router.get('/api/movies/details', async (req, res) => {
    const { url } = req.query;
    if (!url) return res.status(400).json({ error: 'Missing url' });

    try {
        // Simple memory cache
        if (detailsCache.has(url)) {
            const cached = detailsCache.get(url);
            if (Date.now() - cached.time < 3600000) {
                return res.json(cached.data);
            }
        }

        // 1. Scrape the links (essential)
        const details = await getMovieDownloadLinks(url);
        if (!details) return res.status(404).json({ error: 'Not found' });

        // 2. Try to match with TMDB for rich metadata (cast, genres, etc)
        let richData = null;
        try {
            // Priority: Check DB by title first
            const cleanTitle = details.title.split('(')[0].trim();
            const { data: cachedDB } = await supabase
                .from('unified_movies')
                .select('*')
                .ilike('title', `%${cleanTitle}%`)
                .limit(1)
                .maybeSingle();

            if (cachedDB) {
                richData = cachedDB;
            } else {
                // If not in DB, live match with TMDB
                const matched = await matchMoviesdbWithTMDB(details, details.resolutions);
                if (matched) richData = matched;
            }
        } catch (tmdbErr) {
            logger.debug(`TMDB match failed for details: ${tmdbErr.message}`);
        }

        const responseData = {
            title: richData?.title || details.title,
            url: url,
            tmdb_id: richData?.tmdb_id || richData?.id,
            year: richData?.year || details.year,
            quality: details.quality || richData?.quality || 'DVD/HD',
            poster: richData?.poster_url || details.poster_url,
            backdrop: richData?.backdrop_url,
            rating: richData?.rating || 'N/A',
            runtime: richData?.runtime,
            synopsis: richData?.overview || details.synopsis || 'No description available for this movie.',
            genres: richData?.genres,
            genre: richData?.genres, // Alias for UI
            cast: richData?.cast || richData?.movie_cast || [],
            director: richData?.director,
            trailer: richData?.trailer_key,
            type: details.type || (richData?.language_type === 'series' || richData?.language_type === 'tv' ? 'series' : 'movie'),
            resolutions: details.resolutions || [],
            downloads: details.resolutions || []
        };

        detailsCache.set(url, { data: responseData, time: Date.now() });
        res.json(responseData);
    } catch (error) {
        logger.error(`Detail error: ${error.message}`);
        res.status(500).json({ error: 'Failed' });
    }
});

/**
 * GET /api/proxy-image
 * Proxies external images to bypass CORS/Hotlinking
 */
router.get('/api/proxy-image', async (req, res) => {
    const { url } = req.query;
    if (!url) return res.status(400).send('Missing url');

    try {
        const response = await axios.get(url, {
            responseType: 'arraybuffer',
            headers: {
                ...REQUEST_HEADERS,
                'Referer': new URL(url).origin
            },
            timeout: 5000
        });

        const contentType = response.headers['content-type'] || 'image/jpeg';
        res.setHeader('Content-Type', contentType);
        res.setHeader('Cache-Control', 'public, max-age=86400');
        res.send(response.data);
    } catch (error) {
        logger.warn(`Proxy Image Failed for ${url}: ${error.message}`);
        res.status(404).send('Not found');
    }
});

/**
 * GET /api/catalog/latest-tamil
 * Recently processed high-quality Tamil movies (Unified)
 */
router.get('/api/catalog/latest-tamil', async (req, res) => {
    try {
        // High confidence movies, sorted by update time
        const movies = await getAllUnifiedMovies(15, 0, 'tamil');
        res.json({
            count: movies.length,
            movies: movies.map(m => ({
                tmdb_id: m.tmdb_id,
                title: m.title,
                year: m.year,
                rating: m.rating,
                poster: m.poster_url,
                has_links: true
            }))
        });
    } catch (error) {
        logger.error(`Latest tamil error: ${error.message}`);
        res.status(500).json({ error: 'Failed' });
    }
});

// ============================================================================
// ENDPOINT 9: Health & Stats (Restored)
// ============================================================================

/**
 * GET /api/catalog/stats
 */
router.get('/api/catalog/stats', async (req, res) => {
    try {
        const stats = await getStats();
        const { count: unifiedCount } = await supabase.from('unified_movies').select('*', { count: 'exact', head: true });
        const { count: tamilCount } = await supabase.from('unified_movies').select('*', { count: 'exact', head: true }).eq('language_type', 'tamil');
        const { count: dubbedCount } = await supabase.from('unified_movies').select('*', { count: 'exact', head: true }).eq('language_type', 'tamil_dubbed');

        res.json({
            total_moviesda_movies: stats.totalMovies,
            total_unified_movies: unifiedCount || 0,
            total_tamil_movies: tamilCount || 0,
            total_tamil_dubbed: dubbedCount || 0,
            last_updated: new Date().toISOString(),
            catalog_health: {
                tmdb_match_rate: stats.totalMovies > 0 ? ((unifiedCount || 0) / stats.totalMovies * 100).toFixed(1) + '%' : '0%',
                min_confidence_threshold: 60,
                languages_supported: ['tamil', 'tamil_dubbed']
            }
        });
    } catch (error) {
        logger.error(`Stats error: ${error.message}`);
        res.status(500).json({ error: 'Failed' });
    }
});

export default router;
