
import tmdb from './src/services/tmdb/client.js';
import dotenv from 'dotenv';
dotenv.config();

async function test() {
    console.log('--- Testing TMDB Search ---');
    const query = 'a knight of the seven kingdoms';
    const type = 'tv';
    const year = '2026';

    try {
        const match = await tmdb.search(query, type, year);
        if (match) {
            console.log(`Found match: ${match.name || match.title} (${match.id})`);
            console.log(`Release: ${match.first_air_date || match.release_date}`);
        } else {
            console.log('No match found on TMDB');
        }
    } catch (error) {
        console.error('TMDB Search failed:', error);
    }
}

test();
