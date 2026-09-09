const http = require('http');
const fs = require('fs');
const fsPromises = require('fs/promises');
const path = require('path');
const url = require('url');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { Transform } = require('stream');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const OUTPUT_DIR = path.join(__dirname, 'output');
const MAX_FILE_SIZE = 500 * 1024 * 1024; // 500MB

const MEDIA_STORE = new Map();

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

const ALLOWED_EXTENSIONS = new Set(['.mp4', '.mov', '.webm', '.mkv']);

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

function parseMultipart(req, maxSize) {
  return new Promise((resolve, reject) => {
    const contentType = req.headers['content-type'] || '';
    const boundaryMatch = contentType.match(/boundary=(.+)/);
    if (!boundaryMatch) {
      return reject(new Error('missing_boundary'));
    }
    const boundary = boundaryMatch[1].replace(/^"/, '').replace(/"$/, '');
    const parts = [];
    let totalSize = 0;
    let state = 'body_start';
    let partBodyBuffer = Buffer.alloc(0);
    let headersBuffer = Buffer.alloc(0);
    let isFile = false;
    let fieldName = null;
    let partContentType = 'application/octet-stream';
    let partFileName = null;
    let bodyStarted = false;

    function parseHeaders(headerText) {
      const lines = headerText.split(/\r?\n/);
      for (const line of lines) {
        const idx = line.indexOf(':');
        if (idx > 0) {
          const key = line.slice(0, idx).toLowerCase().trim();
          const val = line.slice(idx + 1).trim();
          if (key === 'content-disposition') {
            const nameMatch = val.match(/name="([^"]+)"/);
            if (nameMatch) fieldName = nameMatch[1];
            const fileMatch = val.match(/filename="([^"]+)"/);
            if (fileMatch) {
              isFile = true;
              partFileName = fileMatch[1].replace(/\.\.\//g, '').replace(/\/(.*)$/, '$1');
            }
          }
          if (key === 'content-type') {
            partContentType = val.split(';')[0].trim();
          }
        }
      }
    }

    function finalizePart() {
      parts.push({
        isFile,
        fieldName,
        fileName: isFile ? partFileName : null,
        contentType: partContentType,
        body: partBodyBuffer,
      });
      isFile = false;
      fieldName = null;
      partContentType = 'application/octet-stream';
      partFileName = null;
      partBodyBuffer = Buffer.alloc(0);
      headersBuffer = Buffer.alloc(0);
      bodyStarted = false;
    }

    function rejectWith(msg) {
      reject(new Error(msg));
    }

    function processChunk(chunk) {
      totalSize += chunk.length;
      if (totalSize > maxSize) {
        rejectWith('payload_too_large');
        return false;
      }

      const data = Buffer.concat([partBodyBuffer, chunk]);
      partBodyBuffer = Buffer.alloc(0);
      let pos = 0;
      const dataLen = data.length;

      while (pos < dataLen) {
        if (state === 'body_start') {
          // First boundary: --boundary (no leading CRLF)
          const bprefix = '--' + boundary;
          const bplen = bprefix.length;
          if (dataLen - pos >= bplen) {
            if (data.slice(pos, pos + bplen).toString() === bprefix) {
              pos += bplen;
              // Expect \r\n after boundary
              if (data[pos] === 13 && data[pos + 1] === 10) {
                pos += 2;
                state = 'headers';
                headersBuffer = Buffer.alloc(0);
                continue;
              } else if (data[pos] === 10) {
                pos += 1;
                state = 'headers';
                headersBuffer = Buffer.alloc(0);
                continue;
              }
            }
          }
          // Not enough data yet
          partBodyBuffer = data.slice(pos);
          return true;
        }

        if (state === 'headers') {
          const crlfIndex = data.indexOf('\r\n', pos);
          if (crlfIndex === -1) {
            if (dataLen - pos > 8192) {
              rejectWith('bad_request');
              return false;
            }
            partBodyBuffer = data.slice(pos);
            return true;
          }
          const headerLine = data.slice(pos, crlfIndex).toString('utf8');
          headersBuffer = Buffer.concat([headersBuffer, data.slice(pos, crlfIndex + 2)]);
          if (headerLine === '') {
            parseHeaders(headersBuffer.toString('utf8'));
            pos = crlfIndex + 2;
            bodyStarted = true;
            state = 'body';
            continue;
          }
          pos = crlfIndex + 2;
          continue;
        }

        if (state === 'body') {
          // Look for \r\n--boundary in body
          const searchFrom = pos;
          let found = false;

          while (!found && pos < dataLen) {
            if (data[pos] === 13 && pos + 3 < dataLen && data[pos + 1] === 10 && data[pos + 2] === 45 && data[pos + 3] === 45) {
              const boundaryStart = pos;
              const bstart = pos + 4; // after \r\n--
              const brest = boundary;
              if (dataLen - bstart >= brest.length && data.slice(bstart, bstart + brest.length).toString() === brest) {
                const afterBoundary = bstart + brest.length;
                if (afterBoundary < dataLen && data[afterBoundary] === 45 && data[afterBoundary + 1] === 45) {
                  // End marker: \r\n--boundary--
                  const bodyEnd = boundaryStart;
                  partBodyBuffer = Buffer.concat([partBodyBuffer, data.slice(searchFrom, bodyEnd)]);
                  finalizePart();
                  pos = afterBoundary + 2;
                  state = 'body_start';
                  found = true;
                  continue;
                } else if (afterBoundary === dataLen) {
                  // Boundary at end of data, need more data
                  partBodyBuffer = data.slice(searchFrom);
                  return true;
                } else {
                  // Regular boundary: \r\n--boundary\r\n
                  if (afterBoundary + 2 <= dataLen && data[afterBoundary] === 13 && data[afterBoundary + 1] === 10) {
                    const bodyEnd = boundaryStart;
                    partBodyBuffer = Buffer.concat([partBodyBuffer, data.slice(searchFrom, bodyEnd)]);
                    finalizePart();
                    pos = afterBoundary + 2;
                    state = 'headers';
                    headersBuffer = Buffer.alloc(0);
                    found = true;
                    continue;
                  } else {
                    partBodyBuffer = data.slice(searchFrom);
                    return true;
                  }
                }
              }
            }
            pos++;
          }

          if (!found) {
            partBodyBuffer = Buffer.concat([partBodyBuffer, data.slice(searchFrom)]);
            return true;
          }
        }
      }

      return true;
    }

    req.on('data', (chunk) => {
      if (!processChunk(chunk)) {
        req.destroy();
      }
    });

    req.on('end', () => {
      resolve(parts);
    });

    req.on('error', (err) => rejectWith('upload_failed: ' + err.message));
  });
}

