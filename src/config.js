/**
 * Application Configuration
 * Centralized configuration for the Moviesda MCP Server
 */

import dotenv from 'dotenv';
dotenv.config();

// Server Configuration
export const PORT = process.env.ZOHO_CATALYST_LISTEN_PORT || process.env.PORT || 9000;

// Supabase Configuration
export const SUPABASE_URL = process.env.SUPABASE_URL;
export const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
export const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
export const TMDB_API_KEY = process.env.TMDB_API_KEY;

// Target Website Configuration
export const BASE_URL = 'https://moviesda15.com';
export const ISAIDUB_BASE_URL = 'https://isaidub.love';

// HTTP Request Configuration
export const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export const REQUEST_HEADERS = {
    'User-Agent': USER_AGENT,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.5',
    'Referer': BASE_URL,
    'Connection': 'keep-alive',
    'Upgrade-Insecure-Requests': '1',
    'Cache-Control': 'max-age=0'
};

// Scraping Configuration
export const SCRAPE_CONFIG = {
    maxPagesPerCategory: 15,    // Maximum pages to scrape per A-Z category
    maxPagesPerYear: 10,        // Maximum pages to scrape per year category
    recentYearsThreshold: 2024, // Only search years >= this value
    requestTimeout: 10000       // HTTP request timeout in ms
};

// Logging Configuration
export const LOG_LEVEL = process.env.LOG_LEVEL || 'info'; // 'debug', 'info', 'warn', 'error'