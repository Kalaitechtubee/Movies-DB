/**
 * Web Scraper Service
 * Handles all web scraping operations for moviesda website
 */

import axios from 'axios';
import * as cheerio from 'cheerio';
import { BASE_URL, REQUEST_HEADERS, SCRAPE_CONFIG } from '../config.js';
import { insertMovie } from './database.js';
import logger from '../utils/logger.js';

/**
 * Fetch and parse a webpage
 * @param {string} url - URL to fetch
 * @returns {Promise<CheerioAPI|null>} Cheerio instance or null on failure
 */
async function fetchPage(url) {
    try {
        const response = await axios.get(url, {
            headers: REQUEST_HEADERS,
            timeout: SCRAPE_CONFIG.requestTimeout
        });

        const $ = cheerio.load(response.data);

        // Check for blocked content
        if ($.text().trim() === 'Not Allowed') {
            logger.warn(`Access blocked for: ${url}`);
            return null;
        }

        return $;
    } catch (error) {
        const statusCode = error.response?.status;
        logger.error(`Failed to fetch ${url}: ${statusCode || error.message}`);
        return null;
    }
}

/**
 * Parse movie entries from a page
 * @param {CheerioAPI} $ - Cheerio instance
 * @param {string} year - Year to assign to movies
 * @returns {Array} Array of movie objects
 */
function parseMovies($, year = 'Unknown') {
    const movies = [];
    const filterPatterns = ['Tamil 20', 'Subtitles', 'Page', 'தமிழ்'];

    $('.f').each((_, element) => {
        const link = $(element).find('a').first();
        const href = link.attr('href');

        // Get title from 'b' tag or anchor text
        let title = $(element).find('b').text().trim() || link.text().trim();
        title = title.replace(/\s+/g, ' ').trim();

        if (!title || !href) return;

        // Filter out non-movie links (navigation, subtitles, etc.)
        const isFiltered = filterPatterns.some(pattern => title.includes(pattern));
        if (isFiltered) {
            logger.debug(`Skipped: ${title} (filtered)`);
            return;
        }

        const fullUrl = href.startsWith('http') ? href : `${BASE_URL}${href}`;
        movies.push({
            title,
            url: fullUrl,
            year,
            quality: 'DVD/HD'
        });
    });

    return movies;
}

/**
 * Scrape all pages from a category URL
 * @param {string} baseUrl - Base category URL
 * @param {number} maxPages - Maximum pages to scrape
 * @param {string} year - Year to assign to movies
 * @returns {Promise<Array>} Array of all movies found
 */
async function scrapeAllPages(baseUrl, maxPages, year = 'Unknown') {
    const allMovies = [];

    // Fetch first page
    const $first = await fetchPage(baseUrl);
    if (!$first) return allMovies;

    allMovies.push(...parseMovies($first, year));

    // Determine total pages from pagination links
    let totalPages = 1;
    $first('a[href*="?page="]').each((_, el) => {
        const href = $first(el).attr('href');
        const match = href?.match(/page=(\d+)/);
        if (match) {
            const pageNum = parseInt(match[1]);
            if (pageNum > totalPages) totalPages = pageNum;
        }
    });

    const pagesToScrape = Math.min(totalPages, maxPages);
    logger.info(`Scraping ${pagesToScrape} pages from ${baseUrl}`);

    // Fetch remaining pages
    for (let page = 2; page <= pagesToScrape; page++) {
        const separator = baseUrl.includes('?') ? '&' : '?';
        const pageUrl = `${baseUrl}${separator}page=${page}`;

        logger.debug(`Fetching page ${page}: ${pageUrl}`);
        const $page = await fetchPage(pageUrl);

        if ($page) {
            allMovies.push(...parseMovies($page, year));
        }
    }

    return allMovies;
}

/**
 * Extract detailed info for a single movie
 * @param {string} url - Movie URL
 * @returns {Promise<Object>} Detailed movie info
 */
