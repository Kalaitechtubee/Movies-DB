import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../config.js';
import logger from './logger.js';

let supabase;

try {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
        logger.error('Missing Supabase configuration. Database operations will fail.');
        // Don't initialize if keys are missing to prevent crash
        supabase = null;
    } else {
        supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    }
} catch (error) {
    logger.error('Failed to initialize Supabase client:', error.message);
    supabase = null;
}

export default supabase;
