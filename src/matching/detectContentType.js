/**
 * Content Type Detection
 * 
 * Determines if content is a movie, series, or web series
 * based on title, URL, and other metadata.
 */

import { ContentType } from '../core/contentTypes.js';

/**
 * Series detection patterns
 */
const SERIES_PATTERNS = {
    title: [
        /web[\s-]?series/i,
        /season\s*\d/i,
        /s\d{1,2}[\s]?e\d{1,2}/i,
        /\bS\d{1,2}\b/i,
        /episode\s*\d/i,
        /epi?\s*\d+/i,
        /day\s*\d+/i,
        /week\s*\d+/i,
        /part\s*\d+\s*of\s*\d+/i,
        /chapter\s*\d+/i,
        /\bE\d{1,3}\b/i,
        /\bep\d{1,3}\b/i
    ],
    url: [
        /\/web-series/i,
        /\/webseries/i,
        /\/tv-show/i,
        /\/series\//i,
        /\/45\//  // Common web series category ID
    ]
};

/**
 * Movie patterns (to override false positives)
 */
const MOVIE_PATTERNS = {
    title: [
        /\bpart\s*[12]\b/i,  // Part 1, Part 2 are often movies
        /\bmovie\b/i
    ]
};

/**
 * Detect content type from item
 * @param {Object} item - Content item with title, url, resolutions
 * @returns {{type: string, confidence: number}} Detected type and confidence
 */
export function detectContentType(item) {
    const title = (item.title || '').toLowerCase();
    const url = (item.url || '').toLowerCase();
    const resolutions = item.resolutions || [];

    let seriesScore = 0;
    let movieScore = 0;

    // Check title patterns
    for (const pattern of SERIES_PATTERNS.title) {
        if (pattern.test(title)) {
            seriesScore += 30;
        }
    }

    // Check URL patterns
    for (const pattern of SERIES_PATTERNS.url) {
        if (pattern.test(url)) {
            seriesScore += 25;
        }
    }

    // Check resolutions/episodes
    if (resolutions.length > 0) {
        const episodeCount = resolutions.filter(r => {
            const name = (r.name || '').toLowerCase();
            return /epi|episode|day|s\d+e\d+|e\d+/i.test(name);
        }).length;

        if (episodeCount >= 3) {
            seriesScore += 40;  // Multiple episodes = definitely series
        } else if (episodeCount >= 1) {
            seriesScore += 20;
        }
    }

    // Check movie patterns (to reduce false positives)
    for (const pattern of MOVIE_PATTERNS.title) {
        if (pattern.test(title)) {
            movieScore += 15;
        }
    }

    // Determine type
    if (seriesScore > movieScore && seriesScore >= 25) {
        const isWebSeries = url.includes('web-series') ||
            url.includes('webseries') ||
            title.includes('web series');

        return {
            type: isWebSeries ? ContentType.WEBSERIES : ContentType.SERIES,
            confidence: Math.min(100, seriesScore)
        };
    }

    return {
        type: ContentType.MOVIE,
        confidence: Math.min(100, 60 + movieScore)
    };
}

/**
 * Check if content is a series
 * @param {Object} item - Content item
 * @returns {boolean} True if series
 */
export function isSeries(item) {
    const result = detectContentType(item);
    return result.type === ContentType.SERIES || result.type === ContentType.WEBSERIES;
}

/**
 * Check if content is a movie
 * @param {Object} item - Content item
 * @returns {boolean} True if movie
 */
export function isMovie(item) {
    const result = detectContentType(item);
    return result.type === ContentType.MOVIE;
}

/**
 * Get TMDB search type
 * @param {Object} item - Content item
 * @returns {'movie' | 'tv'} TMDB API type
 */
export function getTMDBSearchType(item) {
    return isSeries(item) ? 'tv' : 'movie';
}

export default {
    detectContentType,
    isSeries,
    isMovie,
    getTMDBSearchType
};
