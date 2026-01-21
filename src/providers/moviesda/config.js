/**
 * Moviesda Provider Configuration
 */

export default {
    id: 'moviesda',
    name: 'Moviesda',
    baseUrl: 'https://moviesda15.com',

    // Content support
    supports: ['movie', 'tv', 'webseries'],
    languages: ['ta'],  // Tamil original only

    // Provider settings
    enabled: true,
    priority: 1,  // Primary provider

    // Scraping limits
    maxPagesPerCategory: 15,
    maxPagesPerYear: 10,
    requestTimeout: 10000,

    // URL patterns
    patterns: {
        movie: '/tamil-movies/',
        webseries: '/tamil-web-series-download/',
        latest: '/tamil-latest-updates/',
        year: '/tamil-{year}-movies/'
    },

    // Headers for requests
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Referer': 'https://moviesda15.com',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Cache-Control': 'max-age=0'
    }
};
