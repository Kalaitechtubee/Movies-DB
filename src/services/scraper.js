/**
 * Web Scraper Service
 * Handles all web scraping operations for moviesda website
 */

import axios from 'axios';
import * as cheerio from 'cheerio';
import { BASE_URL, ISAIDUB_BASE_URL, REQUEST_HEADERS, SCRAPE_CONFIG } from '../config.js';
import { insertMovie, insertMovies } from './database.js';
import logger from '../utils/logger.js';
import { fuzzyMatch } from '../utils/search.js';

/**
 * Follow download server links to find the direct file link
 * @param {string} url - Initial download server URL
 * @returns {Promise<Object>} Object containing directLink and watchLink
 */
async function followDownloadLinks(url) {
    let currentUrl = url;
    let result = { directLink: null, watchLink: null };

    // Max depth of 5 to prevent infinite loops
    for (let i = 0; i < 5; i++) {
        logger.debug(`Following link level ${i}: ${currentUrl}`);
        const $ = await fetchPage(currentUrl);
        if (!$) {
            logger.warn(`Failed to fetch level ${i}: ${currentUrl}`);
            break;
        }

        // 1. Look for direct file links (mp4, mkv or known hosts)
        let foundLink = null;
        $('a').each((_, el) => {
            const href = $(el).attr('href');
            const text = $(el).text().trim();
            if (!href) return;

            // Direct file extensions
            if (href.match(/\.(mp4|mkv|avi|webm)$/i)) {
                foundLink = href;
                return false;
            }

            // Known file host patterns
            const knownHosts = [
                'hotshare.link', 'uptobox.com', '1fichier.com', 'pixeldrain.com',
                'biggshare.xyz', 'cdnserver', 'onestream.watch', 'gofile.io',
                'drive.google.com', 'mega.nz', 'mediafire.com'
            ];
            if (knownHosts.some(host => href.includes(host))) {
                foundLink = href;
                return false;
            }

            // If "Download Server" text points to an external site, it's likely the final destination
            // We'll accept any "Download" link that leads away from our ecosystem
            if (text.match(/Download Server/i) && href.startsWith('http') &&
                !href.includes('moviesda') && !href.includes('moviespage') && !href.includes('downloadpage')) {
                foundLink = href;
                return false;
            }
        });

        if (foundLink) {
            result.directLink = foundLink;

            // Checks for watch link
            if (foundLink.includes('onestream.watch')) {
                result.watchLink = foundLink;
            } else {
                // While we're here, look for watch online links on the same page
                const watchOnline = $('a:contains("Watch Online")').first().attr('href') ||
                    $('a[href*="onestream.watch"]').first().attr('href');
                if (watchOnline) result.watchLink = watchOnline;
            }
            break;
        }

        // 2. Look for "Watch Online" specifically if not found yet
        if (!result.watchLink) {
            const watchOnline = $('a:contains("Watch Online")').first().attr('href') ||
                $('a[href*="onestream.watch"]').first().attr('href');
            if (watchOnline) result.watchLink = watchOnline;
        }

        // 3. Look for the next "Download Server" link
        const nextLink = $('a:contains("Download Server 1")').first().attr('href') ||
            $('a:contains("Download Server")').first().attr('href') ||
            $('a:contains("Download")').first().attr('href');

        if (nextLink && nextLink !== currentUrl && !nextLink.match(/\.(mp4|mkv)$/i)) {
            const previousUrl = currentUrl;
            // Handle relative URLs
            if (nextLink.startsWith('http')) {
                currentUrl = nextLink;
            } else if (nextLink.startsWith('/')) {
                const urlObj = new URL(currentUrl);
                currentUrl = `${urlObj.protocol}//${urlObj.host}${nextLink}`;
            } else {
                // Just use BASE_URL as fallback for absolute-ish paths
                currentUrl = `${BASE_URL}${nextLink.startsWith('/') ? '' : '/'}${nextLink}`;
            }
            logger.debug(`Moving to next link: ${currentUrl} (from ${previousUrl})`);
        } else {
            logger.debug(`No more links found at level ${i}`);
            break;
        }
    }
    return result;
}

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

    // Fetch remaining pages in batches to be faster but polite
    const CONCURRENT_BATCH = 5;
    const remainingPages = [];
    for (let p = 2; p <= pagesToScrape; p++) remainingPages.push(p);

    for (let i = 0; i < remainingPages.length; i += CONCURRENT_BATCH) {
        const batch = remainingPages.slice(i, i + CONCURRENT_BATCH);
        const batchPromises = batch.map(async (page) => {
            const separator = baseUrl.includes('?') ? '&' : '?';
            const pageUrl = `${baseUrl}${separator}page=${page}`;

            logger.debug(`Fetching page ${page}: ${pageUrl}`);
            const $page = await fetchPage(pageUrl);
            if ($page) {
                return parseMovies($page, year);
            }
            return [];
        });

        const batchResults = await Promise.all(batchPromises);
        batchResults.forEach(movies => allMovies.push(...movies));
    }

    return allMovies;
}

