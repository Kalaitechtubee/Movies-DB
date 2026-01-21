/**
 * TMDB TV Service
 * 
 * Higher-level TV/series-specific TMDB operations.
 */

import { search, getDetails, getPosterUrl, getBackdropUrl, getTrailerKey } from './client.js';
import { normalizeTitle } from '../../matching/normalizeTitle.js';
import { calculateConfidence, isReliableMatch } from '../../matching/confidenceScore.js';

/**
 * Match a TV show with TMDB
 * @param {string} title - Show title
 * @param {string} [year] - Optional year
 * @returns {Promise<Object|null>} Matched show with enrichment
 */
export async function matchTVShow(title, year = null) {
    const normalized = normalizeTitle(title);

    // 1. Try English with year
    let match = await search(normalized, 'tv', year, 'en-US');

    // 2. Try Tamil with year
    if (!match) {
        match = await search(normalized, 'tv', year, 'ta');
    }

    // 3. Try English without year (fallback)
    if (!match && year) {
        match = await search(normalized, 'tv', null, 'en-US');
    }

    // 4. Try Tamil without year (fallback)
    if (!match && year) {
        match = await search(normalized, 'tv', null, 'ta');
    }

    if (!match) return null;

    // Calculate confidence
    const confidence = calculateConfidence(normalized, match.name, match, year);

    if (!isReliableMatch(confidence)) {
        return null;
    }

    return {
        tmdb_id: match.id,
        title: match.name,
        original_title: match.original_name,
        year: match.first_air_date?.split('-')[0],
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
 * Get full TV show details with all enrichments
 * @param {number} tmdbId - TMDB ID
 * @returns {Promise<Object|null>} Full show details
 */
export async function getFullTVDetails(tmdbId) {
    const details = await getDetails(tmdbId, 'tv');
    if (!details) return null;

    const trailerKey = await getTrailerKey(tmdbId, 'tv');

    return {
        tmdb_id: details.id,
        title: details.name,
        original_title: details.original_name,
        year: details.first_air_date?.split('-')[0],
        first_air_date: details.first_air_date,
        last_air_date: details.last_air_date,
        overview: details.overview,
        tagline: details.tagline,
        poster_url: getPosterUrl(details.poster_path),
        backdrop_url: getBackdropUrl(details.backdrop_path),
        rating: details.vote_average,
        vote_count: details.vote_count,
        popularity: details.popularity,
        episode_run_time: details.episode_run_time?.[0],
        genres: details.genres?.map(g => g.name) || [],
        networks: details.networks?.map(n => n.name) || [],
        number_of_seasons: details.number_of_seasons,
        number_of_episodes: details.number_of_episodes,
        seasons: details.seasons?.map(s => ({
            season_number: s.season_number,
            name: s.name,
            episode_count: s.episode_count,
            air_date: s.air_date,
            poster_path: s.poster_path ? getPosterUrl(s.poster_path, 'w342') : null
        })) || [],
        cast: details.credits?.cast?.slice(0, 10).map(c => ({
            name: c.name,
            character: c.character,
            profile_path: c.profile_path ? `https://image.tmdb.org/t/p/w185${c.profile_path}` : null
        })) || [],
        created_by: details.created_by?.map(c => c.name) || [],
        trailer_key: trailerKey,
        status: details.status,
        type: details.type
    };
}

export default {
    matchTVShow,
    getFullTVDetails
};
