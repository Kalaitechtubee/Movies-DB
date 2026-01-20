/**
 * Express Routes
 * Defines HTTP routes for REST API and MCP SSE endpoints
 */

import express from 'express';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { mcpServer } from '../mcp/server.js';
import axios from 'axios';
import { searchMovies, getStats, getAllMovies, insertMovie, insertMovies } from '../services/database.js';
import { scrapeHome, searchMoviesDirect, searchAllDirect, getMovieDownloadLinks, getCategories, getCategoryMovies, getIsaidubLatest, getLatestUpdates, getWebSeriesLatest } from '../services/scraper.js';
import { performUnifiedSearch, enrichMovieList, enrichMovie } from '../services/unifiedSearch.js';
import logger from '../utils/logger.js';

const router = express.Router();



/**
 * Get Movie Details (Resolutions/Direct Links) Endpoint
 */
router.get('/api/movies/details', async (req, res) => {
    const url = req.query.url;
    if (!url) return res.status(400).json({ error: 'Missing url' });
    try {
        // 1. Get technical links from scraper
        const details = await getMovieDownloadLinks(url);
        if (!details) return res.status(404).json({ error: 'Movie not found' });

        // 2. Enrich scraper results with rich TMDB metadata
        const enriched = await enrichMovie(details);

        res.json(enriched);
    } catch (error) {
        logger.error(`Details error for ${url}:`, error.message);
        res.status(500).json({ error: 'Failed to fetch details' });
    }
});

/**
 * Get Latest Web Series Endpoint
 */
router.get('/api/movies/webseries', async (req, res) => {
    try {
        const results = await getWebSeriesLatest();
        const enriched = await enrichMovieList(results);
        res.json(enriched);
    } catch (error) {
        logger.error('WebSeries error:', error.message);
        res.status(500).json({ error: 'Failed' });
    }
});

// Store active SSE transports
const transports = new Map();

// Session cleanup interval (5 seconds after disconnect)
const SESSION_CLEANUP_DELAY = 5000;

/**
 * SSE Endpoint - Establishes MCP connection
 */
router.get('/sse', async (req, res) => {
    const sessionId = Date.now().toString();

    const transport = new SSEServerTransport(`/messages?sessionId=${sessionId}`, res);
    transports.set(sessionId, transport);

    logger.info(`SSE connection established: ${sessionId}`);

    // Cleanup on disconnect
    res.on('close', () => {
        logger.info(`SSE connection closed: ${sessionId}`);
        setTimeout(() => {
            transports.delete(sessionId);
            logger.debug(`Session cleaned up: ${sessionId}`);
        }, SESSION_CLEANUP_DELAY);
    });

    await mcpServer.connect(transport);
});

/**
 * Message Endpoint - Handles MCP messages
 */
router.post('/messages', async (req, res) => {
    let sessionId = req.query.sessionId;

    // Handle array or duplicate sessionId params
    if (Array.isArray(sessionId)) {
        sessionId = sessionId[0];
    }
    if (sessionId?.includes('?')) {
        sessionId = sessionId.split('?')[0];
    }

    const transport = transports.get(sessionId);

    if (!transport) {
        logger.warn(`Session not found: ${sessionId}`);
        return res.status(404).json({ error: 'Session not found' });
    }

    await transport.handlePostMessage(req, res);
});

/**
 * REST Search Endpoint (Unified)
 */
router.get('/api/search', async (req, res) => {
    const query = req.query.q;
    if (!query) return res.status(400).json({ error: 'Missing query' });

    try {
        const result = await performUnifiedSearch(query);
        // Map to old search structure for compatibility or return unified
        if (result.found) {
            res.json({
                count: 1,
                source: result.source.links,
                results: [result.movie]
            });
        } else {
            res.json({ count: 0, results: [] });
        }
    } catch (error) {
        logger.error(`Search error for query "${query}":`, error.message);
        res.status(500).json({ error: 'Search failed' });
    }
});

/**
 * Unified Search Endpoint
 */
router.get('/api/unified-search', async (req, res) => {
    const query = req.query.q;
    if (!query) return res.status(400).json({ error: 'Missing query' });

    try {
        const result = await performUnifiedSearch(query);
        res.json(result);
    } catch (error) {
        logger.error(`Unified search API error for "${query}":`, error.message);
        res.status(500).json({ error: 'Unified search failed' });
    }
});

/**
 * REST Refresh Endpoint
 */
