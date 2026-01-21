/**
 * Provider Types & Interfaces
 * Defines the contract that all scrapers must follow
 * 
 * GOLDEN RULE: Every provider MUST export this interface!
 */

/**
 * @typedef {Object} ProviderConfig
 * @property {string} id - Unique provider identifier (e.g., 'moviesda', 'isaidub')
 * @property {string} name - Human-readable name
 * @property {string[]} supports - Content types: ['movie', 'tv', 'webseries']
 * @property {string[]} languages - Supported languages: ['ta', 'ta_dubbed', 'te', 'hi']
 * @property {string} baseUrl - Base URL of the site
 * @property {boolean} enabled - Whether provider is active
 * @property {number} priority - Lower = higher priority (used for ordering)
 */

/**
 * @typedef {Object} ScrapedItem
 * @property {string} title - Raw title from the site
 * @property {string} url - Full URL to the content page
 * @property {string} [year] - Year if available
 * @property {string} [poster] - Poster URL if available
 * @property {string} [quality] - Quality indicator (HD, DVD, etc.)
 * @property {string} source - Provider ID that scraped this
 */

/**
 * @typedef {Object} ContentDetails
 * @property {string} title - Cleaned title
 * @property {string} url - Content page URL
 * @property {string} type - 'movie' | 'series'
 * @property {string} [poster_url] - Poster if found
 * @property {string} [synopsis] - Description if found
 * @property {string} [quality] - Quality indicator
 * @property {Array<Resolution>} resolutions - Download options
 */

/**
 * @typedef {Object} Resolution
 * @property {string} quality - Quality label (720p, 1080p, etc.)
 * @property {string} name - File/episode name
 * @property {string} url - Link to the file page
 * @property {string} [downloadUrl] - Intermediate download URL
 * @property {string} [directUrl] - Direct file URL
 * @property {string} [watchUrl] - Streaming URL
 * @property {string} [streamSource] - Direct stream source
 * @property {string} [size] - File size
 */

/**
 * @typedef {Object} ProviderInterface
 * @property {string} id - Unique identifier
 * @property {string} name - Display name
 * @property {string[]} supports - ['movie', 'tv', 'webseries']
 * @property {string[]} languages - ['ta', 'ta_dubbed']
 * @property {Function} scrapeList - async (query?) => ScrapedItem[]
 * @property {Function} scrapeDetails - async (url, query?) => ContentDetails
 * @property {Function} getLatest - async () => ScrapedItem[]
 * @property {Function} search - async (query) => ScrapedItem[]
 * @property {Function} isHealthy - async () => boolean
 */

// Content type constants
export const CONTENT_TYPES = {
    MOVIE: 'movie',
    TV: 'tv',
    WEBSERIES: 'webseries'
};

// Language constants
export const LANGUAGES = {
    TAMIL: 'ta',
    TAMIL_DUBBED: 'ta_dubbed',
    TELUGU: 'te',
    HINDI: 'hi',
    MALAYALAM: 'ml',
    KANNADA: 'kn'
};

// Provider status
export const PROVIDER_STATUS = {
    ACTIVE: 'active',
    DISABLED: 'disabled',
    DEGRADED: 'degraded',
    DOWN: 'down'
};

/**
 * Validate that a provider implements the required interface
 * @param {Object} provider - Provider to validate
 * @returns {boolean} True if valid
 */
export function validateProvider(provider) {
    const required = ['id', 'name', 'supports', 'languages', 'scrapeDetails', 'getLatest', 'search'];

    for (const key of required) {
        if (!(key in provider)) {
            console.error(`Provider missing required property: ${key}`);
            return false;
        }
    }

    if (!Array.isArray(provider.supports) || provider.supports.length === 0) {
        console.error('Provider must support at least one content type');
        return false;
    }

    if (!Array.isArray(provider.languages) || provider.languages.length === 0) {
        console.error('Provider must support at least one language');
        return false;
    }

    return true;
}

/**
 * Create a base provider configuration
 * @param {Partial<ProviderConfig>} config - Configuration overrides
 * @returns {ProviderConfig} Complete configuration
 */
export function createProviderConfig(config) {
    return {
        id: config.id || 'unknown',
        name: config.name || 'Unknown Provider',
        supports: config.supports || [CONTENT_TYPES.MOVIE],
        languages: config.languages || [LANGUAGES.TAMIL],
        baseUrl: config.baseUrl || '',
        enabled: config.enabled !== false,
        priority: config.priority || 100
    };
}
