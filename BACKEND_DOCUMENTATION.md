# Moviesda Backend Documentation

A powerful Node.js backend that serves as both a **REST API** and a **Model Context Protocol (MCP) Server**. It specializes in scraping, searching, and extracting movie download links from `moviesda15.com`, with data persistence in **Supabase**.

## 🚀 Overview

The Moviesda Backend is designed to provide a structured interface to the Moviesda website. It automates the process of finding movies, retrieving detailed information (like ratings, synopsis, and posters), and extracting direct download links across various resolutions (720p, 480p, etc.).

---

## 🛠 Tech Stack

- **Runtime**: Node.js (ES Modules)
- **Framework**: Express.js
- **Database**: Supabase (PostgreSQL)
- **Scraping**: Axios & Cheerio
- **MCP**: @modelcontextprotocol/sdk
- **Deployment**: Zoho Catalyst (Compatible)

---

## 📁 Project Structure

```text
moviesdb_backend/
├── src/
│   ├── index.js          # Entry point (Express Server)
│   ├── config.js         # Environment & App config
│   ├── routes/
│   │   └── index.js      # REST & SSE Endpoint definitions
│   ├── mcp/
│   │   └── server.js     # MCP Tool definitions & handlers
│   ├── services/
│   │   ├── database.js   # Supabase operations
│   │   └── scraper.js    # Web scraping logic
│   ├── utils/
│   │   ├── logger.js     # Pino/Custom logger
│   │   └── supabase.js   # Supabase client initialization
│   └── stdio.js          # MCP Stdio transport entry point
├── catalyst.json         # Zoho Catalyst configuration
├── package.json          # Dependencies and scripts
└── .env                  # Environment secrets
```

---

## ⚙️ Configuration

The application uses environment variables for configuration. Create a `.env` file in the root directory:

| Variable | Description | Default |
| :--- | :--- | :--- |
| `PORT` | The port the server listens on | `9000` |
| `SUPABASE_URL` | Your Supabase Project URL | *Required* |
| `SUPABASE_ANON_KEY` | Supabase Anonymous Key | *Required* |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase Service Role Key | *Optional* |
| `LOG_LEVEL` | Logging level (`debug`, `info`, `warn`, `error`) | `info` |

---

## 🔄 Flow of Operations

### 1. Movie Search Flow
When a user searches for a movie:
1.  **Database Check**: The system first queries the Supabase `movies` table for any titles matching the query.
2.  **Scraping Fallback**: If no results are found in the database, the system triggers the `searchMoviesDirect` service.
3.  **Real-time Scraping**:
    -   It checks the **A-Z category** corresponding to the first letter of the movie name.
    -   It checks the **Recent Years** (e.g., 2024, 2025) categories on the home page.
4.  **Deduplication**: Results from different categories are merged and deduplicated by URL.
5.  **Data Enrichment**: For the top results, it fetches the movie detail page to get posters and ratings.
6.  **Auto-Cache**: The newly found movies are upserted into Supabase so they appear in database searches next time.

### 2. Download Link Resolution
When a user requests download links for a specific movie URL:
1.  **Detail Page**: Fetches the movie's main page and parses metadata (Synopsis, Screenshots).
2.  **Resolution Selection**: Identifies links for different qualities (e.g., "Tamil 720p HD", "Tamil 480p").
3.  **Resolution Page**: Navigates into each resolution page to find the specific file links (e.g., `.mp4` files).
4.  **File Page**: Navigates to the file download page.
5.  **Final Link**: Locates the "Download Server 1" anchor tag and extracts the final direct link.

---

## ✨ Features

### 1. Multi-layered Search
- **Database Search**: Fast retrieval of previously crawled movies.
- **Direct Search**: Real-time scraping of the website if no database results are found.
- **Auto-caching**: Direct search results are automatically saved to Supabase for future use.

### 2. High-Fidelity Scraping
- **Pagination**: Iterates through multiple pages of categories.
- **Detail Extraction**: Retrieves posters, directors, starring actors, genres, and ratings.
- **Link Resolver**: Navigates through resolution pages (HD, DVD, etc.) to find the final "Download Server 1" links.

### 3. MCP Integration
- Exposes tools to AI Agents (like Gemini) to search for movies and get download links directly within a chat interface.

---

## 📡 REST API Documentation

### Search Movies
`GET /api/search?q={query}`
- **Description**: Searches for movies in the database, falling back to direct scraping.
- **Response**:
  ```json
  {
    "count": 1,
    "source": "database",
    "results": [
      {
        "title": "Amaran (2024)",
        "url": "https://moviesda15.com/...",
        "year": "2024",
        "quality": "Original HD"
      }
    ]
  }
  ```

### Get Stats
`GET /api/stats`
- **Description**: Returns the total number of movies stored in the database.

### Refresh Database
`POST /api/refresh`
- **Description**: Triggers a background job to scrape the home page and update the database with recent releases.

### Health Check
`GET /health`
- **Description**: Returns server status, active sessions, and database connectivity.

---

## 🤖 MCP Tools Documentation

For AI agents connecting via SSE or Stdio, the following tools are available:

### `search_movies`
- **Arguments**: `{"query": "movie name"}`
- **Purpose**: Returns a list of matching movies with their source links.

### `get_download_links`
- **Arguments**: `{"url": "movie_url"}`
- **Purpose**: Deep-scrapes the provided URL to find all available download links, resolutions, and synopsis.

### `refresh_database`
- **Arguments**: `{}`
- **Purpose**: Starts the background update process.

---

## 🛠 Setup & Installation

1. **Clone the repository** and navigate to the backend folder.
2. **Install dependencies**:
   ```bash
   npm install
   ```
3. **Database Setup**:
   - Create a `movies` table in Supabase:
   ```sql
   CREATE TABLE movies (
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
   ```
4. **Run the server**:
   - Development (with watch): `npm run dev`
   - Production: `npm start`
   - MCP Stdio Mode: `npm run start:stdio`

---

## 📦 Deployment (Zoho Catalyst)

The project is pre-configured for Zoho Catalyst.
1. Install Catalyst CLI: `npm i -g zcatalyst-cli`
2. Login: `catalyst login`
3. Deploy: `catalyst deploy`

The server automatically detects the Catalyst environment using the `ZOHO_CATALYST_LISTEN_PORT` environment variable.
