/**
 * Database Migration: Add link_state columns
 * 
 * Run this in your Supabase SQL Editor to upgrade the schema.
 * 
 * ⚠️ IMPORTANT: Run this ONCE before deploying the new architecture.
 */

-- =============================================================================
-- STEP 1: Add new columns to unified_movies
-- =============================================================================

-- Add link_state column (the key to non-blocking architecture)
ALTER TABLE unified_movies 
ADD COLUMN IF NOT EXISTS link_state TEXT 
CHECK (link_state IN ('available', 'checking', 'not_available', 'blocked')) 
DEFAULT 'checking';

-- Add last_checked timestamp (for cache invalidation)
ALTER TABLE unified_movies 
ADD COLUMN IF NOT EXISTS last_checked TIMESTAMPTZ;

-- Add source_provider (internal tracking, NOT exposed to UI)
ALTER TABLE unified_movies 
ADD COLUMN IF NOT EXISTS source_provider TEXT;

-- Add content_type if not exists (movie/tv)
ALTER TABLE unified_movies 
ADD COLUMN IF NOT EXISTS content_type TEXT DEFAULT 'movie';

-- =============================================================================
-- STEP 2: Update existing records
-- =============================================================================

-- Set link_state = 'available' for movies that already have download links
UPDATE unified_movies 
SET link_state = 'available', 
    last_checked = NOW() 
WHERE (download_links IS NOT NULL AND jsonb_array_length(download_links) > 0)
   OR (watch_links IS NOT NULL AND jsonb_array_length(watch_links) > 0);

-- Set link_state = 'checking' for movies without links (will be processed by queue)
UPDATE unified_movies 
SET link_state = 'checking' 
WHERE link_state IS NULL;

-- =============================================================================
-- STEP 3: Create indexes for performance
-- =============================================================================

-- Index on link_state (for filtering available movies)
CREATE INDEX IF NOT EXISTS idx_unified_link_state 
ON unified_movies(link_state);

-- Index on content_type (movie vs tv)
CREATE INDEX IF NOT EXISTS idx_unified_content_type 
ON unified_movies(content_type);

-- Composite index for home page queries
CREATE INDEX IF NOT EXISTS idx_unified_home_query 
ON unified_movies(link_state, language_type, updated_at DESC);

-- =============================================================================
-- STEP 4: Verify migration
-- =============================================================================

-- Check the new schema
SELECT column_name, data_type, column_default 
FROM information_schema.columns 
WHERE table_name = 'unified_movies' 
ORDER BY ordinal_position;

-- Check link_state distribution
SELECT link_state, COUNT(*) as count 
FROM unified_movies 
GROUP BY link_state;
