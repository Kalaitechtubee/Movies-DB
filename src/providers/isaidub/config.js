/**
 * isaiDub Provider Configuration
 */

export default {
    id: 'isaidub',
    name: 'isaiDub',
    baseUrl: 'https://isaidub.love',

    // Content support
    supports: ['movie', 'tv'],  // Movies and TV shows
    languages: ['ta_dubbed'],   // Tamil dubbed content

    // Provider settings
    enabled: true,
    priority: 2,  // Secondary provider

    // Scraping limits
    maxPagesPerCategory: 10,
    requestTimeout: 10000,

    // URL patterns
    patterns: {
        movie: '/movie/',
        dubbed: '/tamil-dubbed-movies/',
        latest: '/',
        year: '/tamil-dubbed-{year}/'
    },

    // Headers for requests
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Referer': 'https://isaidub.love',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Cache-Control': 'max-age=0'
    }
};