async function getMovieDetails(url) {
    const $ = await fetchPage(url);
    if (!$) return null;

    const details = {
        poster_url: $('.movie-info-container img').first().attr('src') || $('.f img').first().attr('src') || null,
        director: '',
        starring: '',
        genres: '',
        quality: 'Original HD',
        language: 'Tamil',
        rating: '',
        lastUpdated: '',
        synopsis: '',
    };

    if (details.poster_url && !details.poster_url.startsWith('http')) {
        details.poster_url = `${BASE_URL}${details.poster_url}`;
    }

    $('.movie-info li').each((_, el) => {
        const label = $(el).find('strong').text().replace(':', '').trim();
        const value = $(el).find('span').text().trim();

        switch (label) {
            case 'Director': details.director = value; break;
            case 'Starring': details.starring = value; break;
            case 'Genres': details.genres = value; break;
            case 'Quality': details.quality = value; break;
            case 'Language': details.language = value; break;
            case 'Movie Rating': details.rating = value; break;
            case 'Last Updated': details.lastUpdated = value; break;
        }
    });

    details.synopsis = $('.movie-synopsis').text().replace('Synopsis:', '').trim();
    return details;
}

/**
 * Search for movies directly on the website
 * @param {string} query - Movie name to search
 * @returns {Promise<Array>} Array of matching movies
 */
export async function searchMoviesDirect(query) {
    logger.info(`Searching for: ${query}`);
    const normalizedQuery = query.toLowerCase();
    const potentialMovies = [];

    // 1. Search A-Z category
    const firstChar = normalizedQuery.charAt(0);
    if (/[a-z]/.test(firstChar)) {
        const movies = await scrapeAllPages(`${BASE_URL}/tamil-movies/${firstChar}/`, 10, 'Unknown');
        potentialMovies.push(...movies);
    }

    // 2. Search recent years
    const $home = await fetchPage(BASE_URL);
    if ($home) {
        const yearLinks = [];
        $home('.f a').each((_, el) => {
            const text = $home(el).text();
            const href = $home(el).attr('href');
            if (text.match(/Tamil 20[2-3]\d Movies/) && href) {
                yearLinks.push({
                    url: href.startsWith('http') ? href : `${BASE_URL}${href}`,
                    year: text.match(/\d{4}/)[0]
                });
            }
        });

        for (const item of yearLinks.filter(y => parseInt(y.year) >= 2024)) {
            const movies = await scrapeAllPages(item.url, 5, item.year);
            potentialMovies.push(...movies);
        }
    }

    // 3. Filter and deduplicate
    const uniqueMovies = new Map();
    potentialMovies.forEach(movie => {
        if (movie.title.toLowerCase().includes(normalizedQuery)) {
            uniqueMovies.set(movie.url, movie);
        }
    });

    const results = Array.from(uniqueMovies.values()).slice(0, 10); // Limit to 10 for speed

    // 4. Fetch details for each (in parallel)
    const detailedResults = await Promise.all(results.map(async (movie) => {
        const details = await getMovieDetails(movie.url);
        if (details) {
            return { ...movie, ...details };
        }
        return movie;
    }));

    // Cache results in database
    detailedResults.forEach(movie => insertMovie(movie));

    logger.info(`Found ${detailedResults.length} detailed results for "${query}"`);
    return detailedResults;
}

/**
 * Get download links for a specific movie
 * @param {string} movieUrl - URL of the movie page
 * @returns {Promise<Object|null>} Movie details with download links
 */
