
import axios from 'axios';
import fs from 'fs';

async function fetchAndSave() {
    try {
        const response = await axios.get('https://moviesda15.com/tamil-hd-movies-download/');
        fs.writeFileSync('debug_page.html', response.data);
        console.log('Saved to debug_page.html');
    } catch (err) {
        console.error(err.message);
    }
}
fetchAndSave();
