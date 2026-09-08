const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const crypto = require('crypto');
const child_process = require('child_process');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const MEDIA_STORE = new Map();
const MAX_FILE_SIZE = 500 * 1024 * 1024; // 500MB
const ALLOWED_EXTENSIONS = new Set(['.mp4', '.mov', '.webm', '.mkv']);
const ALLOWED_MIME_TYPES = new Set([
  'video/mp4', 'video/quicktime', 'video/webm', 'video/x-matroska',
  'video/*'
]);

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
 * Ensure upload directory exists
 */
function ensureUploadDir() {
  if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  }
}

/**
 * Parse multipart/form-data from a request stream (streaming, not full body)
 */
function parseMultipart(req, callback) {
  const contentType = req.headers['content-type'] || '';
  const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;\s]+))/);
  if (!boundaryMatch) {
    return callback(new Error('invalid_content_type'), null);
  }
  const boundary = boundaryMatch[1] || boundaryMatch[2];
  const boundaryStr = '--' + boundary;
  const endBoundaryStr = '--' + boundary + '--';

  let state = 'BOUNDARY'; // BOUNDARY | HEADERS | FILE | DONE
  let fileBuffer = [];
  let filename = null;
  let headerBuf = '';
  let done = false;
  let fileSize = 0;

  function parsePartHeaders(headersStr) {
    const fields = {};
    const lines = headersStr.split('\r\n');
    for (const line of lines) {
      const match = line.match(/^([a-zA-Z0-9-]+):\s*(.+)$/);
      if (match) {
        fields[match[1].toLowerCase()] = match[2].trim();
      }
    }
    return fields;
  }

  function findBoundaryInBuffer(buf, start) {
    const endBoundaryBuf = Buffer.from(endBoundaryStr);
    const bBuf = Buffer.from(boundaryStr);
    let pos = start;
    while (pos < buf.length) {
      const remaining = buf.length - pos;
      if (remaining >= endBoundaryBuf.length &&
          buf.slice(pos, pos + endBoundaryBuf.length).toString() === endBoundaryStr) {
        return { type: 'end', pos: pos + endBoundaryBuf.length };
      }
      if (remaining >= bBuf.length &&
          buf.slice(pos, pos + bBuf.length).toString() === boundaryStr) {
        return { type: 'boundary', pos: pos + bBuf.length };
      }
      pos++;
    }
    return { type: 'continue', pos };
  }

  function processFile() {
    if (!filename) return;
    const fileId = crypto.randomUUID();
    const ext = path.extname(filename).toLowerCase();
    const savedFilename = fileId + ext;
    const filePath = path.join(UPLOAD_DIR, savedFilename);
    const resolvedPath = path.resolve(filePath);
    if (!resolvedPath.startsWith(UPLOAD_DIR)) {
      return callback(new Error('invalid_path'), null);
    }

    const fileData = Buffer.concat(fileBuffer);
    fileBuffer = [];

    fs.writeFile(filePath, fileData, (writeErr) => {
      if (writeErr) {
        return callback(writeErr, null);
      }
      getMediaInfo(resolvedPath, (err, mediaInfo) => {
        if (err) {
          fs.unlink(filePath, () => {});
          return callback(err, null);
        }
        const mediaObj = {
          id: mediaInfo.id,
          filename: 'uploads/' + path.basename(savedFilename),
          duration: mediaInfo.duration,
          width: mediaInfo.width,
          height: mediaInfo.height,
          hasAudio: mediaInfo.hasAudio,
          hasVideo: mediaInfo.hasVideo,
          fps: mediaInfo.fps
        };
        MEDIA_STORE.set(mediaObj.id, mediaObj);
        callback(null, mediaObj);
      });
    });
  }

  function handleChunk(chunk) {
    let pos = 0;

    while (pos < chunk.length && !done) {
      if (state === 'BOUNDARY') {
        const result = findBoundaryInBuffer(chunk, pos);
        if (result.type === 'end') {
          done = true;
          pos = result.pos;
          return;
        }
        if (result.type === 'boundary') {
          pos = result.pos;
          state = 'HEADERS';
          headerBuf = '';
        } else {
          pos = result.pos;
        }
      } else if (state === 'HEADERS') {
        const headerEnd = chunk.indexOf('\r\n\r\n', pos);
        if (headerEnd === -1) {
          headerBuf += chunk.toString('utf8', pos);
          pos = chunk.length;
        } else {
          const headersStr = chunk.toString('utf8', pos, headerEnd);
          const headers = parsePartHeaders(headersStr);
          const disposition = headers['content-disposition'] || '';
          const fileMatch = disposition.match(/filename="([^"]+)"/);
          if (fileMatch) {
            filename = fileMatch[1].split(/[/\\]/).pop();
            state = 'FILE';
            fileBuffer = [];
            pos = headerEnd + 4;
          } else {
            state = 'BOUNDARY';
            pos = headerEnd + 4;
          }
        }
      } else if (state === 'FILE') {
        const bResult = findBoundaryInBuffer(chunk, pos);
        if (bResult.type === 'end') {
          const fileData = chunk.slice(pos, bResult.pos);
          if (fileData.length > 0) {
            fileBuffer.push(fileData);
            fileSize += fileData.length;
          }
          done = true;
          pos = bResult.pos;
        } else if (bResult.type === 'boundary') {
          const fileData = chunk.slice(pos, bResult.pos);
          if (fileData.length > 0) {
            fileBuffer.push(fileData);
            fileSize += fileData.length;
          }
          state = 'BOUNDARY';
          pos = bResult.pos;
        } else {
          fileBuffer.push(chunk.slice(pos));
          fileSize += chunk.length - pos;
          pos = chunk.length;
        }
      }
    }
  }

  req.on('data', (chunk) => {
    if (done) return;
    handleChunk(chunk);
  });

  req.on('end', () => {
    if (done && filename) {
      processFile();
    }
  });

  req.on('error', (err) => {
    if (!done) {
      done = true;
      callback(err, null);
    }
  });
}

