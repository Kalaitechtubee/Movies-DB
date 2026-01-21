/**
 * Main Routes Index - Provider-Based Architecture
 * 
 * This file connects all API endpoints to the Express router.
 * Uses the new provider-based architecture.
 */

import express from 'express';
import searchApi from '../api/search.api.js';
import movieApi from '../api/movie.api.js';
import tvApi from '../api/tv.api.js';
import providerManager from '../core/providerManager.js';
import contentPipeline from '../core/contentPipeline.js';
import axios from 'axios';
import { REQUEST_HEADERS } from '../config.js';
import logger from '../utils/logger.js';
import supabase from '../utils/supabase.js';

// Import legacy services for backward compatibility
import {
    getAllMovies,
    getStats,
    getAllUnifiedMovies,
    getUnifiedMovieByTMDBId
} from '../services/database.js';

const router = express.Router();

// ============================================================================
// MOUNT NEW API ROUTES
// ============================================================================

router.use('/api', searchApi);       // /api/search, /api/search-unified
router.use('/api/movies', movieApi); // /api/movies/details, /api/movies/latest, etc.
router.use('/api/tv', tvApi);        // /api/tv/latest, /api/tv/:tmdbId

// Also mount movie API at /api/movie for legacy support
router.use('/api/movie', movieApi);

// ============================================================================
// PROVIDER MANAGEMENT ENDPOINTS
// ============================================================================

/**
 * GET /api/providers
 * List all registered providers and their status
 */
router.get('/api/providers', (req, res) => {
    const health = providerManager.getProvidersHealth();
    res.json({
        providers: health,
        active_count: Object.values(health).filter(p => p.status === 'active').length,
        total_count: Object.keys(health).length
    });
});

/**
 * GET /api/providers/health
 * Run health check on all providers
 */
router.get('/api/providers/health', async (req, res) => {
    const results = await providerManager.runHealthCheck();
    res.json({
        status: 'completed',
        results,
        timestamp: new Date().toISOString()
    });
});

/**
 * POST /api/providers/:id/enable
 * Enable a provider
 */
router.post('/api/providers/:id/enable', (req, res) => {
    const { id } = req.params;
    providerManager.enableProvider(id);
    res.json({ success: true, provider: id, action: 'enabled' });
});

/**
 * POST /api/providers/:id/disable
 * Disable a provider
 */
router.post('/api/providers/:id/disable', (req, res) => {
    const { id } = req.params;
    const { reason } = req.body || {};
    providerManager.disableProvider(id, reason || 'manual');
    res.json({ success: true, provider: id, action: 'disabled', reason });
});

// ============================================================================
// CATALOG ENDPOINTS
// ============================================================================

/**
 * GET /api/catalog/tamil
 * Get Tamil movies from unified database
 */
router.get('/api/catalog/tamil', async (req, res) => {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 20);
    const language = req.query.language;
    const offset = (page - 1) * limit;

    try {
        const movies = await getAllUnifiedMovies(limit, offset, language);

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
                has_links: (m.download_links?.length > 0) || (m.watch_links?.length > 0)
            }))
        });

    } catch (error) {
        logger.error(`Catalog error: ${error.message}`);
        res.status(500).json({ error: 'Failed to fetch catalog' });
    }
});

/**
 * GET /api/catalog/trending
 * Get trending movies
 */
router.get('/api/catalog/trending', async (req, res) => {
    try {
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

/**
 * GET /api/catalog/latest-tamil
 * Recently processed Tamil movies
 */
router.get('/api/catalog/latest-tamil', async (req, res) => {
    try {
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

/**
 * GET /api/catalog/stats
 * Database statistics
 */
router.get('/api/catalog/stats', async (req, res) => {
    try {
        const stats = await getStats();
        const providersHealth = providerManager.getProvidersHealth();

        const { count: unifiedCount } = await supabase.from('unified_movies').select('*', { count: 'exact', head: true });
        const { count: tamilCount } = await supabase.from('unified_movies').select('*', { count: 'exact', head: true }).eq('language_type', 'tamil');
        const { count: dubbedCount } = await supabase.from('unified_movies').select('*', { count: 'exact', head: true }).eq('language_type', 'tamil_dubbed');

        res.json({
            total_moviesda_movies: stats.totalMovies,
            total_unified_movies: unifiedCount || 0,
            total_tamil_movies: tamilCount || 0,
            total_tamil_dubbed: dubbedCount || 0,
            providers: providersHealth,
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

// ============================================================================
// ADMIN ENDPOINTS
// ============================================================================

/**
 * POST /api/admin/process-catalog
 * Batch process movies with TMDB matching
 */
router.post('/api/admin/process-catalog', async (req, res) => {
    const adminToken = req.headers['x-admin-token'];

    if (adminToken !== process.env.ADMIN_TOKEN) {
        return res.status(403).json({ error: 'Unauthorized' });
    }

    const { limit = 100 } = req.body;

    try {
        logger.warn(`⚠️  Starting batch processing for ${limit} movies...`);

        const movies = await getAllMovies(limit);
        if (movies.length === 0) {
            return res.json({ message: 'No movies in database' });
        }

        // Process movies through the new pipeline
        const processed = await contentPipeline.processBatch(movies, 'moviesda', { limit });

        // Save processed results to unified_movies table
        for (const movie of processed) {
            if (movie.tmdb_id) {
                await insertUnifiedMovie(movie);
            }
        }

        res.json({
            status: 'completed',
            processed_count: processed.length,
            matched_count: processed.filter(m => m.tmdb_id).length,
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
// UTILITY ENDPOINTS
// ============================================================================

/**
 * GET /api/proxy-image
 * Proxy external images to bypass CORS
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
 * GET /health
 * Health check endpoint
 */
router.get('/health', (req, res) => {
    const providers = providerManager.getProvidersHealth();
    const activeProviders = Object.values(providers).filter(p => p.status === 'active').length;

    res.json({
        status: 'ok',
        uptime: process.uptime(),
        providers: {
            active: activeProviders,
            total: Object.keys(providers).length
        },
        timestamp: new Date().toISOString()
    });
});

export default router;