async function getMediaInfo(filePath) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('ffprobe_timeout'));
    }, 15000);

    execFile(
      'ffprobe',
      [
        '-v', 'error',
        '-print_format', 'json',
        '-show_format',
        '-show_streams',
        filePath,
      ],
      (error, stdout, stderr) => {
        clearTimeout(timeout);
        if (error) {
          return reject(new Error('ffprobe_failed: ' + (stderr || error.message)));
        }
        try {
          const data = JSON.parse(stdout);
          const format = data.format || {};
          const streams = data.streams || [];

          const videoStream = streams.find(s => s.codec_type === 'video');
          const audioStream = streams.find(s => s.codec_type === 'audio');

          const duration = parseFloat(format.duration) || 0;
          const width = parseInt(videoStream?.width) || 0;
          const height = parseInt(videoStream?.height) || 0;
          const hasVideo = !!videoStream;
          const hasAudio = !!audioStream;

          let fps = 30;
          if (videoStream && videoStream.r_frame_rate) {
            const parts = videoStream.r_frame_rate.split('/');
            fps = parseFloat(parts[0]) / parseFloat(parts[1] || '1');
            if (isNaN(fps)) fps = 30;
          }

          resolve({
            id: '',
            filename: filePath,
            duration,
            width,
            height,
            hasAudio,
            hasVideo,
            fps: Math.round(fps * 100) / 100,
          });
        } catch (e) {
          reject(new Error('ffprobe_parse_failed: ' + e.message));
        }
      }
    );
  });
}

async function ensureDir(dirPath) {
  await fsPromises.mkdir(dirPath, { recursive: true });
}

// ============================================================
// Phase 3 — Export Pipeline Functions
// ============================================================

