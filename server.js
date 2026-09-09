const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.eot': 'application/vnd.ms-fontobject',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
};

function serveStaticFile(res, filePath) {
  const extname = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[extname] || 'application/octet-stream';

  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
      } else {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Internal Server Error');
      }
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content, 'utf-8');
    }
  });
}

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

const server = http.createServer((req, res) => {
  try {
    const parsedUrl = url.parse(req.url, true);
    const pathname = parsedUrl.pathname;

    // GET / → serve index.html
    if (pathname === '/' && req.method === 'GET') {
      serveStaticFile(res, path.join(PUBLIC_DIR, 'index.html'));
      return;
    }

    // Static files: /style.css, /editor.js, etc.
    if (req.method === 'GET') {
      let filePath = path.join(PUBLIC_DIR, pathname);
      // Ensure the file is within PUBLIC_DIR (prevent path traversal)
      if (!filePath.startsWith(PUBLIC_DIR)) {
        sendJson(res, 403, { error: 'forbidden' });
        return;
      }
      if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        serveStaticFile(res, filePath);
        return;
      }
    }

    // POST /api/upload — Phase 2: Upload video files
    if (pathname === '/api/upload' && req.method === 'POST') {
      sendJson(res, 501, { error: 'not_implemented', message: 'Upload not implemented yet (Phase 2)' });
      return;
    }

    // GET /api/media/:id — Phase 2: Get media info
    if (pathname.match(/^\/api\/media\/[^/]+$/) && req.method === 'GET') {
      sendJson(res, 501, { error: 'not_implemented', message: 'Media info not implemented yet (Phase 2)' });
      return;
    }

    // GET /api/media/:id/stream — Phase 2: Stream media file
    if (pathname.match(/^\/api\/media\/[^/]+\/stream$/) && req.method === 'GET') {
      sendJson(res, 501, { error: 'not_implemented', message: 'Media stream not implemented yet (Phase 2)' });
      return;
    }

    // POST /api/export — Phase 3: Start export job
    if (pathname === '/api/export' && req.method === 'POST') {
      sendJson(res, 501, { error: 'not_implemented', message: 'Export not implemented yet (Phase 3)' });
      return;
    }

    // GET /api/export/:jobId/status — Phase 3: Check export status
    if (pathname.match(/^\/api\/export\/[^/]+\/status$/) && req.method === 'GET') {
      sendJson(res, 501, { error: 'not_implemented', message: 'Export status not implemented yet (Phase 3)' });
      return;
    }

    // GET /api/export/:jobId/download — Phase 3: Download exported file
    if (pathname.match(/^\/api\/export\/[^/]+\/download$/) && req.method === 'GET') {
      sendJson(res, 501, { error: 'not_implemented', message: 'Export download not implemented yet (Phase 3)' });
      return;
    }

    // 404 handler
    sendJson(res, 404, { error: 'not_found' });

  } catch (err) {
    console.error('Unhandled error:', err.message);
    sendJson(res, 500, { error: 'internal_error' });
  }
});

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}/`);
});
