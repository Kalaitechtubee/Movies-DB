
import { getHomeCategories, getMoviesByCategory } from './src/services/scraper.js';
import logger from './src/utils/logger.js';

async function test() {
    logger.info('Testing Home Categories Extraction...');
    const categories = await getHomeCategories();
    console.log('Categories found:', categories.length);
    console.log('Sample category:', categories[0]);

    if (categories.length > 0) {
        logger.info(`Testing Movie Extraction for ${categories[0].name}...`);
        const movies = await getMoviesByCategory(categories[0].url, '2026', true); // Enrich = true
        console.log('Movies found:', movies.length);
        if (movies.length > 0) {
            console.log('Sample movie title:', movies[0].title);
            console.log('Sample movie resolutions:', movies[0].resolutions?.length || 0);
            if (movies[0].resolutions?.length > 0) {
                console.log('Sample direct URL:', movies[0].resolutions[0].directUrl);
            }
        }
    }
}

test().catch(console.error);
