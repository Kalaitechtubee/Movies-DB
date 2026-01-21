
import isaidub from './src/providers/isaidub/index.js';
import logger from './src/utils/logger.js';

async function test() {
    console.log('--- Testing isaiDub Search ---');
    const query = 'A Knight of the Seven Kingdoms';
    try {
        const results = await isaidub.search(query);
        console.log(`Found ${results.length} results for "${query}":`);
        results.forEach(r => {
            console.log(`- ${r.title} (${r.url})`);
        });
    } catch (error) {
        console.error('Search failed:', error);
    }
}

test();