const EXPORT_JOBS = new Map();
let ffmpegRunning = false;

function buildInputArgs(mediaList, mediaStore) {
  const seen = new Set();
  const args = [];
  const inputIndexMap = new Map();
  let inputIndex = 0;

  for (const mediaId of mediaList) {
    if (seen.has(mediaId)) continue;
    seen.add(mediaId);
    const media = mediaStore.get(mediaId);
    if (!media) continue;
    const filePath = path.join(UPLOAD_DIR, media.filename);
    args.push('-i', filePath);
    inputIndexMap.set(mediaId, inputIndex);
    inputIndex++;
  }

  return { args, inputIndexMap };
}

function buildMainFilter(mainTrack, inputIndexMap) {
  const filterLines = [];
  const videoLabels = [];
  const audioLabels = [];

  mainTrack.forEach((clip, i) => {
    const inputIndex = inputIndexMap.get(clip.sourceId);
    const sourceIn = clip.sourceIn || 0;
    const sourceOut = clip.sourceOut;

    filterLines.push(
      `[${inputIndex}:v]trim=start=${sourceIn}:end=${sourceOut},setpts=PTS-STARTPTS[v${i}]`
    );
    filterLines.push(
      `[${inputIndex}:a]atrim=start=${sourceIn}:end=${sourceOut},asetpts=PTS-STARTPTS[a${i}]`
    );

    videoLabels.push(`[v${i}]`);
    audioLabels.push(`[a${i}]`);
  });

  return { filterLines, videoLabels, audioLabels };
}

function buildConcatFilter(videoLabels, audioLabels) {
  const filterLines = [];
  const numClips = videoLabels.length;

  if (numClips === 1) {
    // Just use the trimmed streams directly, no filter needed
    return { filterLines: [], outVideo: videoLabels[0], outAudio: audioLabels[0] };
  }

  const concatInputs = videoLabels.concat(audioLabels).join('');
  filterLines.push(
    `${concatInputs}concat=n=${numClips}:v=1:a=1[outv][outa]`
  );

  return { filterLines, outVideo: '[outv]', outAudio: '[outa]' };
}

function buildOutputArgs(timeline, outVideo = '[outv]', outAudio = '[outa]') {
  const fps = timeline.fps || 30;
  return [
    '-map', outVideo,
    '-map', outAudio,
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '23',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-r', String(fps),
    '-movflags', '+faststart',
  ];
}

