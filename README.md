# Minicut — Web Video Editor

A simple web-based video editor with timeline editing, overlay support, and FFmpeg-powered export.

## Features

- **Upload** video/audio files (MP4, MOV, WebM, MKV) via drag-and-drop or file picker
- **Timeline editing** with 4 tracks (1 main + 3 overlay layers)
- **Trim, split, and reorder** clips on the main track
- **Multi-layer overlay** with position, size, and opacity controls
- **Canvas preview** with real-time compositing
- **Export** to MP4 (H.264 + AAC) via FFmpeg
- **Range request** support for streaming large files

## Tech Stack

- **Backend:** Node.js (built-in `http` module, no frameworks)
- **Frontend:** Vanilla HTML/CSS/JS + HTML5 Canvas
- **Media processing:** FFmpeg / ffprobe via `child_process`
- **Storage:** Local filesystem (no database)

## Project Structure

```
project/
├── server.js              # All backend logic
├── public/
│   ├── index.html          # Main page
│   ├── style.css           # Styles
│   └── editor.js           # Editor logic
├── uploads/                # Uploaded source files
├── output/                 # Exported files + job status
├── SPEC.md                 # Project specification
└── AGENTS.md               # AI execution protocol
```

## Getting Started

### Prerequisites

- Node.js 18+
- FFmpeg and ffprobe installed and available in PATH

### Installation

```bash
# No dependencies to install — uses only Node.js built-in modules
```

### Running

```bash
node server.js
```

Open `http://localhost:3000` in a browser.

Set a custom port:

```bash
PORT=8080 node server.js
```

## Usage

1. **Upload media** — Click "Add media" or drag files into the upload area
2. **Edit timeline** — Drag clips to reorder, resize to trim, use Split to divide clips
3. **Add overlays** — Drag media onto overlay tracks (1-3), adjust position and opacity
4. **Preview** — Use the canvas preview and transport controls
5. **Export** — Click "Export" to render the final video

## API Reference

### Upload

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/upload` | Upload a video/audio file (multipart/form-data) |
| GET | `/api/media/:id` | Get media info |
| GET | `/api/media/:id/stream` | Stream media file (supports Range) |

### Export

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/export` | Start export job with timeline JSON |
| GET | `/api/export/:jobId/status` | Get export job status and progress |
| GET | `/api/export/:jobId/download` | Download exported file (supports Range) |

## Export Settings

- **Container:** MP4
- **Video:** libx264, preset `veryfast`, CRF 23
- **Audio:** AAC, 128kbps
- **Default resolution:** 1280x720 @ 30fps

## License

GNU General Public License v3 (GPLv3) — see `LICENSE` file
