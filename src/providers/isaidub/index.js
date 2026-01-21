/**
 * isaiDub Provider - Main Entry Point
 * 
 * Implements the standardized provider interface for isaiDub.
 * Specializes in Tamil dubbed movies.
 */

import config from './config.js';
import { fetchPage, scrapeAllPages } from './scraper.js';
import { parseMovieDetails, getQuickPoster } from './parser.js';
import { cleanDisplayTitle } from '../../matching/normalizeTitle.js';

/**
 * Fuzzy match helper
 */
function fuzzyMatch(title, query) {
    const titleLower = (title || '').toLowerCase().replace(/[^a-z0-9\s]/g, '');
    const queryLower = (query || '').toLowerCase().replace(/[^a-z0-9\s]/g, '');

    if (!queryLower) return true;

    const queryWords = queryLower.split(/\s+/).filter(w => w.length > 1);
    return queryWords.every(word => titleLower.includes(word));
}

/**
 * Get latest updates from isaiDub homepage
 */
async function getLatest() {
    const $ = await fetchPage(config.baseUrl);
    if (!$) return [];

    const movies = [];
    // Find the "Latest Updates" section
    const latestHeading = $('.line:contains("Latest Updates")');
    const updateContainer = latestHeading.length ? latestHeading.nextAll('.f') : $('.f');

    updateContainer.each((_, el) => {
        const $el = $(el);
        const link = $el.find('a[href*="/movie/"]').first();
        if (!link.length) return;

        const href = link.attr('href');

        // Extract title: check strong, b, or the link itself
        let title = $el.find('strong').first().text().trim() ||
            $el.find('b').first().text().trim() ||
            link.text().trim();

        // If title is generic, try to get text from the container
        if (title.toLowerCase().includes('download now') || title.length < 3) {
            title = $el.text().replace(/Download Now/i, '').split('\n')[0].trim();
        }

        const isTamil = title.toLowerCase().includes('tamil') || href.toLowerCase().includes('tamil');
        const posterEl = $el.find('img').first();
        const homepagePoster = posterEl.length ? posterEl.attr('src') : null;
        let fullPosterUrl = null;

        if (homepagePoster && !homepagePoster.includes('dir.gif') && !homepagePoster.includes('folder')) {
            fullPosterUrl = homepagePoster.startsWith('http') ? homepagePoster : `${config.baseUrl}${homepagePoster.startsWith('/') ? '' : '/'}${homepagePoster}`;
        }

        if (title && isTamil && !title.toLowerCase().includes('download') && !title.includes('Collection') && !title.includes('Updates')) {
            const fullUrl = href.startsWith('http') ? href : `${config.baseUrl}${href.startsWith('/') ? '' : '/'}${href}`;
            const yearMatch = title.match(/\((\d{4})\)/) || title.match(/\s(\d{4})\b/);

            movies.push({
                title: cleanDisplayTitle(title),
                url: fullUrl,
                poster: fullPosterUrl,
                year: yearMatch ? yearMatch[1] : 'Unknown',
                quality: 'DVD/HD',
                source: 'isaidub'
            });
        }
    });

    return movies;
}

/**
 * Search for movies on isaiDub
 */
async function search(query) {
    const results = [];

    // Search the homepage for category links
    const $ = await fetchPage(config.baseUrl);
    if (!$) return results;

    const targetYears = ['2026', '2025', '2024'];
    const matchingCategories = [];

    $('a').each((_, el) => {
        const text = $(el).text();
        const href = $(el).attr('href');
        if (!href) return;

        const isTamil = text.toLowerCase().includes('tamil') || href.toLowerCase().includes('tamil');
        const isDubbed = text.toLowerCase().includes('dubbed') || href.toLowerCase().includes('dubbed');

        if ((isTamil || isDubbed) && (targetYears.some(y => text.includes(y)) || fuzzyMatch(text, query))) {
            matchingCategories.push({
                url: href.startsWith('http') ? href : `${config.baseUrl}${href.startsWith('/') ? '' : '/'}${href}`,
                year: text.match(/\d{4}/)?.[0] || 'Dubbed'
            });
        }
    });

    // Limit to 2 categories for speed
    for (const cat of matchingCategories.slice(0, 2)) {
        const movies = await scrapeAllPages(cat.url, 1, cat.year);
        results.push(...movies.filter(m => fuzzyMatch(m.title, query)).map(m => ({
            ...m,
            title: cleanDisplayTitle(m.title),
            source: 'isaidub'
        })));
    }

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
 * The isaiDub Provider Interface
 */
export default {
    // Required interface properties
    id: config.id,
    name: config.name,
    supports: config.supports,
    languages: config.languages,

    // Configuration reference
    config,

    // Required interface methods
    getLatest,
    search,
    scrapeDetails: parseMovieDetails,

    // Additional methods
    getQuickPoster,
    isHealthy
};
