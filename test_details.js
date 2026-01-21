
async function testDetail() {
    const url = 'https://isaidub.love/movie/the-touch-2002-tamil-dubbed-movie/';
    const response = await fetch(`http://localhost:9000/api/movies/details?url=${encodeURIComponent(url)}`);
    const data = await response.json();
    console.log('Title:', data.title);
    console.log('TMDB ID:', data.tmdb_id);
    console.log('Poster:', data.poster);
}

testDetail();
