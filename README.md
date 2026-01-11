# Moviesda Search Backend

This is the backend server for the Moviesda Search application. It provides a REST API and an MCP (Model Context Protocol) server for searching movies and retrieving download links.

## 📄 Documentation

For full, detailed documentation of the architecture, API endpoints, MCP tools, and setup instructions, please refer to:

👉 **[BACKEND_DOCUMENTATION.md](./BACKEND_DOCUMENTATION.md)**

## 🚀 Quick Start

1. Install dependencies:
   ```bash
   npm install
   ```
2. Configure environment:
   ```bash
   cp .env.example .env
   # Fill in your SUPABASE_URL and SUPABASE_ANON_KEY
   ```
3. Start the server:
   ```bash
   npm run dev
   ```

## 🛠 Features

- **REST API**: Search and stats endpoints.
- **MCP Server**: Integration with AI agents via SSE or Stdio.
- **Web Scraper**: Automated link extraction from Moviesda.
- **Supabase Integration**: Efficient caching and movie storage.
