/**
 * TV/Series API
 * 
 * TV show and web series endpoints.
 */

import express from 'express';
import providerManager from '../core/providerManager.js';
import { quickEnrich } from '../core/contentPipeline.js';
import { matchTVShow, getFullTVDetails } from '../services/tmdb/tv.js';
import supabase from '../utils/supabase.js';
import logger from '../utils/logger.js';

const router = express.Router();

/**
 * GET /api/tv/latest
 * 
 * Get latest TV shows/web series.
 */
router.get('/latest', async (req, res) => {
    try {
        const provider = providerManager.getProvider('moviesda');
        if (!provider || !provider.getWebSeriesLatest) {
            return res.status(503).json({ error: 'Web series not available' });
        }

        const series = await provider.getWebSeriesLatest();
        const enriched = await Promise.all(
            series.slice(0, 15).map(m => quickEnrich(m))
        );

        res.json(enriched);
    } catch (error) {
        logger.error(`TV latest error: ${error.message}`);
        res.status(500).json({ error: 'Failed to fetch latest series' });
    }
});

/**
 * GET /api/tv/:tmdbId
 * 
 * Get TV show by TMDB ID.
 */
router.get('/:tmdbId', async (req, res) => {
    const { tmdbId } = req.params;

    try {
        const fullDetails = await getFullTVDetails(parseInt(tmdbId));

        if (fullDetails) {
            return res.json({
                source: 'tmdb',
                show: fullDetails
            });
        }

        res.status(404).json({
            error: 'TV show not found',
            tmdb_id: tmdbId
        });

    } catch (error) {
        logger.error(`TV detail error: ${error.message}`);
        res.status(500).json({ error: 'Failed to fetch TV details' });
    }
});

/**
 * GET /api/tv/search
 * 
 * Search for TV shows.
 */
router.get('/search', async (req, res) => {
    const { q: query } = req.query;
    if (!query) return res.status(400).json({ error: 'Missing query' });

    try {
        // Search web series from providers
        const provider = providerManager.getProvider('moviesda');
        let results = [];

        if (provider?.searchWebSeries) {
            results = await provider.searchWebSeries(query);
        }

        // Try TMDB matching
        const matched = await matchTVShow(query);

        res.json({
            query,
            results,
            tmdb_match: matched
        });
    } catch (error) {
        logger.error(`TV search error: ${error.message}`);
        res.status(500).json({ error: 'Search failed' });
    }
});

export default router;
