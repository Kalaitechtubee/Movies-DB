/**
 * Search Utilities
 * Helper functions for fuzzy search and string matching
 */

/**
 * Calculate Levenshtein Distance between two strings
 * @param {string} a - First string
 * @param {string} b - Second string
 * @returns {number} Distance
 */
export const getLevenshteinDistance = (a, b) => {
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;

    const matrix = [];

    // Increment along the first column of each row
    for (let i = 0; i <= b.length; i++) {
        matrix[i] = [i];
    }

    // Increment each column in the first row
    for (let j = 0; j <= a.length; j++) {
        matrix[0][j] = j;
    }

    // Fill in the rest of the matrix
    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            if (b.charAt(i - 1) === a.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1, // substitution
                    Math.min(
                        matrix[i][j - 1] + 1, // insertion
                        matrix[i - 1][j] + 1 // deletion
                    )
                );
            }
        }
    }

    return matrix[b.length][a.length];
};

/**
 * Fuzzy match a string against a query
 * @param {string} text - Text to search in (e.g., movie title)
 * @param {string} query - Search query
 * @param {Object} options - Options
 * @param {number} options.threshold - Max allowed distance (default: 3)
 * @param {boolean} options.matchPartial - Whether to allow partial matches (default: true)
 * @returns {boolean} True if matched
 */
export const fuzzyMatch = (text, query, { threshold = 3, matchPartial = true } = {}) => {
    if (!text || !query) return false;

    const normalizedText = text.toLowerCase();
    const normalizedQuery = query.toLowerCase();

    // 1. Exact substring match (fastest)
    if (matchPartial && normalizedText.includes(normalizedQuery)) {
        return true;
    }

    // 2. Levenshtein distance
    // Normalize threshold based on query length (allow more errors for longer queries)
    const adaptiveThreshold = Math.min(threshold, Math.floor(query.length / 2));

    const distance = getLevenshteinDistance(normalizedText, normalizedQuery);
    if (distance <= adaptiveThreshold) {
        return true;
    }

    // 3. Word-based matching (for "Amaran" -> "Amaran Movie")
    const textWords = normalizedText.split(/\s+/);
    const queryWords = normalizedQuery.split(/\s+/);

    // If any word in the query is close to any word in the text
    for (const qWord of queryWords) {
        if (qWord.length < 3) continue; // Skip short words
        for (const tWord of textWords) {
            if (getLevenshteinDistance(tWord, qWord) <= 1) {
                return true;
            }
        }
    }

    return false;
};
