/**
 * MCP Server Handler
 * Defines MCP tools and handles tool execution
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { initDb, searchMovies } from '../services/database.js';
import { searchMoviesDirect, getMovieDownloadLinks, scrapeHome } from '../services/scraper.js';
import { performUnifiedSearch } from '../services/unifiedSearch.js';
import logger from '../utils/logger.js';

// Initialize database
initDb();

// MCP Server instance
const mcpServer = new Server(
    {
        name: 'Moviesda Search',
        version: '1.0.0',
    },
    {
        capabilities: {
            tools: {},
        }
    }
);

// Tool definitions
const TOOLS = [
    {
        name: 'search_movies',
        description: 'Search for movies by name on the moviesda website. Returns movie titles, years, and URLs.',
        inputSchema: {
            type: 'object',
            properties: {
                query: {
                    type: 'string',
                    description: 'The movie name to search for'
                }
            },
            required: ['query']
        }
    },
    {
        name: 'get_download_links',
        description: 'Get download links for a specific movie. Requires the movie URL from search_movies results.',
        inputSchema: {
            type: 'object',
            properties: {
                url: {
                    type: 'string',
                    description: 'The full URL of the movie page from search_movies results'
                }
            },
            required: ['url']
        }
    },
    {
        name: 'refresh_database',
        description: 'Refresh the local movie database by scraping the website. Runs in background.',
        inputSchema: {
            type: 'object',
            properties: {}
        }
    },
    {
        name: 'unified_movie_search',
        description: 'Comprehensive unified search combining official metadata and download links. Recommended for end users.',
        inputSchema: {
            type: 'object',
            properties: {
                query: {
                    type: 'string',
                    description: 'The movie name (and optionally year) to search for'
                }
            },
            required: ['query']
        }
    }
];

// Register tool list handler
mcpServer.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: TOOLS };
});

// Register tool execution handler
mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
        switch (name) {
            case 'search_movies':
                return await handleSearchMovies(args);

            case 'get_download_links':
                return await handleGetDownloadLinks(args);

            case 'refresh_database':
                return await handleRefreshDatabase();

            case 'unified_movie_search':
                return await handleUnifiedMovieSearch(args);

            default:
                throw new Error(`Unknown tool: ${name}`);
        }
    } catch (error) {
        logger.error(`Tool execution error (${name}):`, error.message);
        return {
            content: [{
                type: 'text',
                text: `Error: ${error.message}`
            }]
        };
    }
});

/**
 * Handle search_movies tool
 */
async function handleSearchMovies(args) {
    const { query } = args;

    if (!query || typeof query !== 'string') {
        throw new Error('Invalid query: must be a non-empty string');
    }

    const results = await searchMoviesDirect(query);

    if (results.length === 0) {
        return {
            content: [{
                type: 'text',
                text: 'No movies found matching your query.'
            }]
        };
    }

    const formatted = results
        .map(m => `Title: ${m.title} | Year: ${m.year} | Link: ${m.url}`)
        .join('\n');

    return {
        content: [{ type: 'text', text: formatted }]
    };
}

/**
 * Handle get_download_links tool
 */
async function handleGetDownloadLinks(args) {
    const { url } = args;

    if (!url || typeof url !== 'string') {
        throw new Error('Invalid URL: must be a non-empty string');
    }

    const details = await getMovieDownloadLinks(url);

    if (!details) {
        return {
            content: [{
                type: 'text',
                text: 'Failed to fetch movie details. The page may not be accessible.'
            }]
        };
    }

    let text = `🎬 **${details.title}**\n`;
    if (details.rating) text += `⭐ Rating: ${details.rating}\n`;
    if (details.director) text += `🎥 Director: ${details.director}\n`;
    if (details.starring) text += `🌟 Starring: ${details.starring}\n`;
    if (details.genres) text += `🏷️ Genres: ${details.genres}\n`;
    if (details.lastUpdated) text += `🕒 Updated: ${details.lastUpdated}\n`;
    text += `\n📝 **Synopsis:**\n${details.synopsis || 'No synopsis available.'}\n\n`;

    const validLinks = details.resolutions.filter(r => r.downloadUrl);

    if (validLinks.length > 0) {
        text += `⬇️ **Download Links:**\n`;
        validLinks.forEach(res => {
            text += `\n• **${res.quality}**\n  File: ${res.name}\n  Server: ${res.downloadUrl}\n`;
            if (res.directUrl) text += `  ⚡ Direct DL: ${res.directUrl}\n`;
            if (res.watchUrl) text += `  🎬 Watch Online: ${res.watchUrl}\n`;
        });
    } else {
        text += '\n⚠️ No download links available at this time.';
    }

    if (details.screenshots && details.screenshots.length > 0) {
        text += `\n\n🖼️ **Screenshots:**\n`;
        details.screenshots.forEach(s => text += `${s}\n`);
    }

    return {
        content: [{ type: 'text', text }]
    };
}

/**
 * Handle refresh_database tool
 */
async function handleRefreshDatabase() {
    // Run scraping in background
    scrapeHome().catch(err => {
        logger.error('Background scrape error:', err.message);
    });

    return {
        content: [{
            type: 'text',
            text: 'Database refresh started in background.'
        }]
    };
}

/**
 * Handle unified_movie_search tool
 */
async function handleUnifiedMovieSearch(args) {
    const { query } = args;

    if (!query || typeof query !== 'string') {
        throw new Error('Invalid query: must be a non-empty string');
    }

    const result = await performUnifiedSearch(query);

    if (!result.found) {
        return {
            content: [{
                type: 'text',
                text: `No unified results found for "${query}".`
            }]
        };
    }

    const { movie } = result;
    let text = `🎬 **${movie.title} (${movie.year})**\n`;
    if (movie.rating) text += `⭐ Rating: ${movie.rating}/10\n`;
    if (movie.details?.director) text += `🎥 Director: ${movie.details.director}\n`;
    text += `\n📝 **Overview:**\n${movie.overview || 'No overview available.'}\n\n`;

    if (movie.downloads && movie.downloads.length > 0) {
        text += `⬇️ **Download/Watch Links (Moviesda):**\n`;
        movie.downloads.forEach(dl => {
            text += `\n• **${dl.quality}** (${dl.size})\n`;
            if (dl.direct_link) text += `  ⚡ [Fast Download](${dl.direct_link})\n`;
            if (dl.watch_link) text += `  🎬 [Watch Online](${dl.watch_link})\n`;
            if (dl.link) text += `  🔗 [Download Page](${dl.link})\n`;
        });
    } else {
        text += '\n⚠️ No direct download links found on Moviesda for this title.';
    }

    const images = [];
    if (movie.poster) images.push(movie.poster);
    if (movie.backdrop) images.push(movie.backdrop);

    const content = [{ type: 'text', text }];

    // Add images if any
    images.forEach(img => {
        content.push({
            type: 'text',
            text: `Image: ${img}` // MCP clients might handle this as rich text or we could use image type if supported
        });
    });

    return { content };
}

export { mcpServer };
