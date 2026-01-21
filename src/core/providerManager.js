/**
 * Provider Manager - THE HEART OF THE SYSTEM 🔑
 * 
 * This is what makes the backend maintainable forever.
 * 
 * GOLDEN RULES:
 * 1. Backend does NOT know website names directly
 * 2. It only knows "providers"
 * 3. All content flows through here
 * 4. Adding a new site = adding one import
 */

import { validateProvider, PROVIDER_STATUS } from './providerTypes.js';
import logger from '../utils/logger.js';

// ============================================================================
// PROVIDER REGISTRY - Add new providers here
// ============================================================================

import moviesda from '../providers/moviesda/index.js';
import isaidub from '../providers/isaidub/index.js';

/**
 * All registered providers
 * 
 * 🚀 TO ADD A NEW SITE:
 * 1. Create the provider folder in src/providers/newsite/
 * 2. Implement the provider interface (copy from _template)
 * 3. Import and add to this array
 * 
 * Example:
 * import tamilmv from '../providers/tamilmv/index.js';
 * providers.push(tamilmv);
 */
const providers = [
    moviesda,
    isaidub
    // Future: tamilmv, tamilrockers, etc.
];

// ============================================================================
// PROVIDER STATUS TRACKING
// ============================================================================

const providerHealth = new Map();

/**
 * Initialize all providers and validate them
 */
export function initializeProviders() {
    logger.info('🔌 Initializing providers...');

    let validCount = 0;
    for (const provider of providers) {
        if (validateProvider(provider)) {
            providerHealth.set(provider.id, {
                status: PROVIDER_STATUS.ACTIVE,
                lastCheck: new Date(),
                errorCount: 0
            });
            validCount++;
            logger.info(`  ✅ ${provider.name} (${provider.id}) - Ready`);
        } else {
            providerHealth.set(provider.id, {
                status: PROVIDER_STATUS.DISABLED,
                lastCheck: new Date(),
                errorCount: 0
            });
            logger.warn(`  ❌ ${provider.name} (${provider.id}) - Invalid interface`);
        }
    }

    logger.info(`🔌 Initialized ${validCount}/${providers.length} providers`);
    return validCount;
}

// ============================================================================
// PROVIDER ACCESS METHODS
// ============================================================================

/**
 * Get all registered providers
 * @returns {Array} All providers
 */
export function getProviders() {
    return providers;
}

/**
 * Get only active/enabled providers
 * @returns {Array} Active providers
 */
export function getActiveProviders() {
    return providers.filter(p => {
        const health = providerHealth.get(p.id);
        return health?.status === PROVIDER_STATUS.ACTIVE;
    });
}

/**
 * Get a specific provider by ID
 * @param {string} id - Provider ID
 * @returns {Object|null} Provider or null
 */
export function getProvider(id) {
    return providers.find(p => p.id === id) || null;
}

/**
 * Get providers by content type
 * @param {string} contentType - 'movie', 'tv', 'webseries'
 * @returns {Array} Matching providers
 */
export function getProvidersByType(contentType) {
    return getActiveProviders().filter(p => p.supports.includes(contentType));
}

/**
 * Get providers by language
 * @param {string} language - 'ta', 'ta_dubbed', etc.
 * @returns {Array} Matching providers
 */
export function getProvidersByLanguage(language) {
    return getActiveProviders().filter(p => p.languages.includes(language));
}

// ============================================================================
// PROVIDER CONTROL METHODS
// ============================================================================

/**
 * Enable a provider
 * @param {string} id - Provider ID
 */
export function enableProvider(id) {
    const health = providerHealth.get(id);
    if (health) {
        health.status = PROVIDER_STATUS.ACTIVE;
        health.errorCount = 0;
        logger.info(`✅ Provider ${id} enabled`);
    }
}

/**
 * Disable a provider
 * @param {string} id - Provider ID
 * @param {string} reason - Reason for disabling
 */
export function disableProvider(id, reason = 'manual') {
    const health = providerHealth.get(id);
    if (health) {
        health.status = PROVIDER_STATUS.DISABLED;
        health.reason = reason;
        logger.warn(`⚠️ Provider ${id} disabled: ${reason}`);
    }
}

/**
 * Record an error for a provider
 * @param {string} id - Provider ID
 * @param {Error} error - The error
 */
export function recordProviderError(id, error) {
    const health = providerHealth.get(id);
    if (health) {
        health.errorCount++;
        health.lastError = error.message;
        health.lastErrorTime = new Date();

        // Auto-disable after 5 consecutive errors
        if (health.errorCount >= 5) {
            health.status = PROVIDER_STATUS.DEGRADED;
            logger.warn(`⚠️ Provider ${id} degraded: Too many errors (${health.errorCount})`);
        }
    }
}

/**
 * Reset error count for a provider (on successful request)
 * @param {string} id - Provider ID
 */
export function resetProviderErrors(id) {
    const health = providerHealth.get(id);
    if (health) {
        health.errorCount = 0;
        if (health.status === PROVIDER_STATUS.DEGRADED) {
            health.status = PROVIDER_STATUS.ACTIVE;
            logger.info(`✅ Provider ${id} recovered`);
        }
    }
}

