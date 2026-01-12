
import axios from 'axios';
import * as cheerio from 'cheerio';

const REQUEST_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': 'https://moviesda15.com/'
};

async function fetchPage(url) {
    try {
        console.log(`Fetching: ${url}`);
        const response = await axios.get(url, {
            headers: REQUEST_HEADERS,
            timeout: 10000
        });
        return cheerio.load(response.data);
    } catch (error) {
        console.error(`Failed to fetch ${url}: ${error.message}`);
        return null;
    }
}

async function getDirectLink(url) {
    let currentUrl = url;
    let directLink = null;
    let watchLink = null;

    for (let i = 0; i < 5; i++) {
        const $ = await fetchPage(currentUrl);
        if (!$) break;

        // Check for direct file link
        const fileLink = $('a').filter((_, el) => {
            const href = $(el).attr('href');
            return href && (href.endsWith('.mp4') || href.endsWith('.mkv') || href.includes('hotshare.link'));
        }).first().attr('href');

        if (fileLink) {
            directLink = fileLink;
            // Also try to find a watch link on the same page
            watchLink = $('a:contains("Watch Online")').first().attr('href');
            break;
        }

        // Look for "Download Server 1"
        const nextLink = $('a:contains("Download Server 1")').first().attr('href');
        if (nextLink && nextLink !== currentUrl) {
            // Handle relative URLs if necessary
            if (nextLink.startsWith('/')) {
                const urlObj = new URL(currentUrl);
                currentUrl = `${urlObj.protocol}//${urlObj.host}${nextLink}`;
            } else if (!nextLink.startsWith('http')) {
                const urlObj = new URL(currentUrl);
                const path = urlObj.pathname.substring(0, urlObj.pathname.lastIndexOf('/') + 1);
                currentUrl = `${urlObj.protocol}//${urlObj.host}${path}${nextLink}`;
            } else {
                currentUrl = nextLink;
            }
        } else {
            break;
        }
    }
    return { directLink, watchLink };
}

async function test() {
    const startUrl = 'https://moviesda15.com/parasakthi-hq-predvd-movie/';
    const $ = await fetchPage(startUrl);

    const resolutions = [];
    $('.f a').each((_, el) => {
        const text = $(el).text();
        const href = $(el).attr('href');
        if (text.includes('HD') || text.includes('1080p') || text.includes('720p')) {
            resolutions.push({
                text,
                url: href.startsWith('http') ? href : `https://moviesda15.com${href}`
            });
        }
    });

    console.log('Resolutions found:', resolutions);

    for (const res of resolutions) {
        console.log(`\nProcessing resolution: ${res.text}`);
        const $res = await fetchPage(res.url);
        if (!$res) continue;

        const fileLinks = [];
        $res('.f a, .folder a').each((_, el) => {
            const text = $res(el).text();
            const href = $res(el).attr('href');
            if (href && (text.includes('.mp4') || text.includes('HD'))) {
                fileLinks.push({
                    text,
                    url: href.startsWith('http') ? href : `https://moviesda15.com${href}`
                });
            }
        });

        for (const file of fileLinks) {
            console.log(`  File: ${file.text}`);
            const $file = await fetchPage(file.url);
            if (!$file) continue;

            const dlServer1 = $file('a:contains("Download Server 1")').first().attr('href');
            if (dlServer1) {
                const fullDlUrl = dlServer1.startsWith('http') ? dlServer1 : `https://moviesda15.com${dlServer1}`;
                const finalLinks = await getDirectLink(fullDlUrl);
                console.log(`    Direct Link: ${finalLinks.directLink}`);
                console.log(`    Watch Link: ${finalLinks.watchLink}`);
            }
        }
    }
}

test();
