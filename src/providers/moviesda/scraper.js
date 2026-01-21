/**
 * Moviesda Scraper Module
 * 
 * Low-level scraping functions for Moviesda website.
 * This handles the actual HTTP requests and HTML parsing.
 */

import axios from 'axios';
import * as cheerio from 'cheerio';
import config from './config.js';

/**
 * Fetch and parse a webpage
 * @param {string} url - URL to fetch
 * @returns {Promise<CheerioAPI|null>} Cheerio instance or null on failure
 */
export async function fetchPage(url) {
    try {
        const response = await axios.get(url, {
            headers: {
                ...config.headers,
                'Referer': config.baseUrl
            },
            timeout: config.requestTimeout
        });

        const $ = cheerio.load(response.data);

        // Check for blocked content
        if ($.text().trim() === 'Not Allowed') {
            console.warn(`Access blocked for: ${url}`);
            return null;
        }

        return $;
    } catch (error) {
        const statusCode = error.response?.status;
        console.error(`Failed to fetch ${url}: ${statusCode || error.message}`);
        return null;
    }
}

/**
 * Scrape a single page and extract movie entries
 * @param {CheerioAPI} $ - Cheerio instance
 * @param {string} year - Year to assign
 * @returns {Array} Movie objects
 */
export function parseMovieList($, year = 'Unknown') {
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
        if (isFiltered) return;

        const fullUrl = href.startsWith('http') ? href : `${config.baseUrl}${href.startsWith('/') ? '' : '/'}${href}`;

        // Extract quality from font tag if present
        const quality = $(element).find('font[color="blue"]').text().trim() || 'DVD/HD';

        // Extract poster if present
        const poster = $(element).find('img').attr('src');
        const fullPosterUrl = poster && !poster.includes('folder') && !poster.includes('dir.gif')
            ? (poster.startsWith('http') ? poster : `${config.baseUrl}${poster.startsWith('/') ? '' : '/'}${poster}`)
            : null;

        movies.push({
            title,
            url: fullUrl,
            year,
            poster: fullPosterUrl,
            quality: quality || 'DVD/HD'
        });
    });

    return movies;
}

/**
 * Scrape all pages from a category URL
 * @param {string} baseUrl - Base category URL
 * @param {number} maxPages - Maximum pages to scrape
 * @param {string} year - Year to assign
 * @returns {Promise<Array>} All movies found
 */
export async function scrapeAllPages(baseUrl, maxPages = 5, year = 'Unknown') {
    const allMovies = [];

    // Fetch first page
    const $first = await fetchPage(baseUrl);
    if (!$first) return allMovies;

    allMovies.push(...parseMovieList($first, year));

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

    // Fetch remaining pages in batches
    const CONCURRENT_BATCH = 5;
    const remainingPages = [];
    for (let p = 2; p <= pagesToScrape; p++) remainingPages.push(p);

    for (let i = 0; i < remainingPages.length; i += CONCURRENT_BATCH) {
        const batch = remainingPages.slice(i, i + CONCURRENT_BATCH);
        const batchPromises = batch.map(async (page) => {
            const separator = baseUrl.includes('?') ? '&' : '?';
            const pageUrl = `${baseUrl}${separator}page=${page}`;
            const $page = await fetchPage(pageUrl);
            if ($page) {
                return parseMovieList($page, year);
            }
            return [];
        });

        const batchResults = await Promise.all(batchPromises);
        batchResults.forEach(movies => allMovies.push(...movies));
    }

    return allMovies;
}

/**
 * Get the stream source URL from watch page
 * @param {string} watchUrl - Watch URL (onestream, biggshare, etc.)
 * @returns {Promise<string|null>} Direct stream URL
 */
