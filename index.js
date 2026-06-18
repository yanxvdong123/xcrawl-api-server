require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const app = express();
const PORT = process.env.PORT || 3000;
const XCRAWL_API_KEY = process.env.XCRAWL_API_KEY || process.env.API_TOKEN || 'xc-pj5M4XpMkc27eJKiDrD49bZJ3Tlcok8De3pk0sV95DyGXwak';
const RAPIDAPI_SECRET = process.env.RAPIDAPI_SECRET;

// Security
app.use(helmet());
app.use(cors());
app.use(morgan('short'));
app.use(express.json({ limit: '10mb' }));

// Rate limiting (simple in-memory)
const rateLimitStore = new Map();
const RATE_LIMIT = {
  windowMs: 60 * 1000, // 1 minute
  max: 30,             // max 30 requests per minute per IP
};

function rateLimit(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress;
  const now = Date.now();
  if (!rateLimitStore.has(ip)) {
    rateLimitStore.set(ip, []);
  }
  const timestamps = rateLimitStore.get(ip).filter(t => now - t < RATE_LIMIT.windowMs);
  if (timestamps.length >= RATE_LIMIT.max) {
    return res.status(429).json({ error: 'Too many requests. Please slow down.' });
  }
  timestamps.push(now);
  rateLimitStore.set(ip, timestamps);
  next();
}

app.use(rateLimit);

// Auth middleware for RapidAPI
function auth(req, res, next) {
  // RapidAPI sends x-rapidapi-proxy-secret
  const rapidapiSecret = req.headers['x-rapidapi-proxy-secret'];
  if (RAPIDAPI_SECRET && rapidapiSecret !== RAPIDAPI_SECRET) {
    return res.status(403).json({ error: 'Unauthorized - invalid API secret' });
  }
  // Also accept bearer token style
  const bearer = req.headers['authorization'];
  if (!RAPIDAPI_SECRET && bearer && bearer.startsWith('Bearer ')) {
    const token = bearer.slice(7);
    if (token !== process.env.API_TOKEN) {
      return res.status(403).json({ error: 'Unauthorized - invalid token' });
    }
  }
  next();
}

app.use(auth);

// --- XCrawl API helper ---
async function callXcrawl(endpoint, body) {
  const url = `https://run.xcrawl.com/v1${endpoint}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${XCRAWL_API_KEY}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60000),
  });
  
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`XCrawl error ${response.status}: ${text}`);
  }
  
  return response.json();
}

// Health check
app.get('/', (req, res) => {
  res.json({
    service: 'XCrawl API Server',
    version: '1.0.0',
    endpoints: [
      'POST /search     { query, location, language, limit }',
      'POST /scrape     { url, mode, proxy, output }',
      'POST /batch-scrape { urls }',
      'POST /search-and-scrape { query, limit }',
    ],
    docs: 'https://rapidapi.com/.../xcrawl-api',
  });
});

/**
 * POST /search
 * Web search via XCrawl
 * Body: { query, location, language, limit }
 */
app.post('/search', async (req, res) => {
  try {
    const { query, location, language, limit = 10 } = req.body;
    if (!query) return res.status(400).json({ error: 'Missing "query" in body' });
    
    const result = await callXcrawl('/search', {
      query,
      location: location || 'US',
      language: language || 'en',
      limit: Math.min(parseInt(limit) || 10, 50),
    });
    
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /scrape
 * Body: { url: string, render: boolean (optional, default false) }
 */
app.post('/scrape', async (req, res) => {
  try {
    const { url, mode, proxy, output } = req.body;
    if (!url) return res.status(400).json({ error: 'Missing "url" in body' });
    
    const body = { url };
    if (mode) body.mode = mode;
    if (proxy) body.proxy = proxy;
    if (output) body.output = output;
    
    const result = await callXcrawl('/scrape', body);
    
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /batch-scrape
 * Body: { urls: string[], render: boolean }
 */
app.post('/batch-scrape', async (req, res) => {
  try {
    const { urls } = req.body;
    if (!urls || !Array.isArray(urls) || urls.length === 0) {
      return res.status(400).json({ error: 'Missing "urls" array in body' });
    }
    if (urls.length > 50) {
      return res.status(400).json({ error: 'Max 50 URLs per batch' });
    }
    
    const results = await Promise.all(
      urls.map(url => callXcrawl('/scrape', { url }))
    );
    
    res.json({ results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /screenshot
 * Take a page screenshot
 * Body: { url }
 */
app.post('/screenshot', async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'Missing "url" in body' });
    
    const result = await callXcrawl('/scrape', { url, output: { screenshot: true } });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /search-and-scrape
 * Body: { query: string, limit: number, render: boolean }
 * Combines search + scrape in one call
 */
app.post('/search-and-scrape', async (req, res) => {
  try {
    const { query, limit = 10, location, language } = req.body;
    if (!query) return res.status(400).json({ error: 'Missing "query" in body' });
    
    const searchResult = await callXcrawl('/search', {
      query,
      location: location || 'US',
      language: language || 'en',
      limit: Math.min(parseInt(limit) || 10, 50),
    });
    
    // Also scrape each result URL
    const urls = (searchResult?.data?.data || []).map(r => r.url).filter(Boolean);
    const scrapes = urls.length > 0 ? await Promise.allSettled(
      urls.map(url => callXcrawl('/scrape', { url }))
    ) : [];
    
    res.json({
      search: searchResult,
      scrapes: scrapes.map((r, i) => ({
        url: urls[i],
        status: r.status,
        data: r.status === 'fulfilled' ? r.value : { error: r.reason?.message },
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Error handling
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`XCrawl API server running on port ${PORT}`);
  console.log(`Health: http://localhost:${PORT}/`);
});