function validateTimeline(timeline, mediaStore) {
  const errors = [];
  const { mainTrack, overlayTracks, outputWidth, outputHeight } = timeline;

  if (!mainTrack || mainTrack.length === 0) {
    errors.push('mainTrack must have at least 1 clip');
  }

  if (!overlayTracks || !overlayTracks['1'] || !overlayTracks['2'] || !overlayTracks['3']) {
    errors.push('overlayTracks must have keys "1", "2", "3"');
  }

  if (!Number.isFinite(outputWidth) || outputWidth <= 0 || outputWidth % 2 !== 0) {
    errors.push('outputWidth must be a positive even number');
  }
  if (!Number.isFinite(outputHeight) || outputHeight <= 0 || outputHeight % 2 !== 0) {
    errors.push('outputHeight must be a positive even number');
  }

  for (const clip of mainTrack) {
    const media = mediaStore.get(clip.sourceId);
    if (!media) {
      errors.push(`main clip ${clip.id}: sourceId '${clip.sourceId}' not found`);
      continue;
    }
    if (clip.sourceIn >= clip.sourceOut) {
      errors.push(`main clip ${clip.id}: sourceIn (${clip.sourceIn}) >= sourceOut (${clip.sourceOut})`);
    }
    if (clip.sourceOut > media.duration) {
      errors.push(`main clip ${clip.id}: sourceOut (${clip.sourceOut}) > media duration (${media.duration})`);
    }
    if (!media.hasVideo || !media.hasAudio) {
      errors.push(`main clip ${clip.id}: source media must have both video and audio`);
    }
  }

  const totalDuration = mainTrack.reduce((sum, clip) => {
    return sum + ((clip.sourceOut || 0) - (clip.sourceIn || 0));
  }, 0);

  for (let trackIdx = 1; trackIdx <= 3; trackIdx++) {
    const clips = overlayTracks[String(trackIdx)];
    if (!clips || clips.length === 0) continue;

    for (const clip of clips) {
      const media = mediaStore.get(clip.sourceId);
      if (!media) {
        errors.push(`overlay clip ${clip.id} (track ${trackIdx}): sourceId '${clip.sourceId}' not found`);
        continue;
      }

      const duration = clip.sourceOut - (clip.sourceIn || 0);
      const end = (clip.timelineStart || 0) + duration;

      if (clip.trackIndex !== undefined && (clip.trackIndex < 1 || clip.trackIndex > 3)) {
        errors.push(`overlay clip ${clip.id}: trackIndex must be 1, 2, or 3`);
      }

      if (duration <= 0) {
        errors.push(`overlay clip ${clip.id}: duration must be positive`);
      }
      if (duration > media.duration) {
        errors.push(`overlay clip ${clip.id}: duration (${duration}) > media duration (${media.duration})`);
      }
      if (end > totalDuration) {
        errors.push(`overlay clip ${clip.id}: timelineStart + duration (${end}) > total duration (${totalDuration})`);
      }
      if (clip.x + clip.width > outputWidth || clip.y + clip.height > outputHeight) {
        errors.push(`overlay clip ${clip.id}: position + size exceeds output dimensions`);
      }

      const opacity = clip.opacity !== undefined ? clip.opacity : 1.0;
      if (opacity < 0.0 || opacity > 1.0) {
        errors.push(`overlay clip ${clip.id}: opacity must be between 0.0 and 1.0`);
      }

      for (const other of clips) {
        if (other.id === clip.id) continue;
        const otherStart = other.timelineStart || 0;
        const otherEnd = otherStart + (other.sourceOut - (other.sourceIn || 0));
        const clipStart = clip.timelineStart || 0;
        const clipEnd = clipStart + duration;
        if (clipStart < otherEnd && clipEnd > otherStart) {
          errors.push(`overlay clips ${clip.id} and ${other.id} overlap in track ${trackIdx}`);
        }
      }
    }
  }

  return errors;
}

