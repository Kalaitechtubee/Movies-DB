/**
 * Database Service
 * Handles all Supabase database operations for movie storage
 */

import supabase from '../utils/supabase.js';
import logger from '../utils/logger.js';

const TABLE_NAME = 'movies';

/**
 * Initialize database - creates table if not exists
 * Note: For Supabase, you should create the table via SQL Editor or migrations
 * This function just verifies the connection
 */
export async function initDb() {
    if (!supabase) {
        logger.error('Database client not initialized. Check your environment variables.');
        return false;
    }
    try {
        // Test connection by querying the movies table
        const { data, error } = await supabase
            .from(TABLE_NAME)
            .select('id')
            .limit(1);

        if (error) {
            // Table might not exist, try to create it
            if (error.code === '42P01' || error.message.includes('does not exist')) {
                logger.warn('Movies table does not exist. Please create it in Supabase Dashboard.');
                logger.info('Required SQL:\n' + getCreateTableSQL());
                return false;
            }
            throw error;
        }

        logger.info('Supabase database connected successfully');
        return true;
    } catch (err) {
        logger.error('Database initialization failed:', err.message);
        return false;
    }
}

/**
 * Get SQL for creating the movies table
 */
function getCreateTableSQL() {
    return `
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

CREATE INDEX IF NOT EXISTS idx_movies_title ON movies USING gin(to_tsvector('english', title));
CREATE INDEX IF NOT EXISTS idx_movies_year ON movies(year);
    `.trim();
}

/**
 * Insert a movie record (upserts based on URL)
 * @param {Object} movie - Movie object with title, url, year, quality
 */
export async function insertMovie(movie) {
    if (!supabase) return;
    try {
        const { error } = await supabase
            .from(TABLE_NAME)
            .upsert(
                {
                    title: movie.title,
                    url: movie.url,
                    year: movie.year || 'Unknown',
                    quality: movie.quality || 'DVD/HD',
                    poster_url: movie.posterUrl || movie.poster_url || null,
                    rating: movie.rating || null,
                    director: movie.director || null,
                    starring: movie.starring || null,
                    genres: movie.genres || null,
                    synopsis: movie.synopsis || null,
                    crawled_at: new Date().toISOString()
                },
                {
                    onConflict: 'url',
                    ignoreDuplicates: true
                }
            );

        if (error) {
            logger.error('Insert movie error:', error.message);
        }
    } catch (err) {
        logger.error('Failed to insert movie:', err.message);
    }
}

/**
 * Insert multiple movies at once
 * @param {Array} movies - Array of movie objects
 */
export async function insertMovies(movies) {
    if (!movies || movies.length === 0 || !supabase) return;

    try {
        const records = movies.map(movie => ({
            title: movie.title,
            url: movie.url,
            year: movie.year || 'Unknown',
            quality: movie.quality || 'DVD/HD',
            poster_url: movie.posterUrl || movie.poster_url || null,
            rating: movie.rating || null,
            director: movie.director || null,
            starring: movie.starring || null,
            genres: movie.genres || null,
            synopsis: movie.synopsis || null,
            crawled_at: new Date().toISOString()
        }));

        const { error } = await supabase
            .from(TABLE_NAME)
            .upsert(records, {
                onConflict: 'url',
                ignoreDuplicates: true
            });

        if (error) {
            logger.error('Batch insert error:', error.message);
        } else {
            logger.debug(`Inserted ${movies.length} movies`);
        }
    } catch (err) {
        logger.error('Failed to insert movies:', err.message);
    }
}

/**
 * Search movies by title
 * @param {string} query - Search query
 * @returns {Promise<Array>} Array of matching movies
 */
export async function searchMovies(query) {
    if (!supabase) return [];
    try {
        const { data, error } = await supabase
            .from(TABLE_NAME)
            .select('*')
            .ilike('title', `%${query}%`)
            .order('year', { ascending: false })
            .order('title', { ascending: true })
            .limit(100);

        if (error) {
            logger.error('Search error:', error.message);
            return [];
        }

        return data || [];
    } catch (err) {
        logger.error('Search failed:', err.message);
        return [];
    }
}

/**
 * Get all movies from database
 * @param {number} limit - Maximum records to return
 * @returns {Promise<Array>} Array of movies
 */
export async function getAllMovies(limit = 1000) {
    if (!supabase) return [];
    try {
        const { data, error } = await supabase
            .from(TABLE_NAME)
            .select('*')
            .order('crawled_at', { ascending: false })
            .limit(limit);

        if (error) {
            logger.error('Get all movies error:', error.message);
            return [];
        }

        return data || [];
    } catch (err) {
        logger.error('Failed to get movies:', err.message);
        return [];
    }
}

/**
 * Get database statistics
 * @returns {Promise<Object>} Database stats
 */
export async function getStats() {
    if (!supabase) return { totalMovies: 0 };
    try {
        const { count, error } = await supabase
            .from(TABLE_NAME)
            .select('*', { count: 'exact', head: true });

        if (error) {
            logger.error('Stats error:', error.message);
            return { totalMovies: 0 };
        }

        return { totalMovies: count || 0 };
    } catch (err) {
        logger.error('Failed to get stats:', err.message);
        return { totalMovies: 0 };
    }
}

/**
 * Delete all movies from database
 * Use with caution!
 */
export async function clearMovies() {
    if (!supabase) return false;
    try {
        const { error } = await supabase
            .from(TABLE_NAME)
            .delete()
            .neq('id', 0); // Delete all records

        if (error) {
            logger.error('Clear movies error:', error.message);
            return false;
        }

        logger.info('All movies cleared from database');
        return true;
    } catch (err) {
        logger.error('Failed to clear movies:', err.message);
        return false;
    }
}
