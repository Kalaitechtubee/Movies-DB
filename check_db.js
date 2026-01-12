import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_ANON_KEY;

console.log('--- Environment Check ---');
console.log(`URL exists: ${!!url}`);
if (url) console.log(`URL Value: ${url}`);
console.log(`Key exists: ${!!key}`);
if (key) console.log(`Key Start: ${key.substring(0, 10)}... (Length: ${key.length})`);

if (!url || !key) {
    console.error('MISSING ENV VARS. Aborting.');
    process.exit(1);
}

const supabase = createClient(url, key);

async function testDb() {
    console.log('\n--- Database Connection Test ---');
    try {
        const { data, error } = await supabase.from('movies').select('*').limit(1);
        if (error) {
            console.error('Select Error:', error);
        } else {
            console.log('Select Success. Rows found:', data.length);
        }

        console.log('\n--- Insert Test ---');
        const testMovie = {
            title: 'Test Movie ' + Date.now(),
            url: 'http://test.com/' + Date.now(),
            year: '2024'
        };

        const { error: insertError } = await supabase.from('movies').insert(testMovie);
        if (insertError) {
            console.error('Insert Error:', insertError);
        } else {
            console.log('Insert Success!');
        }

    } catch (e) {
        console.error('Exception:', e);
    }
}

testDb();