export async function getStreamSource(watchUrl) {
    if (!watchUrl) return null;

    // Handle direct video links immediately
    if (watchUrl.match(/\.(mp4|mkv|webm|avi)$/i)) {
        return watchUrl;
    }

    // Handle PixelDrain
    if (watchUrl.includes('pixeldrain.com/u/')) {
        return watchUrl.replace('pixeldrain.com/u/', 'pixeldrain.com/api/file/');
    }

    try {
        const urlObj = new URL(watchUrl);
        const response = await axios.get(watchUrl, {
            headers: {
                ...config.headers,
                'Referer': urlObj.origin
            },
            timeout: 10000
        });
        const $ = cheerio.load(response.data);

        // Check various video sources
        let source = $('video source').attr('src');
        if (!source) source = $('video').attr('src');
        if (!source) source = $('iframe').attr('src');
        if (!source) source = $('embed').attr('src');

        // Also look for download buttons on this page (if it's a player page)
        if (!source) {
            const dl = $('a:contains("Download")').attr('href') ||
                $('a:contains("Original")').attr('href') ||
                $('a[href*="download"]').attr('href');
            if (dl && dl.match(/\.(mp4|mkv|webm|avi)$/i)) {
                source = dl;
            }
        }

        if (!source) {
            $('script').each((_, el) => {
                const text = $(el).html();
                if (text) {
                    // Try multiple patterns
                    const patterns = [
                        /source:\s*["'](.+?)["']/,
                        /file:\s*["'](.+?)["']/,
                        /mp4:\s*["'](.+?)["']/,
                        /url:\s*["'](.+?)["']/,
                        /link:\s*["'](.+?)["']/
                    ];

                    for (const pattern of patterns) {
                        const match = text.match(pattern);
                        if (match && !match[1].includes('analytics') && !match[1].includes('ads')) {
                            source = match[1];
                            break;
                        }
                    }
                }
                return !source; // stop if found
            });
        }

        if (source && !source.startsWith('http') && !source.startsWith('blob:')) {
            try {
                const urlObj = new URL(watchUrl);
                source = `${urlObj.origin}${source.startsWith('/') ? '' : '/'}${source}`;
            } catch (e) {
                // Ignore invalid URLs
            }
        }

        return source;
    } catch (error) {
        console.warn(`Failed to get stream source for ${watchUrl}: ${error.message}`);
        return null;
    }
}

/**
 * Follow download links to find final URLs
 * @param {string} url - Initial download URL
 * @returns {Promise<Object>} Object with directLink, watchLink, streamSource
 */
export async function followDownloadLinks(url) {
    let currentUrl = url;
    const result = { directLink: null, watchLink: null, streamSource: null };

    // Max depth of 5 to prevent infinite loops
    for (let i = 0; i < 5; i++) {
        const $ = await fetchPage(currentUrl);
        if (!$) break;

        // Look for direct file links
        let foundLink = null;
        $('a').each((_, el) => {
            const href = $(el).attr('href');
            const text = $(el).text().trim();
            if (!href) return;

            // Known file hosts
            const knownHosts = [
                'hotshare.link', 'uptobox.com', '1fichier.com', 'pixeldrain.com',
                'biggshare.xyz', 'cdnserver', 'onestream.watch', 'play.onestream.watch',
                'gofile.io', 'drive.google.com', 'mega.nz', 'mediafire.com', 'vidfiles.'
            ];

            if (knownHosts.some(host => href.includes(host))) {
                if (href.includes('vidfiles') && (text.includes('Download') || text.includes('Server'))) {
                    foundLink = href;
                } else if (href.match(/\.(mp4|mkv|webm|avi)$/i) || href.includes('download') || href.includes('drive')) {
                    foundLink = href;
                } else {
                    // Default to whatever link was found if it matches a known host
                    foundLink = href;
                }
                return false;
            }

            // Download server text pointing to external
            if ((text.match(/Download Server/i) || text.match(/Go To/i)) &&
                href.startsWith('http') && !href.includes('moviesda')) {
                foundLink = href;
                return false;
            }
        });

        if (foundLink) {
            result.directLink = foundLink;

            // Check for watch link
            if (foundLink.includes('onestream.watch')) {
                result.watchLink = foundLink;
            } else {
                const watchOnline = $('a:contains("Watch Online")').first().attr('href') ||
                    $('a[href*="onestream.watch"]').first().attr('href');
                if (watchOnline) result.watchLink = watchOnline;
            }
            break;
        }

        // Look for next download link
        const nextLink = $('a:contains("Download Server 1")').first().attr('href') ||
            $('a:contains("Download Server")').first().attr('href') ||
            $('a:contains("Download Now")').first().attr('href') ||
            $('a:contains("Go To Download Page")').first().attr('href') ||
            $('a.dwnLink').first().attr('href') ||
            $('a:contains("Download")').first().attr('href');

        if (nextLink && nextLink !== currentUrl && !nextLink.match(/\.(mp4|mkv)$/i)) {
            const previousUrl = currentUrl;
            if (nextLink.startsWith('http')) {
                currentUrl = nextLink;
            } else if (nextLink.startsWith('/')) {
                const urlObj = new URL(currentUrl);
                currentUrl = `${urlObj.protocol}//${urlObj.host}${nextLink}`;
            } else {
                // relative to current
                const lastSlash = currentUrl.lastIndexOf('/');
                currentUrl = `${currentUrl.substring(0, lastSlash + 1)}${nextLink}`;
            }
            console.debug(`Redirecting to: ${currentUrl} (from ${previousUrl})`);
        } else {
            break;
        }
    }

    // Get stream source
    if (result.watchLink) {
        result.streamSource = await getStreamSource(result.watchLink);
    }

    // If we still don't have a stream source but we have a direct link, 
    // check if the direct link itself is playable
    if (!result.streamSource && result.directLink) {
        result.streamSource = await getStreamSource(result.directLink);
    }

    // Set final direct link to stream source if it's a direct file
    if (result.streamSource && result.streamSource.match(/\.(mp4|mkv|webm|avi)$/i)) {
        result.directLink = result.streamSource;
    }

    return result;
}

export default {
    fetchPage,
    parseMovieList,
    scrapeAllPages,
    getStreamSource,
    followDownloadLinks
};
