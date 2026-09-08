const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

// MIME types mapping
const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.eot': 'application/vnd.ms-fontobject',
  '.webp': 'image/webp',
  '.mp3': 'audio/mpeg',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',
};

/**
 * Read a file asynchronously
 */
function readFile(filePath) {
  return new Promise((resolve, reject) => {
    fs.readFile(filePath, (err, data) => {
      if (err) reject(err);
      else resolve(data);
    });
  });
}

/**
 * Get MIME type from file extension
 */
function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_TYPES[ext] || 'application/octet-stream';
}

/**
 * Send JSON response
 */
function sendJSON(res, statusCode, data) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

/**
 * Serve static file
 */
async function serveStaticFile(res, filePath) {
  try {
    const absolutePath = path.resolve(filePath);

    // Security: ensure the resolved path is within PUBLIC_DIR
    if (!absolutePath.startsWith(PUBLIC_DIR)) {
      sendJSON(res, 403, { error: 'forbidden' });
      return;
    }

    const stat = fs.statSync(absolutePath);
    if (!stat.isFile()) {
      sendJSON(res, 404, { error: 'not_found' });
      return;
    }

    const data = fs.readFileSync(absolutePath);
    const mimeType = getMimeType(absolutePath);

    res.writeHead(200, {
      'Content-Type': mimeType,
      'Content-Length': data.length,
    });
    res.end(data);
  } catch (err) {
    sendJSON(res, 500, { error: 'internal_error' });
  }
}

/**
 * Create the HTTP server
 */
const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;
  const method = req.method;

  try {
    // --- Route: GET / ---
    if (method === 'GET' && pathname === '/') {
      serveStaticFile(res, path.join(PUBLIC_DIR, 'index.html'));
      return;
    }

    // --- Route: Static files (GET /style.css, GET /editor.js, etc.) ---
    if (method === 'GET' && /\.(css|js|html|png|jpg|gif|svg|ico|webp|woff|woff2|ttf|eot|map)$/i.test(pathname)) {
      serveStaticFile(res, path.join(PUBLIC_DIR, path.basename(pathname)));
      return;
    }

    // --- Route: POST /api/upload (Phase 2) ---
    if (method === 'POST' && pathname === '/api/upload') {
      sendJSON(res, 501, { error: 'not_implemented', message: 'Upload logic not yet implemented. Coming in Phase 2.' });
      return;
    }

    // --- Route: GET /api/media/:id (Phase 2) ---
    if (method === 'GET' && /^\/api\/media\/[^/]+$/.test(pathname)) {
      const mediaId = pathname.split('/')[3];
      sendJSON(res, 501, { error: 'not_implemented', message: `Media info for "${mediaId}" not yet implemented. Coming in Phase 2.` });
      return;
    }

    // --- Route: GET /api/media/:id/stream (Phase 2) ---
    if (method === 'GET' && /^\/api\/media\/[^/]+\/stream$/.test(pathname)) {
      const mediaId = pathname.split('/')[3];
      sendJSON(res, 501, { error: 'not_implemented', message: `Media stream for "${mediaId}" not yet implemented. Coming in Phase 2.` });
      return;
    }

    // --- Route: POST /api/export (Phase 3) ---
    if (method === 'POST' && pathname === '/api/export') {
      sendJSON(res, 501, { error: 'not_implemented', message: 'Export logic not yet implemented. Coming in Phase 3.' });
      return;
    }

    // --- Route: GET /api/export/:jobId/status (Phase 3) ---
    if (method === 'GET' && /^\/api\/export\/[^/]+\/status$/.test(pathname)) {
      const jobId = pathname.split('/')[3];
      sendJSON(res, 501, { error: 'not_implemented', message: `Export status for "${jobId}" not yet implemented. Coming in Phase 3.` });
      return;
    }

    // --- Route: GET /api/export/:jobId/download (Phase 3) ---
    if (method === 'GET' && /^\/api\/export\/[^/]+\/download$/.test(pathname)) {
      const jobId = pathname.split('/')[3];
      sendJSON(res, 501, { error: 'not_implemented', message: `Export download for "${jobId}" not yet implemented. Coming in Phase 3.` });
      return;
    }

    // --- 404 Handler ---
    sendJSON(res, 404, { error: 'not_found' });

  } catch (err) {
    // --- Central Error Handler ---
    console.error('[Server Error]', err.message);
    sendJSON(res, 500, { error: 'internal_error' });
  }
});

/**
 * Start the server
 */
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}/`);
});

/**
 * Handle uncaught exceptions to prevent process crash
 */
process.on('uncaughtException', (err) => {
  console.error('[Uncaught Exception]', err.message);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[Unhandled Rejection]', reason);
});

module.exports = server;
