
import { getHomeCategories } from './src/services/scraper.js';
import logger from './src/utils/logger.js';

async function test() {
    console.log('Fetching categories...');
    const categories = await getHomeCategories();
    console.log('Total categories found:', categories.length);
    categories.forEach(c => {
        console.log(`- ${c.name} (${c.section}): ${c.url}`);
    });
}

test().catch(console.error);
