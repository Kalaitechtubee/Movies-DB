/**
 * Content Types Module
 * Unified content type definitions and detection logic
 */

/**
 * Content type enumeration
 */
export const ContentType = {
    MOVIE: 'movie',
    SERIES: 'series',
    WEBSERIES: 'webseries',
    UNKNOWN: 'unknown'
};

/**
 * Language type enumeration
 */
export const LanguageType = {
    TAMIL: 'tamil',
    TAMIL_DUBBED: 'tamil_dubbed',
    TELUGU: 'telugu',
    HINDI: 'hindi',
    MALAYALAM: 'malayalam',
    KANNADA: 'kannada',
    ENGLISH: 'english',
    UNKNOWN: 'unknown'
};

/**
 * TMDB match status
 */
export const TMDBStatus = {
    MATCHED: 'matched',
    PENDING: 'pending',
    NOT_FOUND: 'not_found',
    FAILED: 'failed'
};

/**
 * Detect content type from title and URL
 * @param {Object} item - Content item with title and url
 * @returns {string} Content type
 */
export function detectContentType(item) {
    const title = (item.title || '').toLowerCase();
    const url = (item.url || '').toLowerCase();
    const resolutions = item.resolutions || [];

    // Series indicators
    const seriesPatterns = [
        /web[\s-]?series/i,
        /season\s?\d/i,
        /s\d{1,2}[\s]?e\d{1,2}/i,
        /episode\s?\d/i,
        /epi?\s?\d/i,
        /day\s?\d/i,
        /part\s?\d+\s?of\s?\d+/i
    ];

    // Check title and URL for series patterns
    for (const pattern of seriesPatterns) {
        if (pattern.test(title) || pattern.test(url)) {
            return ContentType.SERIES;
        }
    }

    // Check URL paths
    if (url.includes('/web-series') || url.includes('/webseries') || url.includes('/45/')) {
        return ContentType.WEBSERIES;
    }

    // Check resolutions for episode patterns
    if (resolutions.length > 0) {
        const hasEpisodes = resolutions.some(r => {
            const name = (r.name || '').toLowerCase();
            return /epi|episode|day|part|s\d+e\d+/i.test(name);
        });
        if (hasEpisodes) {
            return ContentType.SERIES;
        }
    }

    return ContentType.MOVIE;
}

/**
 * Detect language from title and source
 * @param {Object} item - Content item
 * @returns {string} Language type
 */
export function detectLanguage(item) {
    const title = (item.title || '').toLowerCase();
    const source = (item.source || '').toLowerCase();

    // Dubbed content detection
    if (title.includes('dubbed') || source === 'isaidub') {
        return LanguageType.TAMIL_DUBBED;
    }

    // Language detection from title
    const languageMap = {
        'telugu': LanguageType.TELUGU,
        'hindi': LanguageType.HINDI,
        'malayalam': LanguageType.MALAYALAM,
        'kannada': LanguageType.KANNADA,
        'english': LanguageType.ENGLISH,
        'tamil': LanguageType.TAMIL
    };

    for (const [keyword, langType] of Object.entries(languageMap)) {
        if (title.includes(keyword)) {
            return langType;
        }
    }

    // Default to Tamil for Moviesda content
    return LanguageType.TAMIL;
}

/**
 * Create a unified content object
 * @param {Object} raw - Raw scraped data
 * @param {string} providerId - Provider that scraped this
 * @returns {Object} Unified content object
 */
export function createUnifiedContent(raw, providerId) {
    return {
        // Identity
        title: raw.title || '',
        url: raw.url || '',
        source: providerId,

        // Classification
        content_type: detectContentType(raw),
        language_type: detectLanguage(raw),

        // Metadata
        year: raw.year || null,
        quality: raw.quality || 'DVD/HD',
        poster_url: raw.poster || raw.poster_url || null,
        synopsis: raw.synopsis || null,

        // TMDB matching
        tmdb_id: null,
        tmdb_status: TMDBStatus.PENDING,
        confidence_score: 0,

        // Links
        resolutions: raw.resolutions || [],
        download_links: [],
        watch_links: [],

        // Timestamps
        scraped_at: new Date().toISOString(),
        last_updated: new Date().toISOString()
    };
}