/**
 * Run ffprobe on a media file and return parsed info
 */
function getMediaInfo(filePath, callback) {
  const timeout = 15000;

  const proc = child_process.execFile(
    'ffprobe',
    [
      '-v', 'error',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      filePath
    ],
    { timeout },
    (error, stdout, stderr) => {
      if (error) {
        return callback(new Error('ffprobe_failed: ' + (stderr || error.message)), null);
      }
      try {
        const data = JSON.parse(stdout);
        const streams = data.streams || [];
        const format = data.format || {};

        let hasVideo = false;
        let hasAudio = false;
        let width = 0;
        let height = 0;
        let fps = 0;
        let duration = parseFloat(format.duration) || 0;

        for (const stream of streams) {
          if (stream.codec_type === 'video') {
            hasVideo = true;
            width = parseInt(stream.width) || 0;
            height = parseInt(stream.height) || 0;
            if (stream.r_frame_rate) {
              const fpsParsed = parseFrameRate(stream.r_frame_rate);
              if (fps > 0) {
                fps = Math.max(fps, fpsParsed);
              } else {
                fps = fpsParsed;
              }
            }
          } else if (stream.codec_type === 'audio') {
            hasAudio = true;
          }
        }

        if (!hasVideo && !hasAudio) {
          return callback(new Error('no_streams_found'), null);
        }

        callback(null, {
          id: path.basename(filePath),
          duration,
          width,
          height,
          hasAudio,
          hasVideo,
          fps
        });
      } catch (err) {
        callback(new Error('parse_error: ' + err.message), null);
      }
    }
  );

  proc.on('error', (err) => {
    callback(new Error('ffprobe_process_error: ' + err.message), null);
  });
}

/**
 * Parse frame rate string (e.g., "30000/1001" or "30") to number
 */
function parseFrameRate(fpsStr) {
  if (!fpsStr) return 0;
  const parts = fpsStr.split('/');
  if (parts.length === 2) {
    const num = parseFloat(parts[0]);
    const den = parseFloat(parts[1]);
    if (den > 0) return num / den;
    return 0;
  }
  return parseFloat(fpsStr) || 0;
}

/**
 * Handle Range request for streaming
 */
function handleRangeRequest(req, res, filePath, stat) {
  const rangeHeader = req.headers?.range;
  const fileSize = stat.size;

  if (!rangeHeader) {
    res.writeHead(200, {
      'Content-Type': 'video/mp4',
      'Content-Length': fileSize,
      'Accept-Ranges': 'bytes'
    });
    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
    return;
  }

  const rangeMatch = rangeHeader.match(/bytes=(\d*)-(\d*)/);
  if (!rangeMatch) {
    res.writeHead(416, { 'Content-Range': `bytes */${fileSize}` });
    res.end();
    return;
  }

  let start = rangeMatch[1] ? parseInt(rangeMatch[1]) : 0;
  let end = rangeMatch[2] ? parseInt(rangeMatch[2]) : fileSize - 1;

  if (isNaN(start)) start = 0;
  if (isNaN(end)) end = fileSize - 1;

  if (start >= fileSize || end >= fileSize) {
    res.writeHead(416, { 'Content-Range': `bytes */${fileSize}` });
    res.end();
    return;
  }

  if (start > end) {
    res.writeHead(416, { 'Content-Range': `bytes */${fileSize}` });
    res.end();
    return;
  }

  const contentLength = end - start + 1;

  res.writeHead(206, {
    'Content-Type': 'video/mp4',
    'Content-Range': `bytes ${start}-${end}/${fileSize}`,
    'Accept-Ranges': 'bytes',
    'Content-Length': contentLength
  });

  const stream = fs.createReadStream(filePath, { start, end });
  stream.pipe(res);
  stream.on('error', (err) => {
    console.error('[Stream Error]', err.message);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'internal_error' }));
    }
  });
}

