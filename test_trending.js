
import { getLatestUpdates } from './src/services/scraper.js';
import logger from './src/utils/logger.js';

async function testLatest() {
    console.log('--- Fetching Trending Now Movies ---');
    try {
        const latest = await getLatestUpdates();
        console.log(`Found ${latest.length} movies:`);
        latest.forEach((m, i) => {
            console.log(`${i + 1}. ${m.title}`);
            console.log(`   Year: ${m.year} | Quality: ${m.quality}`);
            console.log(`   URL: ${m.url}`);
            console.log(`   Poster: ${m.poster_url || 'N/A'}`);
            console.log('---------------------------');
        });
    } catch (err) {
        console.error('Error:', err.message);
    }
}

testLatest();
