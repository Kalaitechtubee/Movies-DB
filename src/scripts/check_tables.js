import supabase from '../utils/supabase.js';

async function check() {
    const { data, error } = await supabase.from('movies').select('id').limit(1);
    console.log('Movies table exists:', !!data);

    const { data: unifiedData, error: unifiedError } = await supabase.from('unified_movies').select('id').limit(1);
    console.log('Unified table exists:', !!unifiedData);
    if (unifiedError) console.error('Unified Error:', unifiedError.message);
}

check();