/**
 * Extract detailed info for a single movie
 * @param {string} url - Movie URL
 * @returns {Promise<Object>} Detailed movie info
 */
export async function getMovieDetails(url) {
    const $ = await fetchPage(url);
    if (!$) return null;

    const details = {
        poster_url: $('.movie-info-container source[type="image/webp"]').first().attr('srcset')?.split(' ')[0] ||
            $('.movie-info-container img').first().attr('src') ||
            $('.f img').filter((i, el) => !$(el).attr('src')?.includes('folder')).first().attr('src') ||
            null,
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
        const urlObj = new URL(url);
        details.poster_url = `${urlObj.origin}${details.poster_url.startsWith('/') ? '' : '/'}${details.poster_url}`;
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
        // Scrape deeper (25 pages) to find movies
        const movies = await scrapeAllPages(`${BASE_URL}/tamil-movies/${firstChar}/`, 25, 'Unknown');
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
            const movies = await scrapeAllPages(item.url, 15, item.year);
            potentialMovies.push(...movies);
        }
    }

    // 3. Filter and deduplicate
    const uniqueMovies = new Map();
    potentialMovies.forEach(movie => {
        if (fuzzyMatch(movie.title, query)) {
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
    if (detailedResults.length > 0) {
        await insertMovies(detailedResults);
        logger.info(`Cached ${detailedResults.length} movies in database`);
    }

    logger.info(`Found ${detailedResults.length} detailed results for "${query}"`);
    return detailedResults;
}

/**
 * Get download links for a specific movie or web series
 * Recursively explores folders to find actual file links
 * @param {string} movieUrl - URL of the movie page
 * @param {string} query - Optional search query to filter specific episodes/seasons
 * @returns {Promise<Object|null>} Movie details with resolutions/episodes
 */
export async function getMovieDownloadLinks(movieUrl, query = '') {
    logger.info(`Fetching detailed media info for: ${movieUrl} (Query: ${query})`);

    const $ = await fetchPage(movieUrl);
    if (!$) return null;

    const details = {
        title: ($('h1').text() || $('.line').first().text()).trim().replace(/ Tamil Movie$/, ''),
        poster_url: $('.movie-info-container source[type="image/webp"]').first().attr('srcset')?.split(' ')[0] ||
            $('.movie-info-container img').first().attr('src') ||
            $('.f img').filter((i, el) => !$(el).attr('src')?.includes('folder')).first().attr('src') ||
            null,
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

    if (details.poster_url && !details.poster_url.startsWith('http')) {
        const urlObj = new URL(movieUrl);
        details.poster_url = `${urlObj.origin}${details.poster_url.startsWith('/') ? '' : '/'}${details.poster_url}`;
    }


    // Parse Detailed Media Info
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

    // Parse Screenshots
    $('.screenshot-container img').each((_, el) => {
        let src = $(el).attr('src');
        if (src) {
            if (!src.startsWith('http')) {
                const urlObj = new URL(movieUrl);
                src = `${urlObj.origin}${src.startsWith('/') ? '' : '/'}${src}`;
            }
            details.screenshots.push(src);
        }
    });

    const discoveredFiles = new Map();
    const visited = new Set();

    // Parse target episode/season from query
    let targetEpi = null;
    let targetSeason = null;
    if (query) {
        const epiMatch = query.match(/E(?:p|pisode)?\s?(\d+)/i) || query.match(/(\d+)(?:st|nd|rd|th)?\s?Episode/i);
        const seasonMatch = query.match(/S(?:eason)?\s?(\d+)/i) || query.match(/Season\s?(\d+)/i);
        if (epiMatch) targetEpi = parseInt(epiMatch[1]);
        if (seasonMatch) targetSeason = parseInt(seasonMatch[1]);
    }

    /**
     * Helper to recursively find file links
     */
    async function explore(url, currentQuality = 'Unknown', depth = 0) {
        if (depth > 6 || visited.has(url)) return; // Increased depth for big series
        visited.add(url);

        const $page = await fetchPage(url);
        if (!$page) return;

        const links = [];
        $page('.f a, .folder a, a.coral, .line a, .pagination a').each((_, el) => {
            const text = $page(el).text().trim();
            const href = $page(el).attr('href');
            if (!href || href.includes('folder.svg') || href.includes('index.html')) return;

            // Filter out A-Z and common clutter
            if (text.length <= 3 && depth === 0 && !href.includes('?page=')) return;
            if (/^[A-Z]$/.test(text) || text === '0-9' || text === 'Disclaimer' || text === 'Home') return;

            // Robust relative URL handling
            let fullUrl;
            try {
                if (href.startsWith('http')) {
                    fullUrl = href;
                } else if (href.startsWith('/')) {
                    const urlObj = new URL(url);
                    fullUrl = `${urlObj.origin}${href}`;
                } else {
                    const baseUrlObj = new URL(url);
                    const basePath = baseUrlObj.pathname.substring(0, baseUrlObj.pathname.lastIndexOf('/') + 1);
                    fullUrl = `${baseUrlObj.origin}${basePath}${href}`;
                }
                links.push({ text, url: fullUrl });
            } catch (err) {
                logger.debug(`Failed to parse URL ${href} relative to ${url}`);
            }
        });

        for (const link of links) {
            const text = link.text;
            const linkUrl = link.url;

            const isFile = text.match(/\.(mp4|mkv|avi|webm)$/i) || text.includes('Sample');
            const isEpisode = text.match(/Epi|Episode|Day|Part/i);
            const isQuality = text.match(/HD|Original|720p|1080p|DVD|HDRip|BDRip|Tamil/i);
            const hasMovieKeyword = text.match(/Movie|Full|Series|Season/i);
            const isPagination = linkUrl.includes('?page=') || (text.match(/^\d+$/) && depth < 2);

            // If specific episode requested, check if this link is it
            if (targetEpi !== null && (isEpisode || text.includes(` (${targetEpi})`))) {
                const linkEpiMatch = text.match(/E(?:p|pisode)?\s?(\d+)/i) || text.match(/Day\s?(\d+)/i);
                if (linkEpiMatch && parseInt(linkEpiMatch[1]) !== targetEpi) {
                    // This is an episode but not the target one
                    if (!isFile) continue;
                }
            }

            if (isFile) {
                if (!discoveredFiles.has(linkUrl)) {
                    discoveredFiles.set(linkUrl, {
                        quality: currentQuality,
                        name: text,
                        url: linkUrl
                    });
                }
            } else if (isPagination || isQuality || isEpisode || hasMovieKeyword || depth < 4) {
                let nextQuality = currentQuality;
                if (isQuality && !isEpisode) {
                    nextQuality = text;
                } else if (isEpisode && currentQuality === 'Unknown') {
                    nextQuality = 'Episode';
                }

                const nextDepth = isPagination ? depth : depth + 1;
                await explore(linkUrl, nextQuality, nextDepth);
            }
        }
    }

    await explore(movieUrl, details.quality, 0);

    // Natural sort episodes: Epi 101 should come after Epi 2
    const sortedResolutions = Array.from(discoveredFiles.values()).sort((a, b) => {
        const aNum = a.name.match(/(\d+)/)?.[0];
        const bNum = b.name.match(/(\d+)/)?.[0];
        if (aNum && bNum) return parseInt(bNum) - parseInt(aNum); // Newest first
        return b.name.localeCompare(a.name);
    });

    details.resolutions = sortedResolutions;

    const CONCURRENCY_LIMIT = 5; // Slightly faster
    const itemsToProcess = details.resolutions.slice(0, 100);

    for (let i = 0; i < itemsToProcess.length; i += CONCURRENCY_LIMIT) {
        const batch = itemsToProcess.slice(i, i + CONCURRENCY_LIMIT);
        await Promise.all(batch.map(async (item) => {
            try {
                const $file = await fetchPage(item.url);
                if (!$file) return;

                let downloadLink = $file('a:contains("Download Server 1")').attr('href') ||
                    $file('a:contains("Download Server")').attr('href') ||
                    $file('a:contains("Download")').attr('href');

                if (!downloadLink) {
                    const subLink = $file('.f a, .folder a, a.coral').filter((_, el) => {
                        const t = $file(el).text().toLowerCase();
                        return t.includes('.mp4') || t.includes('.mkv') || t.includes('sample');
                    }).first().attr('href');

                    if (subLink) {
                        const fullSubUrl = subLink.startsWith('http') ? subLink :
                            subLink.startsWith('/') ? `${BASE_URL}${subLink}` :
                                `${item.url.substring(0, item.url.lastIndexOf('/') + 1)}${subLink}`;
                        const $sub = await fetchPage(fullSubUrl);
                        if ($sub) {
                            downloadLink = $sub('a:contains("Download Server 1")').attr('href') ||
                                $sub('a:contains("Download Server")').attr('href');
                        }
                    }
                }

                if (downloadLink) {
                    const fullDlUrl = downloadLink.startsWith('http') ? downloadLink :
                        downloadLink.startsWith('/') ? `${BASE_URL}${downloadLink}` :
                            `${item.url.substring(0, item.url.lastIndexOf('/') + 1)}${downloadLink}`;

                    const finalLinks = await followDownloadLinks(fullDlUrl);
                    item.downloadUrl = fullDlUrl;
                    item.directUrl = finalLinks.directLink;
                    item.watchUrl = finalLinks.watchLink;
                }
            } catch (err) {
                logger.warn(`Error processing file link ${item.url}: ${err.message}`);
            }
        }));
    }

    // Filter results if target episode specified
    if (targetEpi !== null) {
        details.resolutions = details.resolutions.filter(r => {
            const rEpiMatch = r.name.match(/E(?:p|pisode)?\s?(\d+)/i) || r.name.match(/Day\s?(\d+)/i) || r.name.includes(`(${targetEpi})`);
            return rEpiMatch && parseInt(rEpiMatch[1] || targetEpi) === targetEpi;
        });
    }

    logger.info(`Found ${details.resolutions.length} options for ${details.title}`);
    return details;
}




/**
 * Get all categories from home page
 * @returns {Promise<Array>} Array of category objects
 */
export async function getCategories() {
    logger.info('Fetching categories...');
    const $ = await fetchPage(BASE_URL);
    if (!$) return [];

    const categories = [];

    // 1. Get main categories (Year based)
    $('.line:contains("Moviesda Downloads")').nextUntil('.line').find('.f a').each((_, el) => {
        const name = $(el).text().trim();
        const href = $(el).attr('href');
        if (href && name) {
            categories.push({
                name,
                url: href.startsWith('http') ? href : `${BASE_URL}${href}`,
                section: 'Moviesda Downloads'
            });
        }
    });

    // 2. Get More Categories
    $('.line:contains("More Categories")').nextUntil('.line').find('.f a').each((_, el) => {
        const name = $(el).text().trim();
        const href = $(el).attr('href');
        if (href && name) {
            categories.push({
                name,
                url: href.startsWith('http') ? href : `${BASE_URL}${href}`,
                section: 'More Categories'
            });
        }
    });

    logger.info(`Found ${categories.length} categories`);
    return categories;
}

/**
 * Get movies from a specific category
 * @param {string} categoryUrl - URL of the category
 * @param {string} year - Year to assign
 * @param {boolean} enrich - Whether to fetch direct download links for each movie
 */
export async function getCategoryMovies(categoryUrl, year = 'Unknown', enrich = false) {
    logger.info(`Scraping category: ${categoryUrl} (Enrich: ${enrich})`);

    // Scrape first page only for quick results, or more if needed
    const movies = await scrapeAllPages(categoryUrl, 1, year);

    if (!enrich) return movies;

    // If enrich is requested, fetch full details for each movie
    // Use a smaller batch size to avoid overwhelming the server
    const enrichedMovies = [];
    const BATCH_SIZE = 3;

    for (let i = 0; i < movies.length; i += BATCH_SIZE) {
        const batch = movies.slice(i, i + BATCH_SIZE);
        const results = await Promise.all(batch.map(async (movie) => {
            try {
                const details = await getMovieDownloadLinks(movie.url);
                return details ? { ...movie, ...details } : movie;
            } catch (err) {
                logger.warn(`Failed to enrich category movie ${movie.title}: ${err.message}`);
                return movie;
            }
        }));
        enrichedMovies.push(...results);

        // Break early if we have enough enriched movies for a category view (e.g., 12)
        if (enrichedMovies.length >= 12) break;
    }

    // Cache enriched movies if any were found
    if (enrichedMovies.length > 0) {
        await insertMovies(enrichedMovies);
        logger.info(`Cached ${enrichedMovies.length} enriched category movies in database`);
    }

    return enrichedMovies;
}

/**
 * Scrape home page and populate database
 * Used for initial database population
 */
export async function scrapeHome() {
    logger.info('Starting home page scrape...');

    const categories = await getCategories();
    const yearCategories = categories.filter(c => c.name.match(/Tamil \d{4} Movies/));

    logger.info(`Processing ${yearCategories.length} year categories for database population`);

    for (const item of yearCategories) {
        const yearMatch = item.name.match(/\d{4}/);
        const year = yearMatch ? yearMatch[0] : 'Unknown';

        // Get the list of movies
        const movies = await scrapeAllPages(item.url, 1, year);

        // Enrich the first 10 movies with details (posters, director, etc.)
        const topMovies = movies.slice(0, 10);
        const enrichedTop = await Promise.all(topMovies.map(async (movie) => {
            try {
                const details = await getMovieDownloadLinks(movie.url);
                return details ? { ...movie, ...details } : movie;
            } catch (err) {
                return movie;
            }
        }));

        // Combine and insert
        const finalBatch = [...enrichedTop, ...movies.slice(10)];
        await insertMovies(finalBatch);

        logger.info(`Scraped ${movies.length} movies from ${item.name} (Enriched ${enrichedTop.length} with posters)`);
    }

    logger.info('Home page scrape completed');
}
/**
 * Get latest movies from Moviesda latest updates page
 * @returns {Promise<Array>} Array of latest movies
 */
export async function getLatestUpdates() {
    logger.info('Fetching Moviesda latest updates...');
    const url = `${BASE_URL}/tamil-latest-updates/`;
    const $ = await fetchPage(url);
    if (!$) return [];

    const movies = [];
    $('.f').each((_, el) => {
        const link = $(el).find('a').first();
        const href = link.attr('href');

        // Try to get title from various possible tags
        let title = $(el).find('b').text().trim() ||
            $(el).find('strong').text().trim() ||
            link.text().trim();

        if (href && title) {
            // Filter out purely navigational text
            if (title.toLowerCase().includes('check out our') || title.length < 3) return;

            // If title is just "Download Now" or similar, try to parse it from the URL
            if (title.toLowerCase() === 'download now' || title.toLowerCase() === 'download') {
                const slug = href.split('/').filter(Boolean).pop() || '';
                title = slug.replace(/-/g, ' ').replace(/\s+/g, ' ').trim();
                // Capitalize words
                title = title.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
            }

            const fullUrl = href.startsWith('http') ? href : `${BASE_URL}${href}`;
            const yearMatch = title.match(/\((\d{4})\)/) || title.match(/\s(\d{4})\s/) || fullUrl.match(/(\d{4})/);
            const year = yearMatch ? yearMatch[1] : 'Unknown';

            movies.push({
                title: title.replace(/\(\d{4}\)/, '').replace(/\d{4}.*/, '').trim(),
                url: fullUrl,
                year,
                quality: 'DVD/HD'
            });
        }
    });

    // Filter to only include recent movies (>= 2024)
    const recentMovies = movies.filter(m => {
        if (m.year === 'Unknown') return true;
        const y = parseInt(m.year);
        return y >= 2024 && y <= 2027; // Filter out 2017 etc.
    }).slice(0, 15);

    logger.info(`Found ${recentMovies.length} recent movies from updates`);
    return recentMovies;
}

/**
 * Get latest updates from isaiDub
 * @returns {Promise<Array>} Array of latest dubbed movies
 */
export async function getIsaidubLatest() {
    logger.info('Fetching isaiDub latest updates...');
    const $ = await fetchPage(ISAIDUB_BASE_URL);
    if (!$) return [];

    const movies = [];
    const latestSection = $('.line:contains("isaiDub Latest Updates")');

    if (latestSection.length > 0) {
        latestSection.nextUntil('.line', '.f').each((_, el) => {
            const link = $(el).find('a:contains("Download Now")').first();
            const href = link.attr('href');

            // Get title - it's usually inside <strong> or <b> before the rating
            let title = $(el).find('strong, b').first().text().trim();
            if (!title) {
                // Fallback title extraction
                title = $(el).text().split('(')[0].trim();
            }

            if (href && title &&
                !title.includes('Check out our Latest Updates') &&
                !href.includes('tamil-dubbed-movies-download')) {
                const fullUrl = href.startsWith('http') ? href : `${ISAIDUB_BASE_URL}${href}`;
                movies.push({
                    title,
                    url: fullUrl,
                    year: title.match(/\(\d{4}\)/)?.[0]?.replace(/[()]/g, '') || 'Unknown',
                    quality: 'DVD/HD',
                    source: 'isaidub'
                });
            }
        });
    }

    logger.info(`Found ${movies.length} isaiDub updates`);
    return movies;
}
