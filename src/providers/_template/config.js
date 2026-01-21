/**
 * Provider Template Configuration
 * 
 * 📋 COPY THIS FOLDER to create a new provider!
 * 
 * Steps to add a new site:
 * 1. Copy this _template folder to providers/newsite/
 * 2. Rename files and update this config
 * 3. Implement the scraper.js and parser.js
 * 4. Register in providerManager.js
 */

export default {
    // ✏️ Change these values
    id: 'template',                    // Unique ID (lowercase, no spaces)
    name: 'Template Provider',         // Display name
    baseUrl: 'https://example.com',    // Base URL of the site

    // Content types this provider supports
    // Options: 'movie', 'tv', 'webseries'
    supports: ['movie'],

    // Languages this provider offers
    // Options: 'ta' (Tamil), 'ta_dubbed' (Tamil Dubbed), 'te', 'hi', 'ml', 'kn'
    languages: ['ta'],

    // Provider settings
    enabled: true,       // Set to false to disable
    priority: 100,       // Lower = higher priority (1 = highest)

    // Scraping limits
    maxPagesPerCategory: 10,
    requestTimeout: 10000,

    // URL patterns (site-specific)
    patterns: {
        movie: '/movies/',
        latest: '/latest/',
        search: '/search?q={query}'
    },

    // Headers for requests
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5'
    }
};
