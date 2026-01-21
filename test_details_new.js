
import { parseMovieDetails } from './src/providers/isaidub/parser.js';

async function test() {
    const url = 'https://isaidub.love/movie/a-knight-of-the-seven-kingdoms-2026-tamil-dubbed-web-series/';
    console.log(`Scraping details for: ${url}`);

    try {
        const details = await parseMovieDetails(url);
        if (details) {
            console.log('--- Details Found ---');
            console.log(`Title: ${details.title}`);
            console.log(`Type: ${details.type}`);
            console.log(`Resolutions: ${details.resolutions?.length || 0}`);
            if (details.resolutions?.length > 0) {
                console.log('First Resolution:', details.resolutions[0]);
            }
        } else {
            console.log('No details found (returned null)');
        }
    } catch (error) {
        console.error('Details scrape failed:', error);
    }
}

test();
