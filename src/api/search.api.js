/**
 * Search API
 * 
 * Unified search across all providers.
 */

import express from 'express';
import providerManager from '../core/providerManager.js';
import { processItem } from '../core/contentPipeline.js';
import logger from '../utils/logger.js';

const router = express.Router();

/**
 * GET /api/search-unified
 * 
 * Search movies across all providers with TMDB matching.
 * 
 * Query params:
 * - q: search query (required)
 * - language: 'tamil' or 'tamil_dubbed' (optional filter)
 * - provider: specific provider ID (optional)
 */
router.get('/search-unified', async (req, res) => {
    const { q: query, language, provider: providerId } = req.query;

    if (!query) {
        return res.status(400).json({
            error: 'Missing query parameter (q)',
            example: '/api/search-unified?q=Jawan&language=tamil_dubbed'
        });
    }

    try {
        logger.info(`🔍 Unified search: "${query}" (language: ${language || 'all'}, provider: ${providerId || 'all'})`);

        let results;

        if (providerId) {
            // Search specific provider
            const provider = providerManager.getProvider(providerId);
            if (!provider) {
                return res.status(404).json({ error: `Provider not found: ${providerId}` });
            }
            results = await provider.search(query);
        } else {
            // Search all providers
            results = await providerManager.searchAllProviders(query);
        }

        if (results.length === 0) {
            return res.json({
                query,
                found: false,
                results: [],
                message: 'No movies found'
            });
        }

        // Process with TMDB matching (top 5 for speed)
        const processedResults = await Promise.all(
            results.slice(0, 5).map(item => processItem(item, item.source))
        );

        // Filter by language if specified
        let filtered = processedResults;
        if (language === 'tamil') {
            filtered = processedResults.filter(m => m.language_type === 'tamil');
        } else if (language === 'tamil_dubbed') {
            filtered = processedResults.filter(m => m.language_type === 'tamil_dubbed');
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
                source: m.source,
                url: m.url,
                confidence_score: m.confidence_score,
                tmdb_status: m.tmdb_status
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

/**
 * GET /api/search
 * 
 * Legacy search for backwards compatibility.
 */
router.get('/search', async (req, res) => {
    const { q: query } = req.query;
    if (!query) return res.status(400).json({ error: 'Missing query' });

    try {
        const results = await providerManager.searchAllProviders(query);
        res.json({
            results,
            count: results.length,
            source: 'providers'
        });
    } catch (error) {
        logger.error(`Search error: ${error.message}`);
        res.status(500).json({ error: 'Search failed' });
    }
});

export default router;
