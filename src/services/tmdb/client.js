/**
 * TMDB API Client
 * 
 * Handles all TMDB API interactions.
 * This is a pure client - no scraping logic here.
 */

import axios from 'axios';

const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p';

import { TMDB_API_KEY } from '../../config.js';

// API key from configuration
const API_KEY = TMDB_API_KEY;

// Axios instance with defaults
const tmdbApi = axios.create({
    baseURL: TMDB_BASE_URL,
    params: {
        api_key: API_KEY,
        language: 'en-US',
        include_adult: false
    },
    timeout: 20000, // 20 seconds
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json'
    }
});

// Retry logic with backoff
tmdbApi.interceptors.response.use(null, async (error) => {
    const config = error.config;
    if (!config || !config.retry) config.retry = 0;

    const MAX_RETRIES = 3;
    const shouldRetry = error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT' || (error.response?.status >= 500);

    if (shouldRetry && config.retry < MAX_RETRIES) {
        config.retry++;
        const delay = Math.pow(2, config.retry) * 1000 + Math.random() * 1000;
        console.warn(`TMDB request failed (${error.code || error.response?.status}), retrying in ${Math.round(delay)}ms... (Attempt ${config.retry})`);
        await new Promise(resolve => setTimeout(resolve, delay));
        return tmdbApi(config);
    }
    return Promise.reject(error);
});

// Simple in-memory cache
const cache = new Map();
const CACHE_TTL = 3600000; // 1 hour

/**
 * Get from cache or make request
 */
async function cachedRequest(cacheKey, requestFn) {
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.time < CACHE_TTL) {
        return cached.data;
    }

    const data = await requestFn();
    cache.set(cacheKey, { data, time: Date.now() });
    return data;
}

/**
 * Search for a movie or TV show
 * @param {string} query - Search query
 * @param {string} type - 'movie' or 'tv'
 * @param {string} [year] - Optional year filter
 * @param {string} [language] - Optional language code (e.g. 'ta', 'en-US')
 * @returns {Promise<Object|null>} Best match or null
 */
export async function search(query, type = 'movie', year = null, language = 'en-US') {
    if (!API_KEY) {
        console.warn('TMDB API key not configured');
        return null;
    }

    const cacheKey = `search:${type}:${query}:${year}:${language}`;

    try {
        return await cachedRequest(cacheKey, async () => {
            const params = { query, language };
            if (year) {
                params[type === 'movie' ? 'year' : 'first_air_date_year'] = year;
            }

            const response = await tmdbApi.get(`/search/${type}`, { params });
            const results = response.data.results || [];

            if (results.length === 0) return null;

            // Return the best match (first result usually most relevant)
            return results[0];
        });
    } catch (error) {
        if (error.code === 'ECONNRESET') {
            console.error(`TMDB search failed (ECONNRESET): Please check your internet connection or proxy settings.`);
        } else {
            console.error(`TMDB search failed: ${error.message}`);
        }
        return null;
    }
}

/**
 * Get movie or TV show details
 * @param {number} id - TMDB ID
 * @param {string} type - 'movie' or 'tv'
 * @returns {Promise<Object|null>} Full details or null
 */
export async function getDetails(id, type = 'movie') {
    if (!API_KEY || !id) return null;

    const cacheKey = `details:${type}:${id}`;

    try {
        return await cachedRequest(cacheKey, async () => {
            const response = await tmdbApi.get(`/${type}/${id}`, {
                params: {
                    append_to_response: 'credits,videos,translations'
                }
            });
            return response.data;
        });
    } catch (error) {
        console.error(`TMDB details failed for ${type}/${id}: ${error.message}`);
        return null;
    }
}

/**
 * Get movie credits (cast and crew)
 * @param {number} id - TMDB ID
 * @param {string} type - 'movie' or 'tv'
 * @returns {Promise<Object|null>} Credits or null
 */
export async function getCredits(id, type = 'movie') {
    if (!API_KEY || !id) return null;

    const cacheKey = `credits:${type}:${id}`;

    try {
        return await cachedRequest(cacheKey, async () => {
            const response = await tmdbApi.get(`/${type}/${id}/credits`);
            return response.data;
        });
    } catch (error) {
        console.error(`TMDB credits failed: ${error.message}`);
        return null;
    }
}

/**
 * Get videos (trailers, teasers)
 * @param {number} id - TMDB ID
 * @param {string} type - 'movie' or 'tv'
 * @returns {Promise<Array>} Videos array
 */
export async function getVideos(id, type = 'movie') {
    if (!API_KEY || !id) return [];

    const cacheKey = `videos:${type}:${id}`;

    try {
        return await cachedRequest(cacheKey, async () => {
            const response = await tmdbApi.get(`/${type}/${id}/videos`);
            return response.data.results || [];
        });
    } catch (error) {
        console.error(`TMDB videos failed: ${error.message}`);
        return [];
    }
}

/**
 * Get trending content
 * @param {string} type - 'movie', 'tv', or 'all'
 * @param {string} window - 'day' or 'week'
 * @returns {Promise<Array>} Trending items
 */
export async function getTrending(type = 'movie', window = 'week') {
    if (!API_KEY) return [];

    const cacheKey = `trending:${type}:${window}`;

    try {
        return await cachedRequest(cacheKey, async () => {
            const response = await tmdbApi.get(`/trending/${type}/${window}`);
            return response.data.results || [];
        });
    } catch (error) {
        console.error(`TMDB trending failed: ${error.message}`);
        return [];
    }
}

/**
 * Get poster URL
 * @param {string} posterPath - TMDB poster path
 * @param {string} size - w92, w154, w185, w342, w500, w780, original
 * @returns {string|null} Full poster URL
 */
export function getPosterUrl(posterPath, size = 'w500') {
    if (!posterPath) return null;
    return `${TMDB_IMAGE_BASE}/${size}${posterPath}`;
}

/**
 * Get backdrop URL
 * @param {string} backdropPath - TMDB backdrop path
 * @param {string} size - w300, w780, w1280, original
 * @returns {string|null} Full backdrop URL
 */
export function getBackdropUrl(backdropPath, size = 'original') {
    if (!backdropPath) return null;
    return `${TMDB_IMAGE_BASE}/${size}${backdropPath}`;
}

/**
 * Get trailer key (YouTube)
 * @param {number} id - TMDB ID
 * @param {string} type - 'movie' or 'tv'
 * @returns {Promise<string|null>} YouTube video key
 */
export async function getTrailerKey(id, type = 'movie') {
    const videos = await getVideos(id, type);

    // Find official trailer
    const trailer = videos.find(v =>
        v.type === 'Trailer' && v.site === 'YouTube'
    ) || videos.find(v =>
        v.type === 'Teaser' && v.site === 'YouTube'
    );

    return trailer?.key || null;
}

/**
 * Check if TMDB API is configured and working
 * @returns {Promise<boolean>} Health status
 */
export async function isHealthy() {
    if (!API_KEY) return false;

    try {
        const response = await tmdbApi.get('/configuration');
        return response.status === 200;
    } catch {
        return false;
    }
}

/**
 * Clear the cache
 */
export function clearCache() {
    cache.clear();
}

export default {
    search,
    getDetails,
    getCredits,
    getVideos,
    getTrending,
    getPosterUrl,
    getBackdropUrl,
    getTrailerKey,
    isHealthy,
    clearCache
};
