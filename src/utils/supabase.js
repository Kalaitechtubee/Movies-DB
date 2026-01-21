import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from '../config.js';
import logger from './logger.js';

let supabase;

try {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
        logger.error('Missing Supabase configuration (Service Role Key). Database operations will fail.');
        supabase = null;
    } else {
        supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    }
} catch (error) {
    logger.error('Failed to initialize Supabase client:', error.message);
    supabase = null;
}

export default supabase;
