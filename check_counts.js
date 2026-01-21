
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function checkCount() {
    const { count: unifiedCount } = await supabase.from('unified_movies').select('*', { count: 'exact', head: true });
    const { count: rawCount } = await supabase.from('movies').select('*', { count: 'exact', head: true });

    console.log('Total movies in unified_movies:', unifiedCount);
    console.log('Total movies in raw movies table:', rawCount);
}

checkCount();
