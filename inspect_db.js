import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY);

async function inspectTable() {
    const { data, error } = await supabase.from('unified_movies').select('*').limit(1);

    if (error) {
        console.error('Error fetching data:', error);
        return;
    }

    if (data && data.length > 0) {
        console.log('Columns found in unified_movies:', Object.keys(data[0]));
    } else {
        console.log('Table is empty or could not be accessed.');
    }
}

inspectTable();