async function runExportJob(jobId, timeline) {
  const job = EXPORT_JOBS.get(jobId);
  if (!job) return;

  job.status = 'running';
  job.progress = 0.0;
  saveExportJob(job);

  try {
    const { mainTrack, overlayTracks, outputWidth, outputHeight, fps } = timeline;
    const allMediaIds = [...new Set([...mainTrack.map(c => c.sourceId)])];

    for (let t = 1; t <= 3; t++) {
      const clips = overlayTracks[String(t)];
      if (clips && clips.length > 0) {
        clips.forEach(c => {
          if (!allMediaIds.includes(c.sourceId)) allMediaIds.push(c.sourceId);
        });
      }
    }

    const { args: inputArgs, inputIndexMap } = buildInputArgs(allMediaIds, MEDIA_STORE);
    const mainResult = buildMainFilter(mainTrack, inputIndexMap);

    const hasOverlays = [1, 2, 3].some(t => {
      const clips = overlayTracks[String(t)];
      return clips && clips.length > 0;
    });

    let filterLines = [...mainResult.filterLines];
    let outVideo = mainResult.videoLabels[mainResult.videoLabels.length - 1] || '[v0]';
    let outAudio = mainResult.audioLabels[mainResult.audioLabels.length - 1] || '[a0]';

    if (!hasOverlays) {
      const concatResult = buildConcatFilter(mainResult.videoLabels, mainResult.audioLabels);
      filterLines.push(...concatResult.filterLines);
      outVideo = concatResult.outVideo;
      outAudio = concatResult.outAudio;
    } else {
      const totalDuration = mainTrack.reduce((s, c) => s + ((c.sourceOut || 0) - (c.sourceIn || 0)), 0);
      const concatResult = buildConcatFilter(mainResult.videoLabels, mainResult.audioLabels);
      filterLines.push(...concatResult.filterLines);
      outVideo = concatResult.outVideo;
      outAudio = concatResult.outAudio;

      for (let trackIdx = 1; trackIdx <= 3; trackIdx++) {
        const clips = overlayTracks[String(trackIdx)];
        if (!clips || clips.length === 0) continue;

        for (let clipIdx = 0; clipIdx < clips.length; clipIdx++) {
          const clip = clips[clipIdx];
          const inputIndex = inputIndexMap.get(clip.sourceId);
          const duration = clip.sourceOut - (clip.sourceIn || 0);
          const opacity = clip.opacity !== undefined ? clip.opacity : 1.0;
          const x = clip.x || 0;
          const y = clip.y || 0;
          const timelineStart = clip.timelineStart || 0;
          const end = timelineStart + duration;

          const ovLabel = `ov${trackIdx}_${clipIdx}`;
          const ovFmtLabel = `ov${trackIdx}_${clipIdx}_fmt`;

          filterLines.push(
            `[${inputIndex}:v]trim=start=${clip.sourceIn || 0}:end=${clip.sourceOut},setpts=PTS-STARTPTS[${ovLabel}]`
          );
          filterLines.push(
            `[${ovLabel}]format=rgba,colorchannelmixer=aa=${opacity}[${ovFmtLabel}]`
          );

          let overlayInput = `[${ovFmtLabel}]`;
          if (clipIdx === 0) {
            overlayInput = `[${outVideo}][${ovFmtLabel}]`;
          }

          const outLabel = clipIdx < clips.length - 1 ? `[ov${trackIdx}_${clipIdx}]` : `[ov${trackIdx}]`;
          filterLines.push(
            `[${overlayInput}]overlay=enable='between(t,${timelineStart},${end})':x=${x}:y=${y}${outLabel}`
          );
        }

        const lastOvLabel = clips.length === 1 ? `[ov${trackIdx}_0]` : `[ov${trackIdx}]`;
        outVideo = lastOvLabel;
      }
    }

    const outputArgs = buildOutputArgs(timeline, outVideo, outAudio);
    const outputPath = path.join(OUTPUT_DIR, `${jobId}.mp4`);

    const filterComplex = filterLines.join(';');
    const ffmpegCmd = 'ffmpeg';
    const ffmpegArgs = [
      ...inputArgs,
      '-filter_complex', filterComplex,
      ...outputArgs,
      '-y',
      outputPath,
    ];

    console.log('[export] ffmpeg args:', ffmpegArgs.join(' '));

    job.ffmpegProcess = execFile(ffmpegCmd, ffmpegArgs, { timeout: 300000 }, (error, stdout, stderr) => {
      if (error) {
        console.error('[export] ffmpeg error:', error.message, stderr?.toString() || '');
        job.status = 'failed';
        job.error = 'export_failed';
        job.progress = 1.0;
        saveExportJob(job);
        ffmpegRunning = false;
        return;
      }
      job.status = 'done';
      job.progress = 1.0;
      job.outputPath = outputPath;
      saveExportJob(job);
      ffmpegRunning = false;
    });

    job.ffmpegProcess.stderr.on('data', (data) => {
      const str = data.toString();
      const timeMatch = str.match(/time=(\d+):(\d+):(\d+\.\d+)/);
      if (timeMatch) {
        const secs = parseInt(timeMatch[1]) * 3600 + parseInt(timeMatch[2]) * 60 + parseFloat(timeMatch[3]);
        job.progress = Math.min(secs / (timeline.duration || 60), 1.0);
        saveExportJob(job);
      }
    });
  } catch (err) {
    console.error('[export] runExportJob error:', err);
    job.status = 'failed';
    job.error = err.message;
    job.progress = 1.0;
    saveExportJob(job);
    ffmpegRunning = false;
  }
}

function saveExportJob(job) {
  EXPORT_JOBS.set(job.jobId, job);
  const jsonPath = path.join(OUTPUT_DIR, `${job.jobId}.status.json`);
  try {
    fs.writeFileSync(jsonPath, JSON.stringify(job, null, 2));
  } catch (e) {
    console.error('Failed to save export job:', e.message);
  }
}

