/**
 * isaiDub Parser Module
 * 
 * Extracts and structures data from isaiDub pages.
 */

import config from './config.js';
import { fetchPage, followDownloadLinks } from './scraper.js';
import { cleanDisplayTitle } from '../../matching/normalizeTitle.js';

/**
 * Get poster URL from a movie page
 */
export async function getQuickPoster(url) {
    try {
        const $ = await fetchPage(url);
        if (!$) return null;

        let posters = [];
        $('meta[property="og:image"], meta[name="twitter:image"]').each((_, el) => {
            const content = $(el).attr('content');
            if (content) posters.push(content);
        });

        $('link[rel="image_src"], center img, .line img, .f img, img[src*=".jp"]').each((_, el) => {
            const src = $(el).attr('src');
            if (src) posters.push(src);
        });

        let poster = null;
        for (let p of posters) {
            if (!p) continue;
            if (p.includes('folder.svg') || p.includes('folder.png') || p.includes('loader') || p.includes('icon') || p.includes('logo')) continue;
            poster = p;
            break;
        }

        if (poster && !poster.startsWith('http')) {
            const urlObj = new URL(url);
            poster = `${urlObj.origin}${poster.startsWith('/') ? '' : '/'}${poster}`;
        }

        if (poster && (poster.includes('folder.svg') || poster.includes('folder.png') ||
            poster.includes('loader') || poster.includes('icon'))) {
            return null;
        }

        return poster;
    } catch (e) {
        return null;
    }
}

/**
 * Parse movie details page
 */
