/**
 * Movie API
 * 
 * Movie details and catalog endpoints.
 */

import express from 'express';
import providerManager from '../core/providerManager.js';
import { enrichWithTMDBDetails, quickEnrich } from '../core/contentPipeline.js';
import { matchMovie, getFullMovieDetails } from '../services/tmdb/movie.js';
import supabase from '../utils/supabase.js';
import logger from '../utils/logger.js';

const router = express.Router();

// Simple memory cache
const detailsCache = new Map();
const CACHE_TTL = 3600000; // 1 hour

/**
 * GET /api/movies/details
 * 
 * Get movie details from URL.
 */
router.get('/details', async (req, res) => {
    const { url } = req.query;
    if (!url) return res.status(400).json({ error: 'Missing url' });

    try {
        // Check cache
        if (detailsCache.has(url)) {
            const cached = detailsCache.get(url);
            if (Date.now() - cached.time < CACHE_TTL) {
                return res.json(cached.data);
            }
        }

        // Get details from the appropriate provider
        const details = await providerManager.getDetailsFromProvider(url);
        if (!details) return res.status(404).json({ error: 'Not found' });

        // Try to enrich with TMDB
        let richData = null;
        try {
            // Check DB first
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
                // Live TMDB match
                richData = await matchMovie(details.title, details.year);
                if (richData?.tmdb_id) {
                    const fullDetails = await getFullMovieDetails(richData.tmdb_id);
                    if (fullDetails) richData = { ...richData, ...fullDetails };
                }
            }
        } catch (tmdbErr) {
            logger.debug(`TMDB match failed: ${tmdbErr.message}`);
        }

        const responseData = {
            title: richData?.title || details.title,
            url: url,
            tmdb_id: richData?.tmdb_id,
            year: richData?.year || details.year,
            quality: details.quality || 'DVD/HD',
            poster: richData?.poster_url || details.poster_url,
            backdrop: richData?.backdrop_url,
            rating: richData?.rating || 'N/A',
            runtime: richData?.runtime,
            synopsis: richData?.overview || details.synopsis || 'No description available.',
            genres: richData?.genres,
            genre: richData?.genres,
            cast: richData?.cast || [],
            director: richData?.director,
            trailer: richData?.trailer_key,
            type: details.type || 'movie',
            source: details.source,
            resolutions: details.resolutions || [],
            downloads: details.resolutions || []
        };

        detailsCache.set(url, { data: responseData, time: Date.now() });
        res.json(responseData);
    } catch (error) {
        logger.error(`Detail error: ${error.message}`);
        res.status(500).json({ error: 'Failed to fetch details' });
    }
});

/**
 * GET /api/movies/latest
 * 
 * Get latest movies from all providers.
 */
router.get('/latest', async (req, res) => {
    try {
        const allLatest = await providerManager.getLatestFromAllProviders();
        const movies = allLatest['moviesda'] || [];

        const provider = providerManager.getProvider('moviesda');
        const enriched = await Promise.all(
            movies.slice(0, 15).map(m => quickEnrich(m, provider?.getQuickPoster))
        );

        res.json(enriched);
    } catch (error) {
        logger.error(`Latest movies error: ${error.message}`);
        res.status(500).json({ error: 'Failed to fetch latest movies' });
    }
});

/**
 * GET /api/movies/isaidub
 * 
 * Get latest dubbed movies from isaiDub.
 */
router.get('/isaidub', async (req, res) => {
    try {
        const provider = providerManager.getProvider('isaidub');
        if (!provider) {
            return res.status(503).json({ error: 'isaiDub provider not available' });
        }

        const movies = await provider.getLatest();
        const enriched = await Promise.all(
            movies.slice(0, 15).map(m => quickEnrich(m, provider.getQuickPoster))
        );

        res.json(enriched);
    } catch (error) {
        logger.error(`isaiDub error: ${error.message}`);
        res.status(500).json({ error: 'Failed to fetch dubbed movies' });
    }
});

/**
 * GET /api/movies/webseries
 * 
 * Get latest web series.
 */
router.get('/webseries', async (req, res) => {
    try {
        const provider = providerManager.getProvider('moviesda');
        if (!provider || !provider.getWebSeriesLatest) {
            return res.status(503).json({ error: 'Web series not available' });
        }

        const series = await provider.getWebSeriesLatest();
        const enriched = await Promise.all(
            series.slice(0, 12).map(m => quickEnrich(m, provider.getQuickPoster))
        );

        res.json(enriched);
    } catch (error) {
        logger.error(`Web series error: ${error.message}`);
        res.status(500).json({ error: 'Failed to fetch web series' });
    }
});

/**
 * GET /api/movie/:tmdbId
 * 
 * Get movie by TMDB ID.
 */
router.get('/:tmdbId', async (req, res) => {
    const { tmdbId } = req.params;

    try {
        // Check database cache
        const { data: cached } = await supabase
            .from('unified_movies')
            .select('*')
            .eq('tmdb_id', parseInt(tmdbId))
            .maybeSingle();

        if (cached && cached.download_links?.length > 0) {
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
                    cast: cached.cast || [],
                    director: cached.director,
                    trailer: cached.trailer_key,
                    language_type: cached.language_type,
                    watch_links: cached.watch_links || [],
                    download_links: cached.download_links || []
                }
            });
        }

        // Try TMDB directly
        const fullDetails = await getFullMovieDetails(parseInt(tmdbId));
        if (fullDetails) {
            return res.json({
                source: 'tmdb',
                movie: fullDetails
            });
        }

        res.status(404).json({
            error: 'Movie not found',
            tmdb_id: tmdbId
        });

    } catch (error) {
        logger.error(`Movie detail error: ${error.message}`);
        res.status(500).json({ error: 'Failed to fetch movie details' });
    }
});

export default router;
