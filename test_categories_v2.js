import { getCategories } from './src/services/scraper.js';
import logger from './src/utils/logger.js';

async function test() {
    try {
        const categories = await getCategories();
        console.log(`Total categories found: ${categories.length}`);
        categories.forEach(cat => {
            console.log(`- ${cat.name} (${cat.section}): ${cat.url}`);
        });
    } catch (err) {
        console.error(err);
    }
}

test();