export async function parseMovieDetails(movieUrl, query = '') {
    const $ = await fetchPage(movieUrl);
    if (!$) return null;

    const pageTitle = ($('h1').text() || $('title').text() || '').trim();
    let movieTitle = '';

    $('.line, b, strong, .movie-info li').each((_, el) => {
        const $el = $(el);
        const text = $el.text().trim();

        if (text.match(/Movie:|Series:/i)) {
            movieTitle = $el.find('span').text().trim() ||
                text.replace(/Movie:|Series:/i, '').trim();
            if (movieTitle) return false;
        }
    });

    if (!movieTitle) {
        movieTitle = cleanDisplayTitle(pageTitle);
    }

    const details = {
        title: movieTitle,
        url: movieUrl,
        poster_url: await getQuickPoster(movieUrl),
        resolutions: []
    };

    // Check for specific fields in .movie-info
    $('.movie-info li').each((_, el) => {
        const text = $(el).text().trim();
        if (text.includes('Director:')) details.director = $(el).find('span').text().trim();
        if (text.includes('Starring:')) details.starring = $(el).find('span').text().trim();
        if (text.includes('Genres:')) details.genres = $(el).find('span').text().trim();
        if (text.includes('Language:')) details.language = $(el).find('span').text().trim();
        if (text.includes('Rating:')) details.rating = $(el).find('span').text().trim();
    });

    const qualityMatch = details.title.match(/HD|720p|1080p|DVD|HDRip|BDRip|Dub/i) ||
        $.text().match(/Quality\s*:\s*([^<\n\r]+)/i);
    details.quality = qualityMatch ?
        (Array.isArray(qualityMatch) ? qualityMatch[1] || qualityMatch[0] : qualityMatch) : 'DVD/HD';

    details.synopsis = $('.movie-synopsis').text().trim() ||
        $('.line:contains("Synopsis")').next().text().trim() ||
        $('.line').last().text().trim();

    if ((details.synopsis?.length || 0) < 10) {
        details.synopsis = `Watch ${details.title} online in high quality (Tamil Dubbed).`;
    }

    // Explore for file links
    const discoveredFiles = new Map();
    const visited = new Set();

    let targetEpi = null;
    if (query) {
        const epiMatch = query.match(/E(?:p|pisode)?\s?(\d+)/i);
        if (epiMatch) targetEpi = parseInt(epiMatch[1]);
    }

    async function explore(url, currentQuality = 'Unknown', depth = 0) {
        const cleanUrl = url.split('#')[0];
        if (depth > 6 || visited.has(cleanUrl)) return;
        visited.add(cleanUrl);

        const $page = await fetchPage(url);
        if (!$page) return;

        const links = [];
        $page('.f a, .folder a, a.coral, .line a, .dlink a, .dlink2 a, a[href*="/download/page/"]').each((_, el) => {
            const text = $page(el).text().trim();
            const href = $page(el).attr('href');
            if (!href || href === '#' || href.startsWith('javascript:') || href.includes('folder.svg') || href.includes('index.html')) return;

            if (text.length <= 1 && depth === 0 && !href.includes('?page=')) return;
            if (/^[A-Z]$/.test(text) || text === '0-9' || text === 'Disclaimer' || text === 'Home') return;

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
                links.push({ text, url: fullUrl.split('#')[0] });
            } catch {
                // Ignore invalid URLs
            }
        });

        if (links.length > 0) {
            console.log(`[Explore] Depth ${depth}: Found ${links.length} links on ${url}`);
            links.forEach(l => console.log(`  - Text: "${l.text}", URL: ${l.url}`));
        }

        for (const link of links) {
            const { text, url: linkUrl } = link;

            const isFile = text.match(/\.(mp4|mkv|avi|webm)$/i) || linkUrl.includes('/download/page/');
            const isEpisode = text.match(/Epi|Episode|Day|Part|Season|S\d+E\d+/i);
            const isQuality = text.match(/HD|Original|720p|1080p|DVD|480p|360p/i);
            const isPagination = linkUrl.includes('?page=') || linkUrl.includes('.html');

            if (targetEpi !== null && isEpisode) {
                const linkEpiMatch = text.match(/E(?:p|pisode)?\s?(\d+)/i);
                if (linkEpiMatch && parseInt(linkEpiMatch[1]) !== targetEpi) {
                    if (!isFile) continue;
                }
            }

            if (isFile) {
                if (!discoveredFiles.has(linkUrl)) {
                    let finalQuality = currentQuality;

                    if (finalQuality === 'Unknown' || finalQuality === 'Episode') {
                        const qMatch = text.match(/1080p|720p|480p|360p/i);
                        if (qMatch) {
                            const val = qMatch[0].toLowerCase();
                            if (val.includes('1080')) finalQuality = '1080p';
                            else if (val.includes('720')) finalQuality = '720p';
                            else if (val.includes('480')) finalQuality = '480p';
                            else if (val.includes('360')) finalQuality = '360p';
                        }
                    }

                    // Extract season and episode
                    let season = 1;
                    let episode = null;

                    const sMatch = text.match(/\bS(?:eason)?\s?(\d+)\b/i) || url.match(/Season-(\d+)/i);
                    if (sMatch) {
                        const sVal = parseInt(sMatch[1]);
                        if (sVal < 50) season = sVal; // Filter out years like 2026
                    }

                    const eMatch = text.match(/\bE(?:p|pisode)?\s?(\d+)\b/i) ||
                        text.match(/\bDay\s?(\d+)\b/i) ||
                        text.match(/\bPart\s?(\d+)\b/i) ||
                        text.match(/\(Epi\s?(\d+)\)/i);

                    if (eMatch) {
                        episode = parseInt(eMatch[1]);
                    }

                    discoveredFiles.set(linkUrl, {
                        quality: finalQuality,
                        name: text,
                        url: linkUrl,
                        season,
                        episode
                    });
                }
            } else if (isPagination || isQuality || isEpisode || depth < 4) {
                let nextQuality = currentQuality;

                if (isQuality && !isEpisode) {
                    const normalized = text.toLowerCase();
                    if (normalized.includes('1080')) nextQuality = '1080p';
                    else if (normalized.includes('720')) nextQuality = '720p';
                    else if (normalized.includes('480')) nextQuality = '480p';
                    else if (normalized.includes('hd')) nextQuality = 'HD';
                    else nextQuality = text;
                } else if (isEpisode && currentQuality === 'Unknown') {
                    nextQuality = 'Episode';
                }

                const nextDepth = isPagination ? depth : depth + 1;
                await explore(linkUrl, nextQuality, nextDepth);
            }
        }
    }

    await explore(movieUrl, 'Unknown', 0);

    const sortedResolutions = Array.from(discoveredFiles.values()).sort((a, b) => {
        const aNum = a.name.match(/(\d+)/)?.[0];
        const bNum = b.name.match(/(\d+)/)?.[0];
        if (aNum && bNum) return parseInt(bNum) - parseInt(aNum);
        return b.name.localeCompare(a.name);
    });

    details.resolutions = sortedResolutions;

    const isSeries = details.resolutions.some(r =>
        r.name.match(/Epi|Episode|Day|Part|Season|S\d+E\d+/i)
    ) || details.title.toLowerCase().includes('series');

    details.type = isSeries ? 'series' : 'movie';

    // Get download links
    const CONCURRENCY = 5;
    const itemsToProcess = details.resolutions.slice(0, 100);

    for (let i = 0; i < itemsToProcess.length; i += CONCURRENCY) {
        const batch = itemsToProcess.slice(i, i + CONCURRENCY);
        await Promise.all(batch.map(async (item) => {
            try {
                const $file = await fetchPage(item.url);
                if (!$file) return;

                let downloadLink = $file('a:contains("Download Server 1")').attr('href') ||
                    $file('a:contains("Download Server")').attr('href') ||
                    $file('a:contains("Download")').attr('href');

                if (downloadLink) {
                    const fullDlUrl = downloadLink.startsWith('http') ? downloadLink :
                        downloadLink.startsWith('/') ? `${config.baseUrl}${downloadLink}` :
                            `${item.url.substring(0, item.url.lastIndexOf('/') + 1)}${downloadLink}`;

                    const finalLinks = await followDownloadLinks(fullDlUrl);
                    item.downloadUrl = fullDlUrl;
                    item.directUrl = finalLinks.directLink;
                    item.watchUrl = finalLinks.watchLink;
                    item.streamSource = finalLinks.streamSource;

                    const sizeMatch = item.name.match(/\(([\d.]+\s*(?:MB|GB|KB))\)/i);
                    if (sizeMatch) item.size = sizeMatch[1];
                }
            } catch (err) {
                console.warn(`Error processing ${item.url}: ${err.message}`);
            }
        }));
    }

    if (targetEpi !== null) {
        details.resolutions = details.resolutions.filter(r => {
            const rEpiMatch = r.name.match(/E(?:p|pisode)?\s?(\d+)/i);
            return rEpiMatch && parseInt(rEpiMatch[1]) === targetEpi;
        });
    }

    return details;
}

export default {
    getQuickPoster,
    parseMovieDetails
};
