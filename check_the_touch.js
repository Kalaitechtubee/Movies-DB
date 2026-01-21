
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function checkTheTouch() {
    const { data, error } = await supabase
        .from('unified_movies')
        .select('*')
        .ilike('title', '%The Touch%');

    if (error) {
        console.error('Error:', error);
    } else {
        console.log('Matches for The Touch:', data);
    }
}

checkTheTouch();
