/**
 * Express Routes
 * Defines HTTP routes for REST API and MCP SSE endpoints
 */

import express from 'express';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { mcpServer } from '../mcp/server.js';
import { searchMovies, getStats, getAllMovies, insertMovie, insertMovies } from '../services/database.js';
import { scrapeHome, searchMoviesDirect, getMovieDownloadLinks, getCategories, getCategoryMovies } from '../services/scraper.js';
import logger from '../utils/logger.js';

const router = express.Router();

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
 * REST Search Endpoint
 */
router.get('/api/search', async (req, res) => {
    const query = req.query.q;

    if (!query) {
        return res.status(400).json({ error: 'Missing query parameter: q' });
    }

    try {
        let results = await searchMovies(query);
        let source = 'database';

        if (results.length === 0) {
            logger.info(`No DB results for "${query}", performing direct search...`);
            results = await searchMoviesDirect(query);
            source = 'direct';
        }

        // Limit enrichment to first 10 for performance, do rest in background
        const toEnrich = results.slice(0, 10);
        const remaining = results.slice(10);

        const detailedResults = await Promise.all(toEnrich.map(async (movie) => {
            try {
                // If poster is missing or it's a direct link/missing resolutions, fetch them
                if (!movie.poster_url || !movie.resolutions || movie.resolutions.length === 0) {
                    const details = await getMovieDownloadLinks(movie.url, query);
                    return details ? { ...movie, ...details } : movie;
                }
            } catch (err) {
                logger.warn(`Failed to enrich movie details for ${movie.title}: ${err.message}`);
            }
            return movie;
        }));

        // Background enrichment for the rest
        if (remaining.length > 0) {
            remaining.forEach(async (movie) => {
                try {
                    if (!movie.poster_url || !movie.resolutions || movie.resolutions.length === 0) {
                        const details = await getMovieDownloadLinks(movie.url, query);
                        if (details) await insertMovie({ ...movie, ...details });
                    }
                } catch (err) { /* ignore */ }
            });
        }

        const finalResults = [...detailedResults, ...remaining];

        // Persist enriched results to database
        if (detailedResults.length > 0) {
            await insertMovies(detailedResults);
        }

        res.json({
            count: finalResults.length,
            source,
            results: finalResults
        });
    } catch (error) {
        logger.error(`Search error for query "${query}":`, error);
        res.status(500).json({ error: 'Search failed', details: error.message });
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
        const results = await getCategoryMovies(url, year, enrich);
        res.json({
            count: results.length,
            results
        });
    } catch (error) {
        logger.error('Category movies error:', error.message);
        res.status(500).json({ error: 'Failed to fetch category movies' });
    }
});

/**
 * Get Recent Movies Endpoint
 */
router.get('/api/movies/recent', async (req, res) => {
    const limit = parseInt(req.query.limit) || 20;
    try {
        const results = await getAllMovies(limit);

        // Background enrichment for movies missing posters
        const moviesMissingPosters = results.filter(m => !m.poster_url);
        if (moviesMissingPosters.length > 0) {
            // Only process a small batch to not slow down the response
            const toEnrich = moviesMissingPosters.slice(0, 5);
            Promise.all(toEnrich.map(async (movie) => {
                try {
                    const details = await getMovieDetails(movie.url);
                    if (details && details.poster_url) {
                        await insertMovie({ ...movie, ...details });
                        logger.debug(`Background enriched poster for: ${movie.title}`);
                    }
                } catch (err) {
                    // Ignore background errors
                }
            }));
        }

        res.json(results);
    } catch (error) {
        logger.error('Recent movies error:', error.message);
        res.status(500).json({ error: 'Failed to fetch recent movies' });
    }
});

/**
 * Get Latest (Trending) Movies Endpoint
 */
router.get('/api/movies/latest', async (req, res) => {
    try {
        // For "latest", we can either scrape home or get from DB
        const results = await getAllMovies(15);

        // Enrichment for missing posters in latest movies (crucial for homepage)
        // Split into "immediate" (await) and "background" to avoid slow page load
        const toEnrichImmediate = results.slice(0, 5);
        const remaining = results.slice(5);

        const enrichedImmediate = await Promise.all(toEnrichImmediate.map(async (movie) => {
            if (!movie.poster_url) {
                try {
                    const details = await getMovieDetails(movie.url);
                    if (details) {
                        const updated = { ...movie, ...details };
                        await insertMovie(updated);
                        return updated;
                    }
                } catch (err) {
                    logger.debug(`Failed to enrich latest movie ${movie.title}: ${err.message}`);
                }
            }
            return movie;
        }));

        // Do the rest in background
        remaining.forEach(async (movie) => {
            if (!movie.poster_url) {
                try {
                    const details = await getMovieDetails(movie.url);
                    if (details) await insertMovie({ ...movie, ...details });
                } catch (err) { }
            }
        });

        res.json([...enrichedImmediate, ...remaining]);
    } catch (error) {
        logger.error('Latest movies error:', error.message);
        res.status(500).json({ error: 'Failed to fetch latest movies' });
    }
});

export default router;