const server = http.createServer(async (req, res) => {
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
      if (!filePath.startsWith(PUBLIC_DIR)) {
        sendJson(res, 403, { error: 'forbidden' });
        return;
      }
      if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        serveStaticFile(res, filePath);
        return;
      }
    }

    // POST /api/upload
    if (pathname === '/api/upload' && req.method === 'POST') {
      const contentLength = parseInt(req.headers['content-length'] || '0', 10);
      if (contentLength > MAX_FILE_SIZE + 1024 * 1024 * 10) {
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'payload_too_large', message: 'File exceeds 500MB limit' }));
        req.destroy();
        return;
      }

      const boundary = (req.headers['content-type'] || '').match(/boundary=(.+)/);
      if (!boundary) {
        sendJson(res, 400, { error: 'bad_request', message: 'Missing multipart boundary' });
        return;
      }

      let parts;
      try {
        parts = await parseMultipart(req, MAX_FILE_SIZE + 1024 * 1024 * 10);
      } catch (err) {
        if (err.message === 'payload_too_large') {
          sendJson(res, 413, { error: 'payload_too_large', message: 'File exceeds 500MB limit' });
        } else {
          sendJson(res, 400, { error: 'bad_request', message: err.message });
        }
        return;
      }

      const filePart = parts.find(p => p.isFile);
      if (!filePart || !filePart.body || filePart.body.length === 0) {
        sendJson(res, 400, { error: 'bad_request', message: 'No file uploaded' });
        return;
      }

      const ext = path.extname(filePart.fileName || '').toLowerCase();
      if (!ALLOWED_EXTENSIONS.has(ext)) {
        sendJson(res, 400, { error: 'bad_request', message: `File type not allowed. Allowed: ${[...ALLOWED_EXTENSIONS].join(', ')}` });
        return;
      }

      const mediaId = crypto.randomUUID();
      const filename = `${mediaId}${ext}`;
      const filePath = path.join(UPLOAD_DIR, filename);

      try {
        await fsPromises.writeFile(filePath, filePart.body);
        const mediaInfo = await getMediaInfo(filePath);
        const mediaObject = {
          ...mediaInfo,
          id: mediaId,
          filename,
        };

        MEDIA_STORE.set(mediaId, mediaObject);

        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(mediaObject));
      } catch (err) {
        console.error('ffprobe error:', err.message);
        try { await fsPromises.unlink(filePath); } catch {}
        sendJson(res, 422, { error: 'invalid_media_file', message: err.message });
      }
      return;
    }

    // GET /api/media/:id
    const mediaInfoMatch = pathname.match(/^\/api\/media\/([^/]+)$/);
    if (mediaInfoMatch && req.method === 'GET') {
      const mediaId = mediaInfoMatch[1];
      const media = MEDIA_STORE.get(mediaId);
      if (!media) {
        sendJson(res, 404, { error: 'not_found', message: 'Media not found' });
        return;
      }
      sendJson(res, 200, media);
      return;
    }

    // GET /api/media/:id/stream
    const mediaStreamMatch = pathname.match(/^\/api\/media\/([^/]+)\/stream$/);
    if (mediaStreamMatch && req.method === 'GET') {
      const mediaId = mediaStreamMatch[1];
      const media = MEDIA_STORE.get(mediaId);
      if (!media) {
        sendJson(res, 404, { error: 'not_found', message: 'Media not found' });
        return;
      }

      const filePath = path.join(UPLOAD_DIR, media.filename);
      const stat = fs.statSync(filePath);
      const fileSize = stat.size;

      const range = req.headers['range'];
      if (range) {
        const rangeMatch = range.match(/bytes=(\d+)-(\d*)/);
        if (rangeMatch) {
          const start = parseInt(rangeMatch[1], 10);
          const end = rangeMatch[2] ? parseInt(rangeMatch[2], 10) : fileSize - 1;

          if (start >= fileSize || start > end) {
            res.writeHead(416, {
              'Content-Range': `bytes */${fileSize}`,
              'Content-Type': 'application/json',
            });
            res.end(JSON.stringify({ error: 'range_not_satisfiable' }));
            return;
          }

          const contentLength = end - start + 1;
          res.writeHead(206, {
            'Content-Range': `bytes ${start}-${end}/${fileSize}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': contentLength,
            'Content-Type': media.contentType || 'video/mp4',
          });

          const fileStream = fs.createReadStream(filePath, { start, end });
          fileStream.pipe(res);
          return;
        }
      }

      res.writeHead(200, {
        'Content-Length': fileSize,
        'Content-Type': media.contentType || 'video/mp4',
        'Accept-Ranges': 'bytes',
      });
      fs.createReadStream(filePath).pipe(res);
      return;
    }

    // POST /api/export — Phase 3: Start export job
    if (pathname === '/api/export' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        let timeline;
        try {
          timeline = JSON.parse(body);
        } catch (e) {
          sendJson(res, 400, { errors: ['Invalid JSON in request body'] });
          return;
        }

        const validationErrors = validateTimeline(timeline, MEDIA_STORE);
        if (validationErrors.length > 0) {
          sendJson(res, 400, { errors: validationErrors });
          return;
        }

        if (ffmpegRunning) {
          sendJson(res, 429, { error: 'busy', message: 'Another export is running' });
          return;
        }

        const jobId = 'job_' + crypto.randomUUID().replace(/-/g, '').slice(0, 12);
        const job = {
          jobId,
          status: 'queued',
          progress: 0.0,
          outputPath: null,
          error: null,
        };
        EXPORT_JOBS.set(jobId, job);
        saveExportJob(job);

        ffmpegRunning = true;
        runExportJob(jobId, timeline);

        sendJson(res, 202, { jobId });
      });
      return;
    }

    // GET /api/export/:jobId/status — Phase 3: Check export status
    const exportStatusMatch = pathname.match(/^\/api\/export\/([^/]+)\/status$/);
    if (exportStatusMatch && req.method === 'GET') {
      const jobId = exportStatusMatch[1];
      const job = EXPORT_JOBS.get(jobId);
      if (!job) {
        sendJson(res, 404, { error: 'not_found', message: 'Export job not found' });
        return;
      }
      sendJson(res, 200, {
        status: job.status,
        progress: job.progress,
        error: job.error || null,
      });
      return;
    }

    // GET /api/export/:jobId/download — Phase 3: Download exported file
    const exportDownloadMatch = pathname.match(/^\/api\/export\/([^/]+)\/download$/);
    if (exportDownloadMatch && req.method === 'GET') {
      const jobId = exportDownloadMatch[1];
      const job = EXPORT_JOBS.get(jobId);
      if (!job || job.status !== 'done' || !job.outputPath) {
        sendJson(res, 404, { error: 'not_found', message: 'Export file not ready' });
        return;
      }

      const filePath = path.join(__dirname, job.outputPath);
      if (!fs.existsSync(filePath)) {
        sendJson(res, 404, { error: 'not_found', message: 'Export file not found on disk' });
        return;
      }

      const stat = fs.statSync(filePath);
      const fileSize = stat.size;
      const range = req.headers['range'];

      if (range) {
        const rangeMatch = range.match(/bytes=(\d+)-(\d*)/);
        if (rangeMatch) {
          const start = parseInt(rangeMatch[1], 10);
          const end = rangeMatch[2] ? parseInt(rangeMatch[2], 10) : fileSize - 1;

          if (start >= fileSize || start > end) {
            res.writeHead(416, {
              'Content-Range': `bytes */${fileSize}`,
              'Content-Type': 'application/octet-stream',
            });
            res.end(JSON.stringify({ error: 'range_not_satisfiable' }));
            return;
          }

          const contentLength = end - start + 1;
          res.writeHead(206, {
            'Content-Range': `bytes ${start}-${end}/${fileSize}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': contentLength,
            'Content-Type': 'video/mp4',
          });

          fs.createReadStream(filePath, { start, end }).pipe(res);
          return;
        }
      }

      res.writeHead(200, {
        'Content-Length': fileSize,
        'Content-Type': 'video/mp4',
        'Accept-Ranges': 'bytes',
      });
      fs.createReadStream(filePath).pipe(res);
      return;
    }

    // 404 handler
    sendJson(res, 404, { error: 'not_found' });

  } catch (err) {
    console.error('Unhandled error:', err.message);
    sendJson(res, 500, { error: 'internal_error' });
  }
});

async function start() {
  try {
    await Promise.all([ensureDir(UPLOAD_DIR), ensureDir(OUTPUT_DIR)]);
  } catch (err) {
    console.error('Failed to create directories:', err.message);
  }

  server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}/`);
  });
}

start();
