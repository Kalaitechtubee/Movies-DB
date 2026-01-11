import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../config.js';
import logger from './logger.js';

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    logger.error('Missing Supabase configuration. Please check your .env file.');
}

const supabase = createClient(
    SUPABASE_URL || '',
    SUPABASE_ANON_KEY || ''
);

export default supabase;
