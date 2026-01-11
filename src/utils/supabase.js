/**
 * Supabase Client
 * Initializes and exports the Supabase client instance
 */

import { createClient } from '@supabase/supabase-js';
import logger from './logger.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

let supabase = null;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    logger.warn('⚠️ Missing Supabase configuration. DB operations will be disabled.');

    // Create a robust dummy object to prevent crashes
    const dummyPromise = Promise.resolve({ data: [], error: null, count: 0 });
    const dummyChain = () => ({
        select: dummyChain,
        ilike: dummyChain,
        order: dummyChain,
        limit: () => dummyPromise,
        upsert: () => dummyPromise,
        delete: dummyChain,
        neq: () => dummyPromise,
        then: (cb) => dummyPromise.then(cb),
        catch: (cb) => dummyPromise.catch(cb)
    });

    supabase = {
        from: dummyChain
    };
} else {
    try {
        supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
            auth: {
                autoRefreshToken: false,
                persistSession: false
            }
        });
        logger.info('✅ Supabase client initialized');
    } catch (error) {
        logger.error('❌ Failed to initialize Supabase client:', error.message);
    }
}

export default supabase;
