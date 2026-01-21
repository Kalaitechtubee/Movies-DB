
async function testRecs() {
    const id = 32091;
    const response = await fetch(`http://localhost:9000/api/movies/recommendations?id=${id}`);
    const data = await response.json();
    console.log('Recommendations count:', data.length);
    console.log('Recommendations:', data);
}

testRecs();
