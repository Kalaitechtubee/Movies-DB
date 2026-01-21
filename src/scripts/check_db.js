import supabase from '../utils/supabase.js';

async function check() {
    const { data, error } = await supabase.from('unified_movies').select('tmdb_id, title');
    console.log('Result:', data);
    if (error) console.error('Error:', error);
}

check();