// ============================================================================
// AGGREGATION METHODS (Cross-provider operations)
// ============================================================================

/**
 * Search across all active providers
 * @param {string} query - Search query
 * @returns {Promise<Array>} Combined results from all providers
 */
export async function searchAllProviders(query) {
    const activeProviders = getActiveProviders();
    logger.info(`🔍 Searching across ${activeProviders.length} providers for: "${query}"`);

    const results = await Promise.allSettled(
        activeProviders.map(async (provider) => {
            try {
                const items = await provider.search(query);
                resetProviderErrors(provider.id);
                return items.map(item => ({
                    ...item,
                    source: provider.id
                }));
            } catch (error) {
                recordProviderError(provider.id, error);
                logger.error(`❌ ${provider.id} search failed: ${error.message}`);
                return [];
            }
        })
    );

    // Flatten and deduplicate results
    const allResults = [];
    for (const result of results) {
        if (result.status === 'fulfilled') {
            allResults.push(...result.value);
        }
    }

    // Deduplicate by URL
    const uniqueResults = Array.from(
        new Map(allResults.map(item => [item.url, item])).values()
    );

    logger.info(`🔍 Found ${uniqueResults.length} unique results across all providers`);
    return uniqueResults;
}

/**
 * Get latest content from all active providers
 * @returns {Promise<Object>} Results grouped by provider
 */
export async function getLatestFromAllProviders() {
    const activeProviders = getActiveProviders();
    logger.info(`📡 Fetching latest from ${activeProviders.length} providers`);

    const results = {};

    await Promise.allSettled(
        activeProviders.map(async (provider) => {
            try {
                const items = await provider.getLatest();
                resetProviderErrors(provider.id);
                results[provider.id] = items.map(item => ({
                    ...item,
                    source: provider.id
                }));
            } catch (error) {
                recordProviderError(provider.id, error);
                logger.error(`❌ ${provider.id} latest failed: ${error.message}`);
                results[provider.id] = [];
            }
        })
    );

    return results;
}

/**
 * Get content details from the appropriate provider
 * @param {string} url - Content URL
 * @param {string} [providerId] - Optional specific provider ID
 * @returns {Promise<Object|null>} Content details
 */
export async function getDetailsFromProvider(url, providerId = null) {
    // Detect provider from URL if not specified
    if (!providerId) {
        providerId = detectProviderFromUrl(url);
    }

    const provider = getProvider(providerId);
    if (!provider) {
        logger.error(`No provider found for URL: ${url}`);
        return null;
    }

    try {
        const details = await provider.scrapeDetails(url);
        resetProviderErrors(provider.id);
        return {
            ...details,
            source: provider.id
        };
    } catch (error) {
        recordProviderError(provider.id, error);
        logger.error(`❌ Failed to get details from ${provider.id}: ${error.message}`);
        return null;
    }
}

/**
 * Detect which provider a URL belongs to
 * @param {string} url - The URL to check
 * @returns {string|null} Provider ID or null
 */
export function detectProviderFromUrl(url) {
    const urlLower = url.toLowerCase();

    for (const provider of providers) {
        const baseUrl = provider.config?.baseUrl?.toLowerCase() || '';
        if (baseUrl && urlLower.includes(new URL(baseUrl).hostname)) {
            return provider.id;
        }

        // Fallback: check by provider ID in URL
        if (urlLower.includes(provider.id)) {
            return provider.id;
        }
    }

    // Default detection based on known patterns
    if (urlLower.includes('moviesda')) return 'moviesda';
    if (urlLower.includes('isaidub')) return 'isaidub';

    return null;
}

// ============================================================================
// HEALTH CHECK
// ============================================================================

/**
 * Get health status of all providers
 * @returns {Object} Health status map
 */
export function getProvidersHealth() {
    const health = {};

    for (const provider of providers) {
        const status = providerHealth.get(provider.id) || {
            status: PROVIDER_STATUS.DISABLED,
            lastCheck: null,
            errorCount: 0
        };

        health[provider.id] = {
            name: provider.name,
            supports: provider.supports,
            languages: provider.languages,
            ...status
        };
    }

    return health;
}

/**
 * Run health check on all providers
 * @returns {Promise<Object>} Health check results
 */
export async function runHealthCheck() {
    logger.info('🏥 Running provider health check...');

    const results = {};

    for (const provider of providers) {
        try {
            const isHealthy = await provider.isHealthy?.() ?? true;

            if (isHealthy) {
                enableProvider(provider.id);
                results[provider.id] = { healthy: true };
            } else {
                disableProvider(provider.id, 'Health check failed');
                results[provider.id] = { healthy: false, reason: 'Health check returned false' };
            }
        } catch (error) {
            disableProvider(provider.id, error.message);
            results[provider.id] = { healthy: false, reason: error.message };
        }
    }

    logger.info('🏥 Health check complete');
    return results;
}

// Initialize on module load
initializeProviders();

export default {
    getProviders,
    getActiveProviders,
    getProvider,
    getProvidersByType,
    getProvidersByLanguage,
    enableProvider,
    disableProvider,
    searchAllProviders,
    getLatestFromAllProviders,
    getDetailsFromProvider,
    detectProviderFromUrl,
    getProvidersHealth,
    runHealthCheck
};