/**
 * Handle Range request for media stream (with dynamic content-type)
 */
function handleRangeRequestForStream(req, res, filePath, stat) {
  const rangeHeader = req.headers?.range;
  const fileSize = stat.size;

  if (!rangeHeader) {
    res.writeHead(200, {
      'Content-Type': 'video/mp4',
      'Content-Length': fileSize,
      'Accept-Ranges': 'bytes'
    });
    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
    return;
  }

  const rangeMatch = rangeHeader.match(/bytes=(\d*)-(\d*)/);
  if (!rangeMatch) {
    res.writeHead(416, { 'Content-Range': `bytes */${fileSize}` });
    res.end();
    return;
  }

  let start = rangeMatch[1] ? parseInt(rangeMatch[1]) : 0;
  let end = rangeMatch[2] ? parseInt(rangeMatch[2]) : fileSize - 1;

  if (isNaN(start)) start = 0;
  if (isNaN(end)) end = fileSize - 1;

  if (start >= fileSize || end >= fileSize) {
    res.writeHead(416, { 'Content-Range': `bytes */${fileSize}` });
    res.end();
    return;
  }

  if (start > end) {
    res.writeHead(416, { 'Content-Range': `bytes */${fileSize}` });
    res.end();
    return;
  }

  const contentLength = end - start + 1;

  res.writeHead(206, {
    'Content-Type': 'video/mp4',
    'Content-Range': `bytes ${start}-${end}/${fileSize}`,
    'Accept-Ranges': 'bytes',
    'Content-Length': contentLength
  });

  const stream = fs.createReadStream(filePath, { start, end });
  stream.pipe(res);
  stream.on('error', (err) => {
    console.error('[Stream Error]', err.message);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'internal_error' }));
    }
  });
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
      ensureUploadDir();

      const contentLength = parseInt(req.headers['content-length'] || '0', 10);
      if (contentLength > MAX_FILE_SIZE) {
        sendJSON(res, 413, { error: 'file_too_large', message: 'File exceeds 500MB limit' });
        req.destroy();
        return;
      }

      const contentType = req.headers['content-type'] || '';
      if (!contentType.includes('multipart/form-data')) {
        sendJSON(res, 400, { error: 'bad_request', message: 'Content-Type must be multipart/form-data' });
        return;
      }

      parseMultipart(req, (err, mediaObj) => {
        if (err) {
          console.error('[Upload Error]', err.message);
          if (err.message.includes('ffprobe') || err.message.includes('parse_error') || err.message.includes('no_streams')) {
            return sendJSON(res, 422, { error: 'invalid_media_file', message: err.message });
          }
          return sendJSON(res, 500, { error: 'internal_error', message: err.message });
        }
        sendJSON(res, 201, mediaObj);
      });
      return;
    }

    // --- Route: GET /api/media/:id (Phase 2) ---
    if (method === 'GET' && /^\/api\/media\/[^/]+$/.test(pathname)) {
      const mediaId = pathname.split('/')[3];
      const media = MEDIA_STORE.get(mediaId);
      if (!media) {
        sendJSON(res, 404, { error: 'not_found', message: 'Media not found' });
        return;
      }
      sendJSON(res, 200, media);
      return;
    }

    // --- Route: GET /api/media/:id/stream (Phase 2) ---
    if (method === 'GET' && /^\/api\/media\/[^/]+\/stream$/.test(pathname)) {
      const mediaId = pathname.split('/')[3];
      const media = MEDIA_STORE.get(mediaId);
      if (!media) {
        sendJSON(res, 404, { error: 'not_found', message: 'Media not found' });
        return;
      }
      const filePath = path.join(__dirname, media.filename);
      try {
        const stat = fs.statSync(filePath);
        handleRangeRequestForStream(req, res, filePath, stat);
      } catch (err) {
        sendJSON(res, 404, { error: 'not_found', message: 'File not found on disk' });
      }
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