export async function getMovieDownloadLinks(movieUrl) {
    logger.info(`Fetching detailed movie info for: ${movieUrl}`);

    const $ = await fetchPage(movieUrl);
    if (!$) return null;

    const details = {
        title: $('h1').text().trim().replace(/ Tamil Movie$/, ''),
        posterUrl: $('.movie-info-container img').first().attr('src') || $('.f img').first().attr('src') || null,
        director: '',
        starring: '',
        genres: '',
        quality: 'Original HD',
        language: 'Tamil',
        rating: '',
        lastUpdated: '',
        synopsis: '',
        screenshots: [],
        resolutions: []
    };

    if (details.posterUrl && !details.posterUrl.startsWith('http')) {
        details.posterUrl = `${BASE_URL}${details.posterUrl}`;
    }

    // Parse Detailed Movie Info from <ul>
    $('.movie-info li').each((_, el) => {
        const label = $(el).find('strong').text().replace(':', '').trim();
        const value = $(el).find('span').text().trim();

        switch (label) {
            case 'Director': details.director = value; break;
            case 'Starring': details.starring = value; break;
            case 'Genres': details.genres = value; break;
            case 'Quality': details.quality = value; break;
            case 'Language': details.language = value; break;
            case 'Movie Rating': details.rating = value; break;
            case 'Last Updated': details.lastUpdated = value; break;
        }
    });

    // Parse Synopsis
    const synopsisText = $('.movie-synopsis').text().replace('Synopsis:', '').trim();
    details.synopsis = synopsisText;

    // Parse Screenshots
    $('.screenshot-container img').each((_, el) => {
        let src = $(el).attr('src');
        if (src) {
            if (!src.startsWith('http')) src = `${BASE_URL}${src}`;
            details.screenshots.push(src);
        }
    });

    // Find resolution links (Original, HD, etc.)
    const resolutionLinks = [];
    $('.f a').each((_, el) => {
        const text = $(el).text();
        const href = $(el).attr('href');

        if (!href || href.includes('folder.svg')) return;

        if (text.includes('HD') || text.includes('Original') || text.includes('DVD')) {
            resolutionLinks.push({
                text,
                url: href.startsWith('http') ? href : `${BASE_URL}${href}`
            });
        } else if (text.match(/\.(mp4|mkv)|Sample/i)) {
            details.resolutions.push({
                quality: 'Direct',
                name: text,
                url: href.startsWith('http') ? href : `${BASE_URL}${href}`
            });
        }
    });

    // Fetch file links from resolution pages
    for (const res of resolutionLinks) {
        const $res = await fetchPage(res.url);
        if (!$res) continue;

        $res('.f a').each((_, el) => {
            const text = $res(el).text();
            const href = $res(el).attr('href');

            if (href && (text.includes('.mp4') || text.includes('BD') || text.includes('Rip') || text.includes('HD'))) {
                details.resolutions.push({
                    quality: res.text,
                    name: text,
                    url: href.startsWith('http') ? href : `${BASE_URL}${href}`
                });
            }
        });
    }

    // Get actual download links from file pages
    for (const item of details.resolutions) {
        const $file = await fetchPage(item.url);
        if (!$file) continue;

        const downloadLink = $file('a:contains("Download Server 1")').attr('href');
        if (downloadLink) {
            item.downloadUrl = downloadLink;
        }
    }

    logger.info(`Found ${details.resolutions.length} download options for ${details.title}`);
    return details;
}

/**
 * Scrape home page and populate database
 * Used for initial database population
 */
export async function scrapeHome() {
    logger.info('Starting home page scrape...');

    const $ = await fetchPage(BASE_URL);
    if (!$) return;

    const yearLinks = [];
    $('.f a').each((_, el) => {
        const text = $(el).text();
        const href = $(el).attr('href');

        if (text.match(/Tamil \d{4} Movies/) && href) {
            yearLinks.push({
                url: href.startsWith('http') ? href : `${BASE_URL}${href}`,
                year: text.match(/\d{4}/)[0]
            });
        }
    });

    logger.info(`Found ${yearLinks.length} year categories`);

    for (const item of yearLinks) {
        const movies = await scrapeAllPages(item.url, 5, item.year);
        movies.forEach(movie => insertMovie(movie));
        logger.info(`Scraped ${movies.length} movies from ${item.year}`);
    }

    logger.info('Home page scrape completed');
}
