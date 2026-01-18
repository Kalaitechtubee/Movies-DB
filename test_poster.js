import { getMovieDownloadLinks } from './src/services/scraper.js';

async function test() {
    const url = 'https://moviesda15.com/sathriyan-2017-movie/';
    console.log(`Getting links for ${url}...`);
    const details = await getMovieDownloadLinks(url);
    console.log('Details:', JSON.stringify(details, null, 2));
}

test();
