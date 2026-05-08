# XCrawl API Server

Express server that wraps XCrawl proxy API as REST endpoints for RapidAPI.

## Quick Start

```bash
# Install
npm install

# Configure
copy .env.example .env
# Edit .env with your XCRAWL_API_KEY

# Run
npm start
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `XCRAWL_API_KEY` | Yes | XCrawl proxy API key |
| `RAPIDAPI_SECRET` | No | RapidAPI proxy secret (for production) |
| `API_TOKEN` | No | Fallback bearer token (if not using RapidAPI) |
| `PORT` | No | Server port (default 3000) |

## API Endpoints

### GET /search?q=query&limit=10
Search the web via XCrawl proxy.

### POST /scrape
```json
{ "url": "https://example.com", "render": false }
```

### POST /batch-scrape
```json
{ "urls": ["https://a.com", "https://b.com"], "render": false }
```

### POST /search-and-scrape
```json
{ "query": "news today", "limit": 10, "render": false }
```

## Deployment

### Railway
1. Push to GitHub
2. Connect Railway project
3. Set environment variables
4. Deploy

### Render
1. Create Web Service
2. Build command: `npm install`
3. Start command: `node index.js`
