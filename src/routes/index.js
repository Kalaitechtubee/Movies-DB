/**
 * Express Routes
 * Defines HTTP routes for REST API and MCP SSE endpoints
 */

import express from 'express';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { mcpServer } from '../mcp/server.js';
import { searchMovies, getStats } from '../services/database.js';
import { scrapeHome, searchMoviesDirect } from '../services/scraper.js';
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

        res.json({
            count: results.length,
            source,
            results
        });
    } catch (error) {
        logger.error('Search error:', error.message);
        res.status(500).json({ error: 'Search failed' });
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

export default router;