router.post('/api/refresh', (req, res) => {
    scrapeHome().catch(err => {
        logger.error('Refresh error:', err.message);
    });

    res.json({
        status: 'started',
        message: 'Database refresh started in background'
    });
});

/**
 * Health Check Endpoint
 */
router.get('/health', async (req, res) => {
    const stats = await getStats();
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        activeSessions: transports.size,
        database: {
            type: 'supabase',
            movies: stats.totalMovies
        }
    });
});

/**
 * Database Stats Endpoint
 */
router.get('/api/stats', async (req, res) => {
    try {
        const stats = await getStats();
        res.json(stats);
    } catch (error) {
        logger.error('Stats error:', error.message);
        res.status(500).json({ error: 'Failed to get stats' });
    }
});

/**
 * Get Categories Endpoint
 */
router.get('/api/categories', async (req, res) => {
    try {
        const categories = await getCategories();
        res.json(categories);
    } catch (error) {
        logger.error('Categories error:', error.message);
        res.status(500).json({ error: 'Failed to fetch categories' });
    }
});

/**
 * Get Category Movies Endpoint
 */
router.get('/api/movies/category', async (req, res) => {
    const url = req.query.url;
    const year = req.query.year || 'Unknown';
    const enrich = req.query.enrich === 'true';

    if (!url) {
        return res.status(400).json({ error: 'Missing url parameter' });
    }

    try {
        const results = await getCategoryMovies(url, year, false);
        const enriched = await enrichMovieList(results);
        res.json({
            count: enriched.length,
            results: enriched
        });
    } catch (error) {
        logger.error('Category movies error:', error.message);
        res.status(500).json({ error: 'Failed' });
    }
});

/**
 * Get Recent Movies Endpoint
 */
router.get('/api/movies/recent', async (req, res) => {
    const limit = parseInt(req.query.limit) || 20;
    try {
        const results = await getAllMovies(limit);
        const enriched = await enrichMovieList(results);
        res.json(enriched);
    } catch (error) {
        logger.error('Recent movies error:', error.message);
        res.status(500).json({ error: 'Failed' });
    }
});

/**
 * Get Latest (Trending) Movies Endpoint
 */
router.get('/api/movies/latest', async (req, res) => {
    try {
        let results = await getLatestUpdates();
        if (!results || results.length === 0) {
            results = await getAllMovies(15);
        }
        const enriched = await enrichMovieList(results);
        res.json(enriched);
    } catch (error) {
        logger.error('Latest movies error:', error.message);
        res.status(500).json({ error: 'Failed to fetch latest movies' });
    }
});

/**
 * Get Latest isaiDub Movies Endpoint
 */
router.get('/api/movies/isaidub', async (req, res) => {
    try {
        const results = await getIsaidubLatest();
        const enriched = await enrichMovieList(results);
        res.json(enriched);
    } catch (error) {
        logger.error('Isaidub latest movies error:', error.message);
        res.status(500).json({ error: 'Failed to fetch isaidub latest movies' });
    }
});

/**
 * Image Proxy Endpoint - Bypasses CORS and Hotlinking restrictions
 */
router.get('/api/proxy-image', async (req, res) => {
    const imageUrl = req.query.url;
    if (!imageUrl || imageUrl === 'null' || imageUrl === 'undefined' || imageUrl === '') {
        return res.status(400).send('Missing url');
    }

    try {
        const urlObj = new URL(imageUrl);
        const isMoviesda = urlObj.hostname.includes('moviesda') || urlObj.hostname.includes('isaidub');

        const response = await axios({
            method: 'get',
            url: imageUrl,
            responseType: 'stream',
            headers: {
                'Referer': isMoviesda ? `${urlObj.origin}/` : 'https://www.google.com/',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36'
            },
            timeout: 10000,
            validateStatus: (status) => status < 400
        });

        // Set headers and pipe data
        if (response.headers['content-type']) {
            res.set('Content-Type', response.headers['content-type']);
        }
        res.set('Cache-Control', 'public, max-age=86400');
        res.set('Access-Control-Allow-Origin', '*');
        response.data.pipe(res);
    } catch (error) {
        logger.error(`Proxy image error for ${imageUrl}: ${error.message}`);

        // Fallback for TMDB images: Redirect directly if proxy fails
        if (imageUrl.includes('tmdb.org') || imageUrl.includes('cloudinary')) {
            res.set('Access-Control-Allow-Origin', '*');
            return res.redirect(imageUrl);
        }

        res.status(500).send('Failed to fetch image');
    }
});

export default router;
