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
 * Clean movie titles for consistent UI
 */
export function cleanTitle(title) {
    if (!title) return '';
    return title
        .replace(/Tamil Movie Download/gi, '')
        .replace(/Tamil Movie/gi, '')
        .replace(/Tamil Dubbed/gi, '')
        .replace(/Tamil Web Series/gi, '')
        .replace(/Web Series/gi, '')
        .replace(/Latest/gi, '')
        .replace(/Download/gi, '')
        .replace(/\(\d{4}\)/g, '')
        .replace(/\d{4}/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Follow download server links to find the direct file link
 * @param {string} url - Initial download server URL
 * @returns {Promise<Object>} Object containing directLink, watchLink and streamSource
 */
async function getStreamSource(watchUrl) {
    if (!watchUrl || (!watchUrl.includes('onestream.watch') && !watchUrl.includes('biggshare.xyz'))) return null;
    try {
        const response = await axios.get(watchUrl, {
            headers: REQUEST_HEADERS,
            timeout: 5000
        });
        const $ = cheerio.load(response.data);

        // 1. Check for standard video source tag
        let source = $('video source').attr('src');

        // 2. Check for video tag src
        if (!source) source = $('video').attr('src');

        // 3. Search for scripts containing direct links
        if (!source) {
            $('script').each((i, el) => {
                const text = $(el).html();
                if (text && (text.includes('source: "') || text.includes('file: "'))) {
                    const match = text.match(/source:\s*["'](.+?)["']/) || text.match(/file:\s*["'](.+?)["']/);
                    if (match) source = match[1];
                }
            });
        }

        if (source && !source.startsWith('http')) {
            const urlObj = new URL(watchUrl);
            source = `${urlObj.origin}${source.startsWith('/') ? '' : '/'}${source}`;
        }

        return source;
    } catch (error) {
        logger.warn(`Failed to get stream source for ${watchUrl}: ${error.message}`);
        return null;
    }
}
async function followDownloadLinks(url) {
    let currentUrl = url;
    let result = { directLink: null, watchLink: null, streamSource: null };

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

            // Known file host patterns including vidfiles
            const knownHosts = [
                'hotshare.link', 'uptobox.com', '1fichier.com', 'pixeldrain.com',
                'biggshare.xyz', 'cdnserver', 'onestream.watch', 'play.onestream.watch', 'gofile.io',
                'drive.google.com', 'mega.nz', 'mediafire.com', 'vidfiles.'
            ];
            if (knownHosts.some(host => href.includes(host))) {
                // If it's a vidfiles "Go To" link, we might need to follow it
                if (href.includes('vidfiles') && (text.includes('Download') || text.includes('Server'))) {
                    foundLink = href;
                } else if (href.match(/\.(mp4|mkv)$/i) || href.includes('download') || href.includes('drive')) {
                    foundLink = href;
                }
                return false;
            }

            // If "Download Server" text points to an external site, it's likely the final destination
            if ((text.match(/Download Server/i) || text.match(/Go To/i)) && href.startsWith('http') &&
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
    // New: If we have a watchLink, try to get the direct stream source
    if (result.watchLink) {
        result.streamSource = await getStreamSource(result.watchLink);
    } else if (result.directLink && result.directLink.includes('onestream.watch')) {
        result.streamSource = await getStreamSource(result.directLink);
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
function parseMovies($, year = 'Unknown', siteBase = BASE_URL) {
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

        const fullUrl = href.startsWith('http') ? href : `${siteBase}${href.startsWith('/') ? '' : '/'}${href}`;

        // Extract quality from font tag if present
        const quality = $(element).find('font[color="blue"]').text().trim() || 'DVD/HD';

        movies.push({
            title,
            url: fullUrl,
            year,
            quality: quality || 'DVD/HD'
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

    const siteBase = new URL(baseUrl).origin;
    allMovies.push(...parseMovies($first, year, siteBase));

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
                const siteBase = new URL(baseUrl).origin;
                return parseMovies($page, year, siteBase);
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
        poster_url: $('meta[property="og:image"]').attr('content') ||
            $('link[rel="image_src"]').attr('href') ||
            $('.movie-info-container source[type="image/webp"]').first().attr('srcset')?.split(' ')[0] ||
            $('.movie-info-container img').first().attr('src') ||
            $('.header-poster img').first().attr('src') ||
            $('.f img').filter((i, el) => !$(el).attr('src')?.includes('folder') && !$(el).attr('src')?.includes('loader')).first().attr('src') ||
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

    $('.movie-info li, .isai .pro b').each((_, el) => {
        let label, value;
        if ($(el).is('li')) {
            label = $(el).find('strong').text().replace(':', '').trim();
            value = $(el).find('span').text().trim();
        } else {
            label = $(el).text().replace(':', '').trim();
            value = $(el).next().next('font').text().trim() || $(el).next().next().text().trim();
        }

        if (!label || !value) return;

        const lowerLabel = label.toLowerCase();
        if (lowerLabel.includes('director')) details.director = value;
        else if (lowerLabel.includes('starring') || lowerLabel.includes('cast')) details.starring = value;
        else if (lowerLabel.includes('genres') || lowerLabel.includes('category')) details.genres = value;
        else if (lowerLabel.includes('quality')) details.quality = value;
        else if (lowerLabel.includes('language')) details.language = value;
        else if (lowerLabel.includes('rating')) details.rating = value;
        else if (lowerLabel.includes('last updated') || lowerLabel.includes('release')) details.lastUpdated = value;
    });

    details.synopsis = $('.movie-synopsis').text().replace('Synopsis:', '').trim() ||
        $('.isai-panel.isai-note p').text().replace('Story/Plot:', '').trim() ||
        $('.description').text().trim();

    // Fallback: If no metadata found, try to look for any image that looks like a poster
    if (!details.poster_url) {
        // Try to find images that are medium sized and not small icons
        $('img').each((_, img) => {
            const src = $(img).attr('src');
            if (src && !src.includes('folder') && !src.includes('loader') && !src.includes('icon')) {
                const lowerSrc = src.toLowerCase();
                const isPosterPattern = lowerSrc.includes('poster') || lowerSrc.includes('thumb') ||
                    lowerSrc.includes('series') || lowerSrc.includes('season');
                const isImageExt = lowerSrc.endsWith('.webp') || lowerSrc.endsWith('.jpg') ||
                    lowerSrc.endsWith('.jpeg') || lowerSrc.endsWith('.png');

                if (isPosterPattern || isImageExt) {
                    details.poster_url = src;
                    return false; // break
                }
            }
        });
    }

    // Final cleanup for poster URL - ensure it's an absolute URL
    if (details.poster_url && !details.poster_url.startsWith('http')) {
        try {
            const urlObj = new URL(url);
            details.poster_url = `${urlObj.origin}${details.poster_url.startsWith('/') ? '' : '/'}${details.poster_url}`;
        } catch (e) {
            // If URL parsing fails, fallback to BASE_URL
            details.poster_url = `${BASE_URL}${details.poster_url.startsWith('/') ? '' : '/'}${details.poster_url}`;
        }
    }

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
        poster_url: $('meta[property="og:image"]').attr('content') ||
            $('link[rel="image_src"]').attr('href') ||
            $('.movie-info-container source[type="image/webp"]').first().attr('srcset')?.split(' ')[0] ||
            $('.movie-info-container img').first().attr('src') ||
            $('.header-poster img').first().attr('src') ||
            $('.f img').filter((i, el) => !$(el).attr('src')?.includes('folder') && !$(el).attr('src')?.includes('loader')).first().attr('src') ||
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
        try {
            const urlObj = new URL(movieUrl);
            details.poster_url = `${urlObj.origin}${details.poster_url.startsWith('/') ? '' : '/'}${details.poster_url}`;
        } catch (e) {
            details.poster_url = `${BASE_URL}${details.poster_url.startsWith('/') ? '' : '/'}${details.poster_url}`;
        }
    }


    // Parse Detailed Media Info
    $('.movie-info li, .isai .pro b').each((_, el) => {
        let label, value;
        if ($(el).is('li')) {
            label = $(el).find('strong').text().replace(':', '').trim();
            value = $(el).find('span').text().trim();
        } else {
            label = $(el).text().replace(':', '').trim();
            value = $(el).next().next('font').text().trim() || $(el).next().next().text().trim();
        }

        if (!label || !value) return;

        const lowerLabel = label.toLowerCase();
        if (lowerLabel.includes('director')) details.director = value;
        else if (lowerLabel.includes('starring') || lowerLabel.includes('cast')) details.starring = value;
        else if (lowerLabel.includes('genres') || lowerLabel.includes('category')) details.genres = value;
        else if (lowerLabel.includes('quality')) details.quality = value;
        else if (lowerLabel.includes('language')) details.language = value;
        else if (lowerLabel.includes('rating')) details.rating = value;
        else if (lowerLabel.includes('last updated') || lowerLabel.includes('release')) details.lastUpdated = value;
    });

    details.synopsis = $('.movie-synopsis').text().replace('Synopsis:', '').trim() ||
        $('.isai-panel.isai-note p').text().replace('Story/Plot:', '').trim() ||
        $('.description').text().trim();

    // Fallback: If no metadata found, try to look for any image that looks like a poster
    if (!details.poster_url) {
        // Try to find images that are medium sized and not small icons
        $('img').each((_, img) => {
            const src = $(img).attr('src');
            if (src && !src.includes('folder') && !src.includes('loader') && !src.includes('icon')) {
                const lowerSrc = src.toLowerCase();
                const isPosterPattern = lowerSrc.includes('poster') || lowerSrc.includes('thumb') ||
                    lowerSrc.includes('series') || lowerSrc.includes('season');
                const isImageExt = lowerSrc.endsWith('.webp') || lowerSrc.endsWith('.jpg') ||
                    lowerSrc.endsWith('.jpeg') || lowerSrc.endsWith('.png');

                if (isPosterPattern || isImageExt) {
                    details.poster_url = src;
                    return false; // break
                }
            }
        });
    }

    // Final cleanup for poster URL - ensure it's an absolute URL
    if (details.poster_url && !details.poster_url.startsWith('http')) {
        try {
            const urlObj = new URL(movieUrl);
            details.poster_url = `${urlObj.origin}${details.poster_url.startsWith('/') ? '' : '/'}${details.poster_url}`;
        } catch (e) {
            details.poster_url = `${BASE_URL}${details.poster_url.startsWith('/') ? '' : '/'}${details.poster_url}`;
        }
    }

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
                    $file('a:contains("Download Now")').attr('href') ||
                    $file('a:contains("Go To Download Page")').attr('href') ||
                    $file('a.dwnLink').attr('href') ||
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
                    item.streamSource = finalLinks.streamSource;

                    // Extract size from name if possible (e.g. "Movie Name (950 MB).mp4")
                    const sizeMatch = item.name.match(/\(([\d\.]+\s*(?:MB|GB|KB))\)/i);
                    if (sizeMatch) {
                        item.size = sizeMatch[1];
                    }

                    // Try to get exact size from headers if we have a direct link
                    if (item.directUrl && !item.size) {
                        try {
                            const headRes = await axios.head(item.directUrl, {
                                timeout: 2000,
                                headers: { 'User-Agent': 'Mozilla/5.0' }
                            });
                            const contentLength = headRes.headers['content-length'];
                            if (contentLength) {
                                const bytes = parseInt(contentLength);
                                if (bytes > 0) {
                                    const mb = (bytes / (1024 * 1024)).toFixed(1);
                                    if (mb > 1024) {
                                        item.size = (mb / 1024).toFixed(2) + ' GB';
                                    } else {
                                        item.size = mb + ' MB';
                                    }
                                }
                            }
                        } catch (hErr) {
                            // Silently fail if head request fails
                        }
                    }
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
        // IMPORTANT: Only include Tamil categories
        if (href && name && name.toLowerCase().includes('tamil')) {
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
        // IMPORTANT: Only include Tamil categories
        if (href && name && name.toLowerCase().includes('tamil')) {
            categories.push({
                name,
                url: href.startsWith('http') ? href : `${BASE_URL}${href}`,
                section: 'More Categories'
            });
        }
    });

    logger.info(`Found ${categories.length} Tamil categories`);
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
        const titleContainer = $(el).find('b, strong').first();
        let title = titleContainer.text().trim();

        // Find all links in this update entry
        const links = [];
        $(el).find('a').each((_, a) => {
            const href = $(a).attr('href');
            const lang = $(a).text().trim();
            if (href) {
                links.push({ href, lang });
            }
        });

        if (links.length > 0 && title) {
            // Filter out purely navigational text
            if (title.toLowerCase().includes('check out our') || title.length < 3) return;

            // Handle each language/link as a separate entry if it's a multi-language update
            links.forEach(linkObj => {
                const href = linkObj.href;
                const langSuffix = links.length > 1 ? ` [${linkObj.lang}]` : '';

                const fullUrl = href.startsWith('http') ? href : `${BASE_URL}${href.startsWith('/') ? '' : '/'}${href}`;
                const yearMatch = title.match(/\((\d{4})\)/) || title.match(/\s(\d{4})\s/) || fullUrl.match(/(\d{4})/);
                const year = yearMatch ? yearMatch[1] : 'Unknown';

                movies.push({
                    title: cleanTitle(title) + langSuffix,
                    url: fullUrl,
                    year,
                    quality: $(el).find('font[color="blue"]').text().trim() || 'DVD/HD',
                    source: fullUrl.includes('isaidub') ? 'isaidub' : (fullUrl.includes('web-series') ? 'webseries' : 'moviesda')
                });
            });
        }
    });

    // Filter to only include recent movies (>= 2024) and only Tamil/Dubbed content
    const recentMovies = movies.filter(m => {
        const titleLower = m.title.toLowerCase();

        // Skip other languages if they don't include Tamil
        const otherLangs = ['telugu', 'hindi', 'malayalam', 'kannada', 'english'];
        const isOtherLang = otherLangs.some(lang => titleLower.includes(lang)) && !titleLower.includes('tamil');

        if (isOtherLang) return false;

        if (m.year === 'Unknown') return true;
        const y = parseInt(m.year);
        return y >= 2024 && y <= 2027; // Filter out 2017 etc.
    }).slice(0, 15);

    logger.info(`Found ${recentMovies.length} recent Tamil/Dubbed movies from updates`);
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

    // Try reliable section first
    const latestSection = $('.line:contains("isaiDub Latest Updates")');

    if (latestSection.length > 0) {
        latestSection.nextUntil('.line', '.f').each((_, el) => {
            const link = $(el).find('a').first();
            const href = link.attr('href');
            let title = $(el).text().split('(')[0].trim();

            // Filter for Tamil content
            const isTamil = title.toLowerCase().includes('tamil') || href?.toLowerCase().includes('tamil');

            if (href && title && isTamil && !title.includes('Updates')) {
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

    // Fallback: Scraping any movie links from homepage if section not found
    if (movies.length === 0) {
        $('a[href*="/movie/"]').each((_, el) => {
            const href = $(el).attr('href');
            const title = $(el).text().trim();

            // Strictly Tamil only
            const isTamil = title.toLowerCase().includes('tamil') || href.toLowerCase().includes('tamil');

            if (title && isTamil && !title.includes('Download') && !title.includes('Collection') && !title.includes('Updates')) {
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



/**
 * Get latest Tamil Web Series
 * @returns {Promise<Array>}
 */
export async function getWebSeriesLatest() {
    logger.info('Fetching latest web series...');
    try {
        const updates = await getLatestUpdates();
        const seriesFromUpdates = updates.filter(m =>
            m.title.toLowerCase().includes('webseries') ||
            m.url.toLowerCase().includes('web-series') ||
            m.url.toLowerCase().includes('/45/') // Typical webseries category ID
        );

        let finalResults = seriesFromUpdates;

        // modified: always try to fetch specific if we have few results, or just to get more variety
        if (seriesFromUpdates.length < 15) {
            // Fallback to specific folder
            const ws = await searchWebSeriesSpecific('');
            const combined = [...seriesFromUpdates, ...ws];
            finalResults = Array.from(new Map(combined.map(m => [m.url, m])).values());
        }

        // Limit to 20 items (User asked for > 10)
        const limitedResults = finalResults.map(m => ({
            ...m,
            title: cleanTitle(m.title),
            source: 'webseries',
            year: (m.year === 'Series' || m.year === 'Web Series') ? '2026' : m.year // Default to current if ambiguous
        })).slice(0, 20);

        // AWAIT enrichment for the first 10, do rest in background to ensure fast response but eventual completeness
        const toEnrich = limitedResults.slice(0, 10);
        const remaining = limitedResults.slice(10);

        if (limitedResults.length > 0) {
            logger.info(`Enriching ${toEnrich.length} web series immediately...`);
            await Promise.all(toEnrich.map(async (movie) => {
                try {
                    if (!movie.poster_url && !movie.posterUrl) {
                        const details = await getMovieDetails(movie.url);
                        if (details) Object.assign(movie, details);
                    }
                } catch (err) {
                    logger.warn(`Failed to enrich series ${movie.title}: ${err.message}`);
                }
            }));

            // Background enrichment for the rest
            remaining.forEach(async (movie) => {
                try {
                    if (!movie.poster_url && !movie.posterUrl) {
                        const details = await getMovieDetails(movie.url);
                        if (details) await insertMovie({ ...movie, ...details });
                    }
                } catch (err) { }
            });

            // Cache immediately enriched results
            insertMovies(toEnrich).catch(() => { });
        }

        logger.info(`Found ${limitedResults.length} web series entries`);
        return limitedResults;
    } catch (err) {
        logger.error(`Web series fetch failed: ${err.message}`);
        return [];
    }
}

/**
 * Perform a comprehensive search across all movie types (Regular, Dubbed, Web Series)
 * @param {string} query Search query
 * @returns {Promise<Array>} Array of unified results
 */
export async function searchAllDirect(query) {
    logger.info(`Comprehensive search for: ${query}`);

    // Parallel execution for speed
    const [moviesResult, isaidubResult, webSeriesResult] = await Promise.all([
        searchMoviesDirect(query),
        searchIsaidubSpecific(query),
        searchWebSeriesSpecific(query)
    ]);

    // Merge and prioritize recent content
    const combined = [...moviesResult, ...isaidubResult, ...webSeriesResult];

    // Deduplicate and filter by query again to ensure relevance
    const uniqueMap = new Map();
    combined.forEach(m => {
        if (fuzzyMatch(m.title, query)) {
            uniqueMap.set(m.url, m);
        }
    });

    const finalResults = Array.from(uniqueMap.values()).slice(0, 20);
    logger.info(`Unified search found ${finalResults.length} total results`);
    return finalResults;
}

/**
 * Specifically search isaidub for dubbed movies
 */
async function searchIsaidubSpecific(query) {
    const results = [];
    const $ = await fetchPage(`${ISAIDUB_BASE_URL}/tamil-dubbed-movies-download/`);
    if (!$) return results;

    const targetYears = ['2026', '2025', '2024'];
    const matchingCategories = [];

    $('.f a').each((_, el) => {
        const text = $(el).text();
        const href = $(el).attr('href');
        // Strictly Tamil only
        const isTamil = text.toLowerCase().includes('tamil') || href?.toLowerCase().includes('tamil');

        if (isTamil && (targetYears.some(y => text.includes(y)) || fuzzyMatch(text, query))) {
            matchingCategories.push({
                url: href.startsWith('http') ? href : `${ISAIDUB_BASE_URL}${href}`,
                year: text.match(/\d{4}/)?.[0] || 'Dubbed'
            });
        }
    });

    // Limit to 2 most relevant categories to keep search fast
    for (const cat of matchingCategories.slice(0, 2)) {
        const movies = await scrapeAllPages(cat.url, 1, cat.year);
        // Ensure only Tamil results are merged
        results.push(...movies.map(m => ({ ...m, source: 'isaidub' })));
    }

    return results;
}

/**
 * Specifically search web series section
 */
async function searchWebSeriesSpecific(query) {
    const results = [];
    const webSeriesUrl = `${BASE_URL}/tamil-web-series-download/`;
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
                url: href.startsWith('http') ? href : `${BASE_URL}${href}`,
                year: text.match(/\d{4}/)?.[0] || 'Web Series'
            });
        }
    });

    // Increase range to get more results (User requested > 10)
    for (const folder of matchingFolders.slice(0, 6)) {
        const items = await scrapeAllPages(folder.url, 1, folder.year);
        results.push(...items.map(m => ({ ...m, source: 'webseries' })));
    }

    return results;
}
