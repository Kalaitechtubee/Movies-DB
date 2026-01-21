/**
 * Title Normalization - For accurate TMDB matching
 * 
 * Cleans up movie titles scraped from various sites
 * to maximize TMDB search accuracy.
 */

/**
 * Patterns to remove from titles
 */
const REMOVAL_PATTERNS = [
    // Download/streaming indicators
    /tamil\s*(movie\s*)?(download)?/gi,
    /tamil\s*dubbed/gi,
    /web\s*series/gi,
    /download/gi,
    /free\s*download/gi,
    /(full\s*)?hd\s*(movie)?/gi,
    /hdtv(rip)?/gi,
    /web-?rip/gi,
    /blu-?ray/gi,
    /dvd-?rip/gi,
    /hd-?rip/gi,
    /cam-?rip/gi,

    // Quality indicators (but keep for reference)
    /\d{3,4}p/gi,  // 720p, 1080p, etc.
    /\d{3,4}x\d{3,4}/gi,  // 1920x1080

    // Language tags
    /\[?(tamil|telugu|hindi|mal(ayalam)?|kannada|eng(lish)?)\]?/gi,

    // Site names
    /moviesda/gi,
    /isaidub/gi,
    /tamilmv/gi,
    /tamilrockers/gi,

    // Brackets with years or info
    /\(\d{4}\)/g,  // (2024)
    /\[\d{4}\]/g,  // [2024]
    /\(\d{4}-\d{2}-\d{2}\)/g,  // (2024-01-15)

    // Quality/size in brackets
    /\[.*?mb\]/gi,
    /\[.*?gb\]/gi,
    /\[hd\]/gi,
    /\[sd\]/gi,

    // Episode markers (for series matching)
    /\s*-?\s*s\d+\s*e\d+/gi,  // S01E01
    /\s*-?\s*season\s*\d+/gi,
    /\s*-?\s*episode\s*\d+/gi,

    // Common suffixes
    /latest/gi,
    /new/gi,
    /official/gi,
    /\s+-?\s*(full\s*)?movie\s*$/gi
];

/**
 * Words that should not be fully removed
 * (important for unique movie titles)
 */
const PROTECTED_WORDS = ['the', 'a', 'an', 'of', 'in', 'on', 'at', 'to', 'for'];

/**
 * Normalize a title for TMDB matching
 * @param {string} title - Raw title from scraper
 * @returns {string} Normalized title
 */
export function normalizeTitle(title) {
    if (!title) return '';

    let normalized = title.trim();

    // Apply removal patterns
    for (const pattern of REMOVAL_PATTERNS) {
        normalized = normalized.replace(pattern, ' ');
    }

    // Clean up whitespace
    normalized = normalized
        .replace(/\s+/g, ' ')          // Multiple spaces to single
        .replace(/\s*-\s*$/g, '')      // Trailing dash
        .replace(/^\s*-\s*/g, '')      // Leading dash
        .replace(/\s*:\s*$/g, '')      // Trailing colon
        .replace(/\s*\.\s*$/g, '')     // Trailing dot
        .trim();

    // Handle special characters
    normalized = normalized
        .replace(/–/g, '-')            // Em dash to hyphen
        .replace(/'/g, "'")            // Smart quotes to regular
        .replace(/"/g, '"')
        .replace(/[_]/g, ' ');         // Underscores to spaces

    return normalized;
}

/**
 * Extract year from a title string
 * @param {string} title - Title that might contain year
 * @returns {{title: string, year: string|null}} Title without year and extracted year
 */
export function extractYearFromTitle(title) {
    const yearMatch = title.match(/\((\d{4})\)/) ||
        title.match(/\[(\d{4})\]/) ||
        title.match(/\s(\d{4})$/);

    if (yearMatch) {
        const year = yearMatch[1];
        const yearNum = parseInt(year);

        // Validate it's a reasonable year (1900-2030)
        if (yearNum >= 1900 && yearNum <= 2030) {
            return {
                title: title.replace(yearMatch[0], '').trim(),
                year
            };
        }
    }

    return { title, year: null };
}

/**
 * Normalize for fuzzy comparison
 * More aggressive normalization for matching purposes
 * @param {string} title - Title to normalize
 * @returns {string} Heavily normalized string
 */
export function normalizeForComparison(title) {
    return title
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, '')  // Remove non-alphanumeric
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Clean a movie title for display purposes
 * Less aggressive than normalizeTitle
 * @param {string} title - Raw title
 * @returns {string} Clean display title
 */
export function cleanDisplayTitle(title) {
    if (!title) return '';

    return title
        .replace(/Tamil Movie Download/gi, '')
        .replace(/Tamil Movie/gi, '')
        .replace(/Tamil Dubbed/gi, '')
        .replace(/Tamil Web Series/gi, '')
        .replace(/Web Series/gi, '')
        .replace(/Latest/gi, '')
        .replace(/Download/gi, '')
        .replace(/\(\d{4}\)/g, '')
        .replace(/\d{4}/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

export default {
    normalizeTitle,
    extractYearFromTitle,
    normalizeForComparison,
    cleanDisplayTitle
};
