# 🏗️ Backend Architecture Documentation

## Provider-Based Architecture

This backend uses a **provider-based architecture** that makes it:
- ✅ **Future-proof** - Add new sites in 30 minutes
- ✅ **Maintainable** - Each provider is isolated
- ✅ **Scalable** - No code changes needed when adding providers
- ✅ **Reliable** - If one site breaks, others still work

---

## 🎯 Core Principle

> **The backend does NOT know website names directly. It only knows "providers".**

Moviesda, isaiDub, TamilMV, any future site = **providers**.

---

## 📁 Folder Structure

```
backend/
└── src/
    ├── index.js                    # App entry point
    ├── config.js                   # Environment config
    │
    ├── api/                        # 🔌 API endpoints
    │   ├── search.api.js           # Search endpoints
    │   ├── movie.api.js            # Movie endpoints
    │   └── tv.api.js               # TV/Series endpoints
    │
    ├── core/                       # 🧠 HEART OF SYSTEM
    │   ├── providerManager.js      # Provider registry & control
    │   ├── contentPipeline.js      # scrape → match → enrich
    │   ├── contentTypes.js         # movie / tv type definitions
    │   └── providerTypes.js        # Provider interface contract
    │
    ├── providers/                  # 🔌 PROVIDER PLUGINS
    │   ├── moviesda/
    │   │   ├── index.js            # Main entry (interface)
    │   │   ├── scraper.js          # HTTP & parsing
    │   │   ├── parser.js           # Detail extraction
    │   │   └── config.js           # Site configuration
    │   │
    │   ├── isaidub/
    │   │   ├── index.js
    │   │   ├── scraper.js
    │   │   ├── parser.js
    │   │   └── config.js
    │   │
    │   └── _template/              # ⭐ COPY FOR NEW SITES
    │       ├── index.js
    │       ├── scraper.js
    │       ├── parser.js
    │       └── config.js
    │
    ├── matching/                   # 🎯 Title matching
    │   ├── normalizeTitle.js       # Clean scraped titles
    │   ├── confidenceScore.js      # TMDB match confidence
    │   └── detectContentType.js    # movie vs series detection
    │
    ├── services/
    │   ├── tmdb/                   # 🎬 TMDB integration
    │   │   ├── client.js           # API client
    │   │   ├── movie.js            # Movie operations
    │   │   └── tv.js               # TV operations
    │   │
    │   ├── database.js             # Supabase operations
    │   ├── tmdbMatcher.js          # Legacy matcher
    │   ├── scraper.js              # Legacy scraper
    │   └── unifiedSearch.js        # Legacy search
    │
    ├── routes/
    │   └── index.js                # Route registration
    │
    ├── utils/
    │   ├── logger.js
    │   ├── supabase.js
    │   └── search.js
    │
    └── jobs/                       # 🔄 Background jobs (future)
        ├── retryPendingTmdb.job.js
        ├── providerHealth.job.js
        └── cleanup.job.js
```

---

## 🔑 The Most Important File: `providerManager.js`

This is what makes the backend maintainable forever.

```javascript
// core/providerManager.js
import moviesda from '../providers/moviesda';
import isaidub from '../providers/isaidub';

const providers = [
  moviesda,
  isaidub
];

export function getProviders() {
  return providers;
}
```

### Adding a New Site (30 minutes)

```javascript
// Just add one line:
import tamilmv from '../providers/tamilmv';
providers.push(tamilmv);

// No other code changes needed! 🎉
```

---

## 🔌 Provider Interface (MANDATORY)

Every provider MUST implement this interface:

```javascript
export default {
  // Required properties
  id: 'moviesda',           // Unique identifier
  name: 'Moviesda',         // Display name
  supports: ['movie', 'tv'], // Content types
  languages: ['ta'],         // Language codes

  // Required methods
  getLatest,                // async () => ScrapedItem[]
  search,                   // async (query) => ScrapedItem[]
  scrapeDetails,            // async (url) => ContentDetails

  // Optional methods
  isHealthy,                // async () => boolean
  getQuickPoster            // async (url) => string|null
};
```

---

## 🔄 Unified Content Pipeline

```
Scraper Output
     ↓
processItem()
     ↓
normalizeTitle() → detectContentType()
     ↓
matchWithTMDB()
     ↓
calculateConfidence()
     ↓
Unified Content Object
     ↓
Save to Database
```

Every item goes through the same pipeline, regardless of source.

---

## 📡 API Endpoints

### Search
```
GET /api/search?q=movie_name
GET /api/search-unified?q=movie_name&language=tamil
```

### Movies
```
GET /api/movies/latest
GET /api/movies/isaidub
GET /api/movies/webseries
GET /api/movies/details?url=...
GET /api/movie/:tmdbId
```

### TV/Series
```
GET /api/tv/latest
GET /api/tv/:tmdbId
```

