/**
 * Moviesda Provider - Main Entry Point
 * 
 * This is the provider interface that the ProviderManager uses.
 * It implements the standardized interface for all providers.
 */

import config from './config.js';
import { fetchPage, scrapeAllPages, parseMovieList } from './scraper.js';
import { parseMovieDetails, getQuickPoster } from './parser.js';
import { cleanDisplayTitle } from '../../matching/normalizeTitle.js';

/**
 * Fuzzy match helper for search filtering
 */
function fuzzyMatch(title, query) {
    const titleLower = (title || '').toLowerCase().replace(/[^a-z0-9\s]/g, '');
    const queryLower = (query || '').toLowerCase().replace(/[^a-z0-9\s]/g, '');

    if (!queryLower) return true;

    const queryWords = queryLower.split(/\s+/).filter(w => w.length > 1);
    return queryWords.every(word => titleLower.includes(word));
}

/**
 * Get latest updates from Moviesda
 * @returns {Promise<Array>} Latest movies
 */
async function getLatest() {
    const url = `${config.baseUrl}/tamil-latest-updates/`;
    const $ = await fetchPage(url);
    if (!$) return [];

    const movies = [];
    $('.f').each((_, el) => {
        const titleContainer = $(el).find('b, strong').first();
        let title = titleContainer.text().trim();

        const links = [];
        $(el).find('a').each((_, a) => {
            const href = $(a).attr('href');
            const lang = $(a).text().trim();
            if (href) links.push({ href, lang });
        });

        if (links.length > 0 && title) {
            if (title.toLowerCase().includes('check out our') || title.length < 3) return;

            links.forEach(linkObj => {
                const href = linkObj.href;
                const langSuffix = links.length > 1 ? ` [${linkObj.lang}]` : '';
                const fullUrl = href.startsWith('http') ? href : `${config.baseUrl}${href.startsWith('/') ? '' : '/'}${href}`;
                const yearMatch = title.match(/\((\d{4})\)/) || title.match(/\s(\d{4})\s/) || fullUrl.match(/(\d{4})/);
                const year = yearMatch ? yearMatch[1] : 'Unknown';

                const poster = $(el).find('img').attr('src');
                const fullPosterUrl = poster ? (poster.startsWith('http') ? poster : `${config.baseUrl}${poster.startsWith('/') ? '' : '/'}${poster}`) : null;

                movies.push({
                    title: cleanDisplayTitle(title) + langSuffix,
                    url: fullUrl,
                    year,
                    poster: fullPosterUrl,
                    quality: $(el).find('font[color="blue"]').text().trim() || 'DVD/HD',
                    source: fullUrl.includes('web-series') ? 'webseries' : 'moviesda'
                });
            });
        }
    });

    // Filter recent Tamil content only
    const recentMovies = movies.filter(m => {
        const titleLower = m.title.toLowerCase();
        const otherLangs = ['telugu', 'hindi', 'malayalam', 'kannada', 'english'];
        const isOtherLang = otherLangs.some(lang => titleLower.includes(lang)) && !titleLower.includes('tamil');
        if (isOtherLang) return false;

        if (m.year === 'Unknown') return true;
        const y = parseInt(m.year);
        return y >= 2024 && y <= 2027;
    }).slice(0, 15);

    return recentMovies;
}

/**
 * Search for movies on Moviesda
 * @param {string} query - Search query
 * @returns {Promise<Array>} Search results
 */
async function search(query) {
    const normalizedQuery = query.toLowerCase();
    const potentialMovies = [];

    // 1. Search A-Z category
    const firstChar = normalizedQuery.charAt(0);
    if (/[a-z]/.test(firstChar)) {
        const movies = await scrapeAllPages(`${config.baseUrl}/tamil-movies/${firstChar}/`, 25, 'Unknown');
        potentialMovies.push(...movies);
    }

    // 2. Search recent years
    const $home = await fetchPage(config.baseUrl);
    if ($home) {
        const yearLinks = [];
        $home('.f a').each((_, el) => {
            const text = $home(el).text();
            const href = $home(el).attr('href');
            if (text.match(/Tamil 20[2-3]\d Movies/) && href) {
                yearLinks.push({
                    url: href.startsWith('http') ? href : `${config.baseUrl}${href}`,
                    year: text.match(/\d{4}/)[0]
                });
            }
        });

        for (const item of yearLinks.filter(y => parseInt(y.year) >= 2024)) {
            const movies = await scrapeAllPages(item.url, 15, item.year);
            potentialMovies.push(...movies);
        }
    }

    // 3. Filter and deduplicate
    const uniqueMovies = new Map();
    potentialMovies.forEach(movie => {
        if (fuzzyMatch(movie.title, query)) {
            uniqueMovies.set(movie.url, { ...movie, source: 'moviesda' });
        }
    });

    return Array.from(uniqueMovies.values()).slice(0, 10);
}

/**
 * Get web series latest
 * @returns {Promise<Array>} Web series
 */
async function getWebSeriesLatest() {
    const updates = await getLatest();
    const seriesFromUpdates = updates.filter(m =>
        m.title.toLowerCase().includes('webseries') ||
        m.url.toLowerCase().includes('web-series') ||
        m.url.toLowerCase().includes('/45/')
    );

    let finalResults = seriesFromUpdates;

    if (seriesFromUpdates.length < 15) {
        const ws = await searchWebSeries('');
        const combined = [...seriesFromUpdates, ...ws];
        finalResults = Array.from(new Map(combined.map(m => [m.url, m])).values());
    }

    return finalResults.map(m => ({
        ...m,
        title: cleanDisplayTitle(m.title),
        source: 'webseries',
        year: (m.year === 'Series' || m.year === 'Web Series') ? '2026' : m.year
    })).slice(0, 20);
}

/**
 * Search web series specifically
 * @param {string} query - Search query
 * @returns {Promise<Array>} Web series results
 */
async function searchWebSeries(query) {
    const results = [];
    const webSeriesUrl = `${config.baseUrl}/tamil-web-series-download/`;
    const $ = await fetchPage(webSeriesUrl);
    if (!$) return results;

    const matchingFolders = [];
    $('.f a').each((_, el) => {
        const text = $(el).text();
        const href = $(el).attr('href');

        const isYearMatch = /202[3-7]/.test(text);
        const isTamilSeries = text.toLowerCase().includes('tamil') && text.toLowerCase().includes('series');

        if (isYearMatch || isTamilSeries || (query && fuzzyMatch(text, query))) {
            matchingFolders.push({
                url: href.startsWith('http') ? href : `${config.baseUrl}${href}`,
                year: text.match(/\d{4}/)?.[0] || 'Web Series'
            });
        }
    });

    for (const folder of matchingFolders.slice(0, 6)) {
        const items = await scrapeAllPages(folder.url, 1, folder.year);
        results.push(...items.map(m => ({ ...m, source: 'webseries' })));
    }

    return results;
}

/**
 * Check if provider is healthy
 * @returns {Promise<boolean>} Health status
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
 * The Moviesda Provider Interface
 * This is what ProviderManager uses
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
    getWebSeriesLatest,
    searchWebSeries,
    getQuickPoster,
    isHealthy
};
