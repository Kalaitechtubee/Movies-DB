/**
 * TMDB Service
 * Handles metadata fetching from The Movie Database API
 */

import axios from 'axios';
import { TMDB_API_KEY } from '../config.js';
import logger from '../utils/logger.js';

const BASE_URL = 'https://api.themoviedb.org/3';

/**
 * Deterministic Movie Selection logic (Ranked)
 * @param {Array} results - TMDB search results
 * @param {string} preferredYear - Optional year to match
 * @returns {Object|null} The single canonical choice
 */
function selectPrimaryTMDBMovie(results, preferredYear) {
    if (!results || results.length === 0) return null;

    // 1. Filter for Tamil or preferred language first if possible
    // (TMDB search already uses ta-IN, but we verify original_language)
    const tamil = results.filter(m => m.original_language === 'ta');

    // 2. Filter by Year match
    let candidates = tamil.length ? tamil : results;
    if (preferredYear && preferredYear !== 'Unknown') {
        const byYear = candidates.filter(m => m.release_date?.startsWith(preferredYear));
        if (byYear.length > 0) candidates = byYear;
    }

    // 3. Sort by popularity (vote_count / popularity) to get the most "canonical" one
    candidates.sort((a, b) => (b.vote_count || 0) - (a.vote_count || 0) || (b.popularity || 0) - (a.popularity || 0));

    return candidates[0];
}

/**
 * Search for a movie on TMDB
 * @param {string} query - Movie title to search for
 * @param {string} year - Optional release year
 * @returns {Promise<Object|null>} Movie metadata or null if not found
 */
export async function searchTMDBMovie(query, year = '') {
    if (!TMDB_API_KEY) {
        logger.warn('TMDB_API_KEY is not defined in environment');
        return null;
    }

    // Clean query (remove technical noise)
    const cleanQuery = query
        .replace(/\d{4}/g, '')
        .replace(/Tamil\s*Movie/gi, '')
        .replace(/Original/gi, '')
        .replace(/Single\s*Part/gi, '')
        .replace(/\[.*\]/g, '')
        .replace(/Moviesda/gi, '')
        .replace(/isaidub/gi, '')
        .replace(/\.com/gi, '')
        .replace(/\.app/gi, '')
        .replace(/-/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    try {
        const search = async (lang, useYear = true) => {
            let url = `${BASE_URL}/search/movie?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(cleanQuery)}&language=${lang}&include_adult=false`;
            if (useYear && year && year !== 'Unknown' && /^\d{4}$/.test(year)) {
                url += `&year=${year}`;
            }
            logger.debug(`TMDB Search URL (${lang}${useYear ? ' w/ year' : ''}): ${url}`);
            return axios.get(url);
        };

        let response = await search('ta-IN');
        let results = response.data.results;

        // Try Tamil without year if year was provided and no results
        if ((!results || results.length === 0) && year && year !== 'Unknown') {
            response = await search('ta-IN', false);
            results = response.data.results;
        }

        // If no results in Tamil, try English
        if (!results || results.length === 0) {
            response = await search('en-US');
            results = response.data.results;

            // Try English without year if still no results
            if ((!results || results.length === 0) && year && year !== 'Unknown') {
                response = await search('en-US', false);
                results = response.data.results;
            }
        }

        const movie = selectPrimaryTMDBMovie(results, year);

        if (movie) {
            return {
                tmdb_id: movie.id,
                title: movie.title,
                original_title: movie.original_title,
                year: movie.release_date ? movie.release_date.split('-')[0] : 'Unknown',
                rating: movie.vote_average ? movie.vote_average.toFixed(1) : '0',
                poster: movie.poster_path ? `https://image.tmdb.org/t/p/w500${movie.poster_path}` : null,
                backdrop: movie.backdrop_path ? `https://image.tmdb.org/t/p/original${movie.backdrop_path}` : null,
                overview: movie.overview,
                genres: movie.genre_ids,
                popularity: movie.popularity,
                vote_count: movie.vote_count
            };
        }

        return null;
    } catch (error) {
        logger.error(`TMDB search error for "${query}":`, error.message);
        return null;
    }
}

/**
 * Get detailed movie info from TMDB by ID
 * @param {number} movieId - TMDB Movie ID
 * @returns {Promise<Object|null>} Detailed metadata
 */
export async function getTMDBMovieDetails(movieId) {
    if (!TMDB_API_KEY) return null;

    try {
        const url = `${BASE_URL}/movie/${movieId}?api_key=${TMDB_API_KEY}&language=ta-IN&append_to_response=credits,videos`;
        const response = await axios.get(url);
        const movie = response.data;

        return {
            tmdb_id: movie.id,
            title: movie.title,
            year: movie.release_date ? movie.release_date.split('-')[0] : 'Unknown',
            rating: movie.vote_average ? movie.vote_average.toFixed(1) : '0',
            runtime: movie.runtime,
            genres: movie.genres ? movie.genres.map(g => g.name).join(', ') : '',
            poster: movie.poster_path ? `https://image.tmdb.org/t/p/w500${movie.poster_path}` : null,
            backdrop: movie.backdrop_path ? `https://image.tmdb.org/t/p/original${movie.backdrop_path}` : null,
            overview: movie.overview,
            cast: movie.credits?.cast ? movie.credits.cast.slice(0, 5).map(c => c.name).join(', ') : '',
            director: movie.credits?.crew ? movie.credits.crew.find(c => c.job === 'Director')?.name : '',
            trailer: movie.videos?.results ? movie.videos.results.find(v => v.type === 'Trailer' && v.site === 'YouTube')?.key : null
        };
    } catch (error) {
        logger.error(`TMDB details error for ID ${movieId}:`, error.message);
        return null;
    }
}
