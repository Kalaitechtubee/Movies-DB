/**
 * Provider Template - Main Entry Point
 * 
 * 📋 STEPS TO CREATE A NEW PROVIDER:
 * 
 * 1. Copy this entire _template folder to providers/newsite/
 * 2. Update config.js with site details
 * 3. Implement scraper.js (page fetching, parsing)
 * 4. Implement parser.js (movie details extraction)
 * 5. Update this index.js with proper exports
 * 6. Register in core/providerManager.js:
 *    
 *    import newsite from '../providers/newsite/index.js';
 *    providers.push(newsite);
 * 
 * That's it! Your new provider will work with the entire system.
 */

import config from './config.js';
import { fetchPage, scrapeAllPages } from './scraper.js';
import { parseMovieDetails, getQuickPoster } from './parser.js';

/**
 * Get latest updates from homepage
 * 
 * ✏️ IMPLEMENT based on site structure
 */
async function getLatest() {
    const $ = await fetchPage(config.baseUrl);
    if (!$) return [];

    const movies = [];

    // TODO: Extract latest movies from homepage
    // $('.latest-item').each((_, el) => {
    //     movies.push({
    //         title: $(el).find('.title').text(),
    //         url: $(el).find('a').attr('href'),
    //         year: 'Unknown',
    //         quality: 'HD',
    //         source: config.id
    //     });
    // });

    return movies;
}

/**
 * Search for movies
 * 
 * ✏️ IMPLEMENT based on site's search functionality
 */
async function search(query) {
    const results = [];

    // TODO: Implement search
    // Option 1: If site has search API
    // const searchUrl = `${config.baseUrl}/search?q=${encodeURIComponent(query)}`;
    // const $ = await fetchPage(searchUrl);
    // Extract results...

    // Option 2: Scrape categories and filter
    // const movies = await scrapeAllPages(`${config.baseUrl}/movies/`, 5);
    // return movies.filter(m => fuzzyMatch(m.title, query));

    return results;
}

/**
 * Check provider health
 */
async function isHealthy() {
    try {
        const $ = await fetchPage(config.baseUrl);
        return $ !== null;
    } catch {
        return false;
    }
}

/**
 * The Provider Interface
 * 
 * ⚠️ DO NOT CHANGE THE STRUCTURE - this is what ProviderManager expects!
 */
export default {
    // Required properties
    id: config.id,
    name: config.name,
    supports: config.supports,
    languages: config.languages,

    // Configuration
    config,

    // Required methods
    getLatest,          // Get latest content
    search,             // Search for content
    scrapeDetails: parseMovieDetails,  // Get full details

    // Optional methods
    getQuickPoster,     // Quick poster fetch
    isHealthy           // Health check
};
