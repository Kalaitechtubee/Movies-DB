/**
 * Confidence Score Calculator
 * 
 * Determines how confident we are that a scraped movie
 * matches a TMDB result.
 */

import { normalizeForComparison } from './normalizeTitle.js';

/**
 * Calculate Levenshtein distance between two strings
 * @param {string} a - First string
 * @param {string} b - Second string
 * @returns {number} Edit distance
 */
function levenshteinDistance(a, b) {
    const matrix = [];

    for (let i = 0; i <= b.length; i++) {
        matrix[i] = [i];
    }

    for (let j = 0; j <= a.length; j++) {
        matrix[0][j] = j;
    }

    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            if (b.charAt(i - 1) === a.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1,  // substitution
                    matrix[i][j - 1] + 1,      // insertion
                    matrix[i - 1][j] + 1       // deletion
                );
            }
        }
    }

    return matrix[b.length][a.length];
}

/**
 * Calculate similarity ratio between two strings
 * @param {string} a - First string
 * @param {string} b - Second string
 * @returns {number} Similarity between 0 and 1
 */
function similarityRatio(a, b) {
    const normA = normalizeForComparison(a);
    const normB = normalizeForComparison(b);

    if (normA === normB) return 1;
    if (!normA || !normB) return 0;

    const distance = levenshteinDistance(normA, normB);
    const maxLen = Math.max(normA.length, normB.length);

    return 1 - (distance / maxLen);
}

/**
 * Calculate confidence score for a TMDB match
 * 
 * @param {string} scrapedTitle - Title from scraper
 * @param {string} tmdbTitle - Title from TMDB
 * @param {Object} tmdbData - Full TMDB data (for year, popularity checks)
 * @param {string} [scrapedYear] - Year from scraper (if known)
 * @returns {number} Confidence score 0-100
 */
export function calculateConfidence(scrapedTitle, tmdbTitle, tmdbData = {}, scrapedYear = null) {
    let score = 0;

    // 1. Title similarity (up to 60 points)
    const titleSimilarity = similarityRatio(scrapedTitle, tmdbTitle);
    score += Math.round(titleSimilarity * 60);

    // 2. Year match (up to 20 points)
    if (scrapedYear && tmdbData) {
        const tmdbYear = tmdbData.release_date?.split('-')[0] ||
            tmdbData.first_air_date?.split('-')[0];

        if (tmdbYear) {
            const yearDiff = Math.abs(parseInt(scrapedYear) - parseInt(tmdbYear));

            if (yearDiff === 0) {
                score += 20;  // Exact match
            } else if (yearDiff === 1) {
                score += 15;  // One year off (common)
            } else if (yearDiff === 2) {
                score += 10;  // Two years off
            }
        }
    }

    // 3. Popularity boost (up to 10 points)
    if (tmdbData.popularity) {
        if (tmdbData.popularity > 100) {
            score += 10;
        } else if (tmdbData.popularity > 50) {
            score += 7;
        } else if (tmdbData.popularity > 10) {
            score += 5;
        } else {
            score += 2;
        }
    }

    // 4. Vote count reliability (up to 10 points)
    if (tmdbData.vote_count) {
        if (tmdbData.vote_count > 1000) {
            score += 10;
        } else if (tmdbData.vote_count > 100) {
            score += 7;
        } else if (tmdbData.vote_count > 10) {
            score += 4;
        }
    }

    // 5. Exact title match bonus
    if (normalizeForComparison(scrapedTitle) === normalizeForComparison(tmdbTitle)) {
        score = Math.min(100, score + 10);
    }

    // Cap at 100
    return Math.min(100, Math.max(0, score));
}

/**
 * Check if a match is reliable enough
 * @param {number} confidence - Confidence score
 * @param {string} matchType - 'exact', 'fuzzy', 'year'
 * @returns {boolean} Whether match is reliable
 */
export function isReliableMatch(confidence, matchType = 'fuzzy') {
    const thresholds = {
        exact: 50,   // Lower threshold for exact matches
        fuzzy: 60,   // Standard threshold
        year: 70     // Higher threshold for year-based matches
    };

    return confidence >= (thresholds[matchType] || 60);
}

/**
 * Get match quality label
 * @param {number} confidence - Confidence score
 * @returns {string} Quality label
 */
export function getMatchQuality(confidence) {
    if (confidence >= 90) return 'excellent';
    if (confidence >= 75) return 'good';
    if (confidence >= 60) return 'fair';
    if (confidence >= 40) return 'poor';
    return 'unreliable';
}

export default {
    calculateConfidence,
    similarityRatio,
    isReliableMatch,
    getMatchQuality
};
