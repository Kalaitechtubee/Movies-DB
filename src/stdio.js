/**
 * STDIO Transport Entry Point
 * For running MCP server via standard input/output (Claude Desktop)
 */

import 'dotenv/config';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { createClient } from '@supabase/supabase-js';
import axios from 'axios';
import * as cheerio from 'cheerio';

// Configuration
const BASE_URL = 'https://moviesda15.com';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const REQUEST_HEADERS = {
    'User-Agent': USER_AGENT,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.5',
    'Referer': BASE_URL,
    'Connection': 'keep-alive'
};

// Supabase client (optional - graceful fallback if not configured)
let supabase = null;
try {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (url && key) {
        supabase = createClient(url, key, {
            auth: { autoRefreshToken: false, persistSession: false }
        });
    }
} catch (err) {
    // Supabase not configured - will work without caching
}

// MCP Server
const server = new Server(
    { name: 'moviesda', version: '1.0.0' },
    { capabilities: { tools: {} } }
);

// Tools
const TOOLS = [
    {
        name: 'search_movies',
        description: 'Search for Tamil movies by name. Returns movie titles, years, and URLs.',
        inputSchema: {
            type: 'object',
            properties: {
                query: { type: 'string', description: 'The movie name to search for' }
            },
            required: ['query']
        }
    },
    {
        name: 'get_download_links',
        description: 'Get download links for a movie. Requires the movie URL from search results.',
        inputSchema: {
            type: 'object',
            properties: {
                url: { type: 'string', description: 'The full URL of the movie page' }
            },
            required: ['url']
        }
    }
];

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
        if (name === 'search_movies') {
            return await searchMovies(args.query);
        } else if (name === 'get_download_links') {
            return await getDownloadLinks(args.url);
        }
        throw new Error(`Unknown tool: ${name}`);
    } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${error.message}` }] };
    }
});

// Fetch page helper
async function fetchPage(url) {
    try {
        const response = await axios.get(url, { headers: REQUEST_HEADERS, timeout: 15000 });
        const $ = cheerio.load(response.data);
        if ($.text().trim() === 'Not Allowed') return null;
        return $;
    } catch {
        return null;
    }
}

// Parse movies from page
function parseMovies($, year = 'Unknown') {
    const movies = [];
    const filters = ['Tamil 20', 'Subtitles', 'Page', 'தமிழ்'];

    $('.f').each((_, el) => {
        const link = $(el).find('a').first();
        const href = link.attr('href');
        let title = $(el).find('b').text().trim() || link.text().trim();
        title = title.replace(/\s+/g, ' ').trim();

        if (!title || !href) return;
        if (filters.some(f => title.includes(f))) return;

        const fullUrl = href.startsWith('http') ? href : `${BASE_URL}${href}`;
        movies.push({ title, url: fullUrl, year, quality: 'DVD/HD' });
    });

    return movies;
}

// Scrape all pages
async function scrapePages(baseUrl, maxPages, year) {
    const allMovies = [];
    const $first = await fetchPage(baseUrl);
    if (!$first) return allMovies;

    allMovies.push(...parseMovies($first, year));

    let totalPages = 1;
    $first('a[href*="?page="]').each((_, el) => {
        const match = $first(el).attr('href')?.match(/page=(\d+)/);
        if (match) totalPages = Math.max(totalPages, parseInt(match[1]));
    });

    const pages = Math.min(totalPages, maxPages);
    for (let p = 2; p <= pages; p++) {
        const sep = baseUrl.includes('?') ? '&' : '?';
        const $page = await fetchPage(`${baseUrl}${sep}page=${p}`);
        if ($page) allMovies.push(...parseMovies($page, year));
    }

    return allMovies;
}

// Search movies
async function searchMovies(query) {
    if (!query || typeof query !== 'string') {
        throw new Error('Invalid query');
    }

    const normalizedQuery = query.toLowerCase();
    const potentialMovies = [];

    // Search A-Z category
    const firstChar = normalizedQuery.charAt(0);
    if (/[a-z]/.test(firstChar)) {
        const movies = await scrapePages(`${BASE_URL}/tamil-movies/${firstChar}/`, 15, 'Unknown');
        potentialMovies.push(...movies);
    }

    // Search recent years
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
            const movies = await scrapePages(item.url, 10, item.year);
            potentialMovies.push(...movies);
        }
    }

    // Filter and dedupe
    const uniqueMovies = new Map();
    potentialMovies.forEach(m => {
        if (m.title.toLowerCase().includes(normalizedQuery)) {
            uniqueMovies.set(m.url, m);
        }
    });

    const results = Array.from(uniqueMovies.values());

    // Cache to Supabase if available
    if (supabase && results.length > 0) {
        try {
            const records = results.map(m => ({
                title: m.title, url: m.url, year: m.year, quality: m.quality,
                crawled_at: new Date().toISOString()
            }));
            await supabase.from('movies').upsert(records, { onConflict: 'url', ignoreDuplicates: true });
        } catch { }
    }

    if (results.length === 0) {
        return { content: [{ type: 'text', text: 'No movies found matching your query.' }] };
    }

    const formatted = results.map(m => `Title: ${m.title} | Year: ${m.year} | Link: ${m.url}`).join('\n');
    return { content: [{ type: 'text', text: formatted }] };
}

// Get download links
async function getDownloadLinks(url) {
    if (!url || typeof url !== 'string') {
        throw new Error('Invalid URL');
    }

    const $ = await fetchPage(url);
    if (!$) {
        return { content: [{ type: 'text', text: 'Failed to fetch movie page.' }] };
    }

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

    // Find resolution links
    const resLinks = [];
    $('.f a').each((_, el) => {
        const text = $(el).text();
        const href = $(el).attr('href');
        if (!href || href.includes('folder.svg')) return;

        if (text.includes('HD') || text.includes('Original') || text.includes('DVD')) {
            resLinks.push({ text, url: href.startsWith('http') ? href : `${BASE_URL}${href}` });
        }
    });

    // Fetch file links from resolution pages
    for (const res of resLinks) {
        const $res = await fetchPage(res.url);
        if (!$res) continue;

        $res('.f a').each((_, el) => {
            const text = $res(el).text();
            const href = $res(el).attr('href');
            if (href && (text.includes('.mp4') || text.includes('HD') || text.includes('Rip'))) {
                details.resolutions.push({
                    quality: res.text,
                    name: text,
                    url: href.startsWith('http') ? href : `${BASE_URL}${href}`
                });
            }
        });
    }

    // Get actual download links
    for (const item of details.resolutions) {
        const $file = await fetchPage(item.url);
        if (!$file) continue;
        const link = $file('a:contains("Download Server 1")').attr('href');
        if (link) item.downloadUrl = link;
    }

    let text = `🎬 **${details.title}**\n`;
    if (details.rating) text += `⭐ Rating: ${details.rating}\n`;
    if (details.director) text += `🎥 Director: ${details.director}\n`;
    if (details.starring) text += `🌟 Starring: ${details.starring}\n`;
    if (details.genres) text += `🏷️ Genres: ${details.genres}\n`;
    text += `\n📝 **Synopsis:**\n${details.synopsis || 'No synopsis available.'}\n\n`;

    const validLinks = details.resolutions.filter(r => r.downloadUrl);

    if (validLinks.length > 0) {
        text += `⬇️ **Download Links:**\n`;
        validLinks.forEach(r => {
            text += `\n• **${r.quality}**\n  File: ${r.name}\n  Link: ${r.downloadUrl}\n`;
        });
    } else {
        text += '⚠️ No download links available at this time.';
    }

    if (details.screenshots && details.screenshots.length > 0) {
        text += `\n\n🖼️ **Screenshots:**\n`;
        details.screenshots.forEach(s => text += `${s}\n`);
    }

    return { content: [{ type: 'text', text }] };
}

// Run server
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
}

main().catch(() => process.exit(1));
