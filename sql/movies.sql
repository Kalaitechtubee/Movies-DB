-- ============================================
-- 1. Movies Table - Raw Scraper Data
-- ============================================

-- Create Movies Table
CREATE TABLE IF NOT EXISTS movies (
    id SERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    url TEXT NOT NULL UNIQUE,
    year TEXT,
    quality TEXT,
    poster_url TEXT,
    rating TEXT,
    director TEXT,
    starring TEXT,
    genres TEXT,
    synopsis TEXT,
    crawled_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for better search performance
CREATE INDEX IF NOT EXISTS idx_movies_title ON movies USING gin(to_tsvector('english', title));
CREATE INDEX IF NOT EXISTS idx_movies_year ON movies(year);

-- ============================================
-- 2. Unified Movies Table - Production Catalog
-- ============================================
CREATE TABLE IF NOT EXISTS unified_movies (
    id SERIAL PRIMARY KEY,
    tmdb_id INTEGER UNIQUE,
    title TEXT NOT NULL,
    year TEXT,
    rating TEXT,
    poster_url TEXT,
    backdrop_url TEXT,
    overview TEXT,
    genres TEXT,
    runtime INTEGER,
    language_type TEXT, -- 'tamil', 'tamil_dubbed'
    movie_cast JSONB,
    director TEXT,
    trailer_key TEXT,
    watch_links JSONB,
    download_links JSONB,
    confidence_score INTEGER,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for production performance
CREATE INDEX IF NOT EXISTS idx_unified_tmdb_id ON unified_movies(tmdb_id);
CREATE INDEX IF NOT EXISTS idx_unified_lang ON unified_movies(language_type);
CREATE INDEX IF NOT EXISTS idx_unified_title ON unified_movies USING gin(to_tsvector('english', title));

-- ============================================
-- 3. Security Policies (RLS)
-- ============================================
ALTER TABLE movies ENABLE ROW LEVEL SECURITY;
ALTER TABLE unified_movies ENABLE ROW LEVEL SECURITY;

-- 🛡️ Read Policy: Public access (Anonymous)
CREATE POLICY "Public Read Access" ON movies FOR SELECT USING (true);
CREATE POLICY "Public Read Access" ON unified_movies FOR SELECT USING (true);

-- 🔑 Write Policy: Admin Only (via Service Role)
-- Service role bypasses RLS by default, so we don't strictly need insert policies 
-- if using the Service Role key from the backend. 
-- But for safety, we can allow authenticated inserts if needed.
