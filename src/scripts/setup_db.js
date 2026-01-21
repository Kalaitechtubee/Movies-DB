import supabase from '../utils/supabase.js';
import logger from '../utils/logger.js';
import dotenv from 'dotenv';
dotenv.config();

const SQL = `
-- 1. Movies table (Scraper Fallback)
CREATE TABLE IF NOT EXISTS movies (
    id SERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    url TEXT NOT NULL UNIQUE,
    year TEXT,
    quality TEXT,
    poster_url TEXT,
    rating TEXT,
    director TEXT,
    starring TEXT,
    genres TEXT,
    synopsis TEXT,
    crawled_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Unified Movies table (Production Catalog)
CREATE TABLE IF NOT EXISTS unified_movies (
    id SERIAL PRIMARY KEY,
    tmdb_id INTEGER UNIQUE,
    title TEXT NOT NULL,
    year TEXT,
    rating TEXT,
    poster_url TEXT,
    backdrop_url TEXT,
    overview TEXT,
    genres TEXT,
    runtime INTEGER,
    language_type TEXT,
    movie_cast JSONB,
    director TEXT,
    trailer_key TEXT,
    watch_links JSONB,
    download_links JSONB,
    confidence_score INTEGER,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Indexes for fast searching
CREATE INDEX IF NOT EXISTS idx_movies_title ON movies USING gin(to_tsvector('english', title));
CREATE INDEX IF NOT EXISTS idx_unified_tmdb_id ON unified_movies(tmdb_id);
CREATE INDEX IF NOT EXISTS idx_unified_lang ON unified_movies(language_type);
CREATE INDEX IF NOT EXISTS idx_unified_title ON unified_movies USING gin(to_tsvector('english', title));
`;

async function setup() {
    logger.info('🚀 Starting Supabase schema setup...');

    if (!supabase) {
        logger.error('❌ Supabase client not initialized. Check your .env file.');
        return;
    }

    logger.info('⚠️ IMPORTANT: This script cannot run raw SQL directly through the anon/service key due to Supabase security.');
    logger.info('Please copy the following SQL and run it in your Supabase SQL Editor:');
    console.log('\n' + '='.repeat(50));
    console.log(SQL);
    console.log('='.repeat(50) + '\n');

    try {
        // Just verify connection
        const { data, error } = await supabase.from('movies').select('id').limit(1);
        if (error && (error.code === '42P01' || error.message.includes('does not exist'))) {
            logger.warn('Table "movies" does not exist yet. Please run the SQL above.');
        } else {
            logger.info('✅ Database connection verified.');
        }
    } catch (err) {
        logger.error('Connection failed:', err.message);
    }
}

setup();