### Catalog
```
GET /api/catalog/tamil?page=1&limit=20
GET /api/catalog/trending
GET /api/catalog/stats
```

### Providers
```
GET /api/providers
GET /api/providers/health
POST /api/providers/:id/enable
POST /api/providers/:id/disable
```

---

## 🚀 How to Add a New Provider

### Step 1: Copy the template
```bash
cp -r src/providers/_template src/providers/newsite
```

### Step 2: Update config.js
```javascript
export default {
  id: 'newsite',
  name: 'New Site',
  baseUrl: 'https://newsite.com',
  supports: ['movie'],
  languages: ['ta'],
  // ...
};
```

### Step 3: Implement scraper.js
```javascript
export async function fetchPage(url) { /* ... */ }
export function parseMovieList($, year) { /* ... */ }
export async function scrapeAllPages(url, maxPages, year) { /* ... */ }
```

### Step 4: Implement parser.js
```javascript
export async function getQuickPoster(url) { /* ... */ }
export async function parseMovieDetails(url) { /* ... */ }
```

### Step 5: Update index.js
```javascript
export default {
  id: config.id,
  name: config.name,
  supports: config.supports,
  languages: config.languages,
  getLatest,
  search,
  scrapeDetails: parseMovieDetails,
  isHealthy
};
```

### Step 6: Register in providerManager.js
```javascript
import newsite from '../providers/newsite/index.js';

const providers = [
  moviesda,
  isaidub,
  newsite  // ← Add this line
];
```

**Done! ✅** Your new provider now works with the entire system.

---

## 🛡️ Error Handling & Health

### Automatic Health Management
- Providers track error counts
- After 5 errors, provider is marked as `degraded`
- Health check endpoint: `GET /api/providers/health`

### Manual Control
```bash
# Disable a provider
POST /api/providers/moviesda/disable

# Enable a provider
POST /api/providers/moviesda/enable
```

---

## 🎯 Golden Rules

1. **Never hardcode website names** in core logic
2. **One provider = one folder** with isolated code
3. **TMDB never scrapes** - it only enriches
4. **Providers only return raw data** - pipeline enriches
5. **Flutter talks to ONE API** - `/api/search-unified`

---

## 🧪 Real-World Scenario

**Tomorrow:**
- Moviesda domain blocked ❌
- isaiDub works ✅
- New site added ✅

**Your app:**
- Still works ✔️
- No redeploy needed ✔️
- Just toggle providers ✔️

---

## 📊 Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                       Flutter App                            │
│                    (Single API Client)                       │
└────────────────────────────┬────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────┐
│                      Unified API                             │
│                   /api/search-unified                        │
└────────────────────────────┬────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────┐
│                   Provider Manager                           │
│              (Heart of the System 🔑)                        │
│  • Register providers                                        │
│  • Route requests                                            │
│  • Track health                                              │
└─────────┬───────────────────────────────────────┬───────────┘
          │                                       │
          ▼                                       ▼
┌─────────────────────┐                 ┌─────────────────────┐
│   Moviesda Provider │                 │  isaiDub Provider   │
│  • config.js        │                 │  • config.js        │
│  • scraper.js       │                 │  • scraper.js       │
│  • parser.js        │                 │  • parser.js        │
│  • index.js         │                 │  • index.js         │
└─────────┬───────────┘                 └─────────┬───────────┘
          │                                       │
          └───────────────────┬───────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    Content Pipeline                          │
│              (Scrape → Match → Enrich)                       │
│  • Normalize titles                                          │
│  • Detect content type                                       │
│  • Match with TMDB                                           │
│  • Calculate confidence                                      │
└────────────────────────────┬────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────┐
│                    TMDB Enricher                             │
│  • Poster, backdrop                                          │
│  • Cast, crew                                                │
│  • Ratings, reviews                                          │
│  • Trailers                                                  │
└────────────────────────────┬────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────┐
│                   Unified Database                           │
│                     (Supabase)                               │
│  • unified_movies table                                      │
│  • Deduplicated by tmdb_id                                   │
│  • Cached metadata                                           │
└─────────────────────────────────────────────────────────────┘
```

---

## 🎉 Benefits of This Architecture

| Before | After |
|--------|-------|
| Hardcoded site names | Dynamic providers |
| Duplicate scraping code | Shared base components |
| One site breaks = app breaks | One site breaks = others work |
| Adding site = refactor | Adding site = 30 minutes |
| Tightly coupled | Loosely coupled |

---

## 📝 Migration Notes

The new architecture maintains backward compatibility:
- All existing endpoints still work
- Legacy scraper/matcher still available
- Gradual migration possible

To fully migrate:
1. Update Flutter app to use new unified endpoints
2. Remove legacy services once confirmed working
3. Add more providers as needed

---

*Last updated: 2026-01-21*
