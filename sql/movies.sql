-- ============================================
-- Movies Table - For Movie Search
-- Run this in Supabase SQL Editor
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
CREATE INDEX IF NOT EXISTS idx_movies_url ON movies(url);

-- Enable Row Level Security
ALTER TABLE movies ENABLE ROW LEVEL SECURITY;

-- Policy: Anyone can read movies (no login required)
CREATE POLICY "Anyone can read movies" ON movies
    FOR SELECT USING (true);

-- Policy: Allow inserts (for scraper)
CREATE POLICY "Allow movie inserts" ON movies
    FOR INSERT WITH CHECK (true);

-- Policy: Allow updates (for scraper)
CREATE POLICY "Allow movie updates" ON movies
    FOR UPDATE USING (true);
