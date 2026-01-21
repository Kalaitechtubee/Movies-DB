/**
 * TMDB Movie Service
 * 
 * Higher-level movie-specific TMDB operations.
 */

import { search, getDetails, getPosterUrl, getBackdropUrl, getTrailerKey } from './client.js';
import { normalizeTitle } from '../../matching/normalizeTitle.js';
import { calculateConfidence, isReliableMatch } from '../../matching/confidenceScore.js';

/**
 * Match a movie with TMDB
 * @param {string} title - Movie title
 * @param {string} [year] - Optional year
 * @returns {Promise<Object|null>} Matched movie with enrichment
 */
export async function matchMovie(title, year = null) {
    const normalized = normalizeTitle(title);

    // 1. Try English with year
    let match = await search(normalized, 'movie', year, 'en-US');

    // 2. Try Tamil with year
    if (!match) {
        match = await search(normalized, 'movie', year, 'ta');
    }

    // 3. Try English without year (fallback)
    if (!match && year) {
        match = await search(normalized, 'movie', null, 'en-US');
    }

    // 4. Try Tamil without year (fallback)
    if (!match && year) {
        match = await search(normalized, 'movie', null, 'ta');
    }

    if (!match) return null;

    // Calculate confidence
    const confidence = calculateConfidence(normalized, match.title, match, year);

    if (!isReliableMatch(confidence)) {
        return null;
    }

    return {
        tmdb_id: match.id,
        title: match.title,
        original_title: match.original_title,
        year: match.release_date?.split('-')[0],
        overview: match.overview,
        poster_url: getPosterUrl(match.poster_path),
        backdrop_url: getBackdropUrl(match.backdrop_path),
        rating: match.vote_average,
        vote_count: match.vote_count,
        popularity: match.popularity,
        genre_ids: match.genre_ids,
        confidence_score: confidence
    };
}

/**
 * Get full movie details with all enrichments
 * @param {number} tmdbId - TMDB ID
 * @returns {Promise<Object|null>} Full movie details
 */
export async function getFullMovieDetails(tmdbId) {
    const details = await getDetails(tmdbId, 'movie');
    if (!details) return null;

    const trailerKey = await getTrailerKey(tmdbId, 'movie');

    return {
        tmdb_id: details.id,
        title: details.title,
        original_title: details.original_title,
        year: details.release_date?.split('-')[0],
        release_date: details.release_date,
        overview: details.overview,
        tagline: details.tagline,
        poster_url: getPosterUrl(details.poster_path),
        backdrop_url: getBackdropUrl(details.backdrop_path),
        rating: details.vote_average,
        vote_count: details.vote_count,
        popularity: details.popularity,
        runtime: details.runtime,
        genres: details.genres?.map(g => g.name) || [],
        production_companies: details.production_companies?.map(c => c.name) || [],
        cast: details.credits?.cast?.slice(0, 10).map(c => ({
            name: c.name,
            character: c.character,
            profile_path: c.profile_path ? `https://image.tmdb.org/t/p/w185${c.profile_path}` : null
        })) || [],
        crew: details.credits?.crew?.filter(c =>
            ['Director', 'Writer', 'Screenplay'].includes(c.job)
        ).map(c => ({
            name: c.name,
            job: c.job
        })) || [],
        director: details.credits?.crew?.find(c => c.job === 'Director')?.name,
        trailer_key: trailerKey,
        imdb_id: details.imdb_id,
        budget: details.budget,
        revenue: details.revenue,
        status: details.status
    };
}

export default {
    matchMovie,
    getFullMovieDetails
};
