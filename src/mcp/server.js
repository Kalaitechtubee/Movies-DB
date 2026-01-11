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
            text += `\n• **${res.quality}**\n  File: ${res.name}\n  Link: ${res.downloadUrl}\n`;
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

export { mcpServer };
