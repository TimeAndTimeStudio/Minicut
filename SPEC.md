# SPEC.md — Web Video Editor (Timeline + Export) Specification

เวอร์ชัน: 1.0
เป้าหมาย: เว็บแอปตัดต่อวิดีโอแบบง่าย — อัปโหลดคลิป, จัด timeline (trim/split/reorder), ใส่ overlay, พรีวิวบน canvas, export เป็นไฟล์เดียวด้วย FFmpeg
สถานะ: ใช้คู่กับ AGENTS.md และ PHASE_CONTEXT_MAP.md ห้ามเขียนโค้ดโดยไม่ผ่านกฎใน AGENTS.md

---

## Section 0 — Overview / Architecture

**Stack:**
- Backend: Node.js เท่านั้น (built-in `http` module, ห้ามใช้ Express/framework ใหญ่ เว้นแต่ Phase อนุญาต) + `child_process` เรียก `ffmpeg`/`ffprobe`
- Frontend: Vanilla HTML/CSS/JS (ไม่ใช้ framework) + HTML5 Canvas สำหรับ preview compositing
- Storage: local filesystem (`uploads/`, `output/`) ไม่ใช้ database — เก็บ metadata เป็น JSON ในหน่วยความจำ + sync ลงไฟล์ `.json` ข้าง ๆ

**Data flow:**
```
[Browser] --upload(multipart)--> [server.js] --> uploads/<id>.<ext>
                                        |
                                        v
                                   ffprobe (media info)
                                        |
                                        v
[Browser: editor.js] <--JSON media info-- [server.js]
        |
        v (สร้าง timeline ใน memory ฝั่ง client)
        |
[Browser] --POST /api/export (timeline JSON)--> [server.js]
                                        |
                                        v
                              buildFfmpegArgs → runExportJob
                                        |
                                        v
                                 output/<jobId>.mp4
                                        |
[Browser] <--GET /api/export/:jobId/status-- [server.js]
[Browser] <--GET /api/export/:jobId/download (Range supported)-- [server.js]
```

**หลักการสำคัญ:** timeline state ทั้งหมดอยู่ฝั่ง client (JS object) จนกว่าจะกด export — backend ไม่ persist timeline draft

---

## Section 1 — Project Structure

```
project/
├── AGENTS.md
├── SPEC.md
├── PHASE_CONTEXT_MAP.md
├── server.js              # backend ทั้งหมดอยู่ไฟล์เดียว (ตาม scope lock ต่อ phase)
├── public/
│   ├── index.html
│   ├── style.css
│   └── editor.js
├── uploads/                # ไฟล์ต้นฉบับที่อัปโหลด (โครงสร้างแบน ไม่มี subfolder)
└── output/                 # ไฟล์ export + progress json
```

ห้ามเพิ่มไฟล์ backend ใหม่ (เช่น routes/, controllers/) เว้นแต่ SPEC ระบุเพิ่มภายหลัง — เพื่อให้ตรงกับ ALLOWED FILES ที่ระบุใน PHASE_CONTEXT_MAP.md ทุก Phase

---

## Section 2 — Base Server Setup (Phase 1 Scope)

- ใช้ `http.createServer` ธรรมดา ฟัง port จาก `process.env.PORT || 3000`
- Static file serving สำหรับ `public/` (`index.html`, `style.css`, `editor.js`) ด้วย mime type ที่ถูกต้อง (`text/html`, `text/css`, `application/javascript`)
- Routing skeleton แบบ manual (เช็ก `req.method` + `req.url` ด้วย `if/else` หรือ switch ง่าย ๆ ห้ามใช้ router library)
- Route ที่ต้องมีใน Phase 1 (ยังไม่ implement logic จริง แค่ตอบ 501 หรือ placeholder ที่ระบุชัดว่ายังไม่ทำ):
  - `POST /api/upload`
  - `GET /api/media/:id`
  - `POST /api/export`
  - `GET /api/export/:jobId/status`
  - `GET /api/export/:jobId/download`
- `GET /` → serve `public/index.html`
- 404 handler สำหรับ route ที่ไม่รู้จัก (JSON `{ error: "not_found" }`)
- Error handler กลาง: ทุก route ต้อง try/catch แล้วตอบ `500 { error: "internal_error" }` ไม่ crash process

**Phase 1 ไม่ต้อง:** upload logic จริง, ffprobe, ffmpeg, frontend editor logic

---

## Section 3 — Data Model

### Clip (อ้างอิงไฟล์ต้นฉบับ 1 ไฟล์)
```json
{
  "id": "clip_abc123",
  "sourceId": "media_xyz789",
  "type": "video",
  "sourceIn": 0,
  "sourceOut": 5.2,
  "trackIndex": 0
}
```
- `sourceIn` / `sourceOut`: หน่วยวินาที (float), ตัดจากไฟล์ต้นฉบับ ณ ตำแหน่งนี้
- `trackIndex`: 0 = main track (ต่อกันตามลำดับ timeline), 1+ = overlay track

### Overlay (ใช้ trackIndex >= 1)
```json
{
  "id": "overlay_def456",
  "sourceId": "media_uvw000",
  "sourceIn": 0,
  "sourceOut": 3.0,
  "trackIndex": 1,
  "timelineStart": 2.5,
  "x": 20,
  "y": 20,
  "width": 320,
  "height": 180
}
```
- `timelineStart`: วินาทีบน timeline หลักที่ overlay เริ่มปรากฏ
- `x, y, width, height`: หน่วย pixel บน output frame — ต้อง validate `x+width <= outputWidth` และ `y+height <= outputHeight`
- overlay **ไม่มี audio เสมอ** (mute เสมอ ไม่ว่าไฟล์ต้นฉบับจะมีเสียงหรือไม่)

### Timeline
```json
{
  "outputWidth": 1280,
  "outputHeight": 720,
  "fps": 30,
  "mainTrack": [ "<Clip ตามลำดับ>" ],
  "overlayTrack": [ "<Overlay>" ]
}
```

### Media (ผลจาก ffprobe หลังอัปโหลด)
```json
{
  "id": "media_xyz789",
  "filename": "uploads/media_xyz789.mp4",
  "duration": 12.4,
  "width": 1920,
  "height": 1080,
  "hasAudio": true,
  "hasVideo": true,
  "fps": 30
}
```

### ExportJob
```json
{
  "jobId": "job_001",
  "status": "queued | running | done | failed",
  "progress": 0.0,
  "outputPath": "output/job_001.mp4",
  "error": null
}
```

**Field name เหล่านี้ตายตัว ห้าม AI เปลี่ยนชื่อ field ในทุก Phase**

---

## Section 4 — Timeline / Editing Model (Logic ระดับ data)

- **Trim**: แก้ `sourceIn`/`sourceOut` ของ clip โดยตรง ไม่มีการ re-encode จนกว่าจะ export
- **Split**: แบ่ง clip ที่ตำแหน่ง `t` (วินาทีบน timeline ของ clip นั้น) → สร้าง clip ใหม่ 2 อัน:
  - clip เดิม: `sourceOut = sourceIn_เดิม + t`
  - clip ใหม่: `sourceIn = sourceIn_เดิม + t`, `sourceOut = sourceOut_เดิม`, แทรกต่อจาก clip เดิมใน `mainTrack`
- **Reorder**: สลับตำแหน่งใน array `mainTrack` เท่านั้น (ไม่กระทบ `sourceIn`/`sourceOut`)
- **Delete**: ลบ clip ออกจาก `mainTrack` array
- ความยาว timeline รวม = ผลรวม `(sourceOut - sourceIn)` ของทุก clip ใน `mainTrack` ตามลำดับ
- Overlay `timelineStart` อ้างอิงกับความยาว timeline รวมนี้ (ไม่ใช่เวลาบนไฟล์ต้นฉบับ)

---

## Section 5 — FFmpeg Filter Design: Input & Main Trim (Phase 3a)

**กฎเหล็ก:** ห้ามใช้ `-ss` หรือ `-to` ที่ input flag เด็ดขาด — trim ทั้งหมดต้องอยู่ใน `filter_complex` เท่านั้น (เพื่อความแม่นยำ frame-accurate)

**ฟังก์ชัน `buildInputArgs(mediaList)`**
- return array ของ `-i <path>` เรียงตามลำดับ mediaId ที่ใช้จริงใน timeline (unique, dedup ไฟล์ต้นฉบับที่ถูกอ้างซ้ำ)
- เก็บ mapping `mediaId -> inputIndex` ไว้ใช้ต่อใน filter graph

**ฟังก์ชัน `buildMainFilter(mainTrack, inputIndexMap)`**
- สำหรับแต่ละ clip ใน `mainTrack` สร้าง filter chain:
  ```
  [{inputIndex}:v]trim=start={sourceIn}:end={sourceOut},setpts=PTS-STARTPTS[v{i}]
  [{inputIndex}:a]atrim=start={sourceIn}:end={sourceOut},asetpts=PTS-STARTPTS[a{i}]
  ```
- ถ้า clip ต้นฉบับไม่มี audio (`hasAudio: false`) → **ห้าม** ใช้ `anullsrc` — ให้ validate ตั้งแต่ก่อน export ว่าทุก main clip ต้องมี audio จริง (reject request พร้อม error message ชัดเจนถ้าไม่มี)
- return object: `{ filterLines: string[], videoLabels: string[], audioLabels: string[] }`

---

## Section 6 — FFmpeg Filter Design: Concat (Phase 3b)

**ฟังก์ชัน `buildConcatFilter(videoLabels, audioLabels)`**
- ใช้ concat filter (ไม่ใช่ concat demuxer เพราะต้อง frame-accurate กับ trim):
  ```
  [v0][a0][v1][a1]...[vN][aN]concat=n=N+1:v=1:a=1[outv][outa]
  ```
- ถ้ามีแค่ 1 clip ใน mainTrack → ข้าม concat filter, ใช้ label จาก main filter ตรง ๆ เป็น `[outv][outa]` (rename ผ่าน `[v0]copy[outv]` หรือใช้ label เดิมได้เลย)
- ตรวจสอบก่อนต่อ concat: ทุก clip ต้องผ่าน validation "มีทั้ง video และ audio label" — ถ้าขาดอันใดอันหนึ่ง reject ทั้ง job

---

## Section 7 — Frontend UI Layout

**index.html โครงสร้างหลัก:**
```
<div id="app">
  <header>ชื่อโปรเจกต์ + ปุ่ม Export</header>
  <div id="preview-panel">
    <canvas id="preview-canvas" width="1280" height="720"></canvas>
  </div>
  <div id="upload-panel">
    <input type="file" id="file-input" multiple accept="video/*">
    <div id="media-library"></div> <!-- รายการไฟล์ที่อัปโหลดแล้ว -->
  </div>
  <div id="timeline-panel">
    <div id="main-track" class="track"></div>
    <div id="overlay-track" class="track"></div>
  </div>
  <div id="export-status"></div>
</div>
```

- `style.css` กำหนด layout เป็น flex/grid แบ่ง 3 โซนหลัก: preview (บน), media library (ซ้าย/ขวา), timeline (ล่าง)
- responsive ไม่จำเป็นสำหรับ mobile — ออกแบบสำหรับ desktop เท่านั้น
- ไม่ต้องมี framework CSS ภายนอก ใช้ CSS ธรรมดา

**Phase 4 ทำแค่โครง HTML/CSS นี้ ห้ามใส่ JS logic ใด ๆ ใน index.html (script tag แค่โหลด editor.js)**

---

## Section 8 — Canvas Compositing (พรีวิว ไม่ใช่ export จริง)

- Canvas ขนาดเท่า `outputWidth x outputHeight` ของ timeline
- วาด main track clip ที่ตำแหน่ง playhead ปัจจุบันด้วย `drawImage` จาก `<video>` element ที่ซ่อนไว้ (hidden video elements ต่อ media หนึ่งตัว)
- วาด overlay ทับด้านบนตามตำแหน่ง `x, y, width, height` ถ้า playhead อยู่ในช่วง `timelineStart` ถึง `timelineStart + (sourceOut-sourceIn)`
- นี่คือ **preview เท่านั้น** ไม่ใช่การ render จริง — ความแม่นยำ frame-level ไม่จำเป็นเท่า export
- Playhead scrubbing: ลาก playhead บน timeline panel → sync เวลาของ hidden `<video>` elements ที่เกี่ยวข้อง → redraw canvas

---

## Section 9 — Overlay Rules (สำคัญ — จุดเสี่ยงสูง)

1. overlay **ต้องไม่มี audio ใน output เสมอ** ไม่ว่าไฟล์ต้นฉบับจะมีเสียงหรือไม่ (mute โดยไม่ map audio stream ของ overlay เข้า output เลย)
2. `overlay.timelineStart + (sourceOut - sourceIn)` ต้องไม่เกินความยาว timeline รวม
3. `sourceOut - sourceIn` ของ overlay ต้องไม่เกิน duration จริงของไฟล์ต้นฉบับ (ต้องเช็กกับ ffprobe metadata)
4. `x + width <= outputWidth` และ `y + height <= outputHeight` เสมอ — reject job ถ้าไม่ผ่าน
5. รองรับ overlay ซ้อนกันได้สูงสุด 1 track ใน v1.0 (ไม่รองรับหลาย overlay track พร้อมกัน — ถ้ามีหลาย overlay ในช่วงเวลาเดียวกันบน track เดียว ให้ reject หรือเรียงตามลำดับที่ upload ก่อน)

---

## Section 10 — Export Pipeline

1. Client ส่ง `POST /api/export` พร้อม timeline JSON เต็ม
2. Server validate timeline (ดู Section 13)
3. สร้าง `jobId`, เก็บ `ExportJob` status = `queued` ใน memory + เขียนไฟล์ `output/<jobId>.status.json`
4. รัน `runExportJob(jobId, timeline)` แบบ async (ไม่ block request) → ตอบ client ทันทีด้วย `{ jobId }`
5. ระหว่างรัน ffmpeg → parse stderr เพื่ออัปเดต `progress` (ประมาณจาก `time=` ในหน้า ffmpeg progress log เทียบกับ total duration)
6. เมื่อเสร็จ → status = `done`, `outputPath` ชี้ไปไฟล์จริง
7. ถ้า error → status = `failed`, เก็บ error message (ไม่ leak stack trace เต็มให้ client เห็น แค่ summary)
8. Job เก่าที่ status `done`/`failed` เกิน 1 ชั่วโมง → ไม่ต้อง auto-cleanup ใน v1.0 (manual cleanup พอ)

---

## Section 11 — Output Encoding Settings

- Container: `.mp4`
- Video codec: `libx264`, `-preset veryfast`, `-crf 23`
- Audio codec: `aac`, `-b:a 128k`
- Resolution/fps: ตาม `timeline.outputWidth/outputHeight/fps` ที่ client กำหนด (default 1280x720 @ 30fps ถ้าไม่ระบุ)
- `-movflags +faststart` เสมอ (เพื่อรองรับ progressive download / range request)

**ฟังก์ชัน `buildOutputArgs(timeline)`** → return array เช่น
```
["-map", "[outv]", "-map", "[outa]", "-c:v", "libx264", "-preset", "veryfast",
 "-crf", "23", "-c:a", "aac", "-b:a", "128k", "-r", "30",
 "-movflags", "+faststart", "output/<jobId>.mp4"]
```

---

## Section 12 — Upload Handling

- `POST /api/upload` รับ `multipart/form-data`
- **ต้อง stream parse เอง** ห้ามอ่านทั้ง body เข้า memory ก่อนแล้วค่อย parse (ป้องกันไฟล์ใหญ่กิน RAM) — parse ทีละ chunk จาก `req` stream, เขียนไฟล์ลง `uploads/` แบบ stream ไปพร้อมกัน
- Limit ขนาดไฟล์: 500MB ต่อไฟล์ (reject ด้วย `413` ถ้าเกิน โดยเช็กจาก `Content-Length` header ก่อน และ hard-stop ระหว่าง stream ถ้าเกินจริง)
- Whitelist นามสกุลไฟล์: `.mp4`, `.mov`, `.webm`, `.mkv` เท่านั้น (เช็กทั้ง extension และ MIME type ที่ client ส่งมา ไม่เชื่อ extension อย่างเดียว)
- ตั้งชื่อไฟล์ใหม่เสมอด้วย generated id (เช่น `crypto.randomUUID()`) — **ห้ามใช้ filename จาก client ตรง ๆ** (ป้องกัน path traversal)
- หลัง upload เสร็จ → เรียก ffprobe ทันที (Section 14) แล้วตอบ client ด้วย Media object เต็ม (Section 3)

---

## Section 13 — Validation Rules

ก่อนเริ่ม export job ต้อง validate ทั้งหมดนี้ (reject ด้วย `400` พร้อม error list ถ้าไม่ผ่านข้อใดข้อหนึ่ง):

- `mainTrack` ต้องมีอย่างน้อย 1 clip
- ทุก `clip.sourceId` ต้องมีอยู่จริงใน media ที่เคย upload แล้ว
- `sourceIn < sourceOut` และ `sourceOut <= media.duration` ของทุก clip
- ทุก main clip: `media.hasVideo === true && media.hasAudio === true`
- ทุก overlay ผ่านกฎ Section 9 ครบทุกข้อ
- `outputWidth`, `outputHeight` เป็นเลขบวก, เป็นเลขคู่ (ffmpeg libx264 ต้องการ even dimension)
- ไม่มี clip ที่ `sourceId` ชี้ไปไฟล์ที่ไม่อยู่ใน `uploads/` จริง (กัน path injection จาก client)

---

## Section 14 — Media Info (ffprobe)

**ฟังก์ชัน `getMediaInfo(filePath)`**
- เรียก `ffprobe -v error -print_format json -show_format -show_streams <filePath>` ผ่าน `child_process.execFile` (ห้ามใช้ `exec` แบบ shell string เพื่อกัน command injection — ต้องใช้ `execFile` พร้อม args array)
- parse JSON output → map เป็น Media object (Section 3): `duration`, `width`, `height`, `hasAudio` (มี stream `codec_type: "audio"` หรือไม่), `hasVideo`, `fps` (จาก `r_frame_rate` แปลงเป็นทศนิยม)
- ถ้า ffprobe fail หรือ timeout (ตั้ง timeout 15 วินาที) → ตอบ error `422 { error: "invalid_media_file" }` และลบไฟล์ที่อัปโหลดทิ้ง

---

## Section 15 — API Routes

### Upload Routes (Phase 2)
| Method | Path | Body | Response |
|---|---|---|---|
| POST | `/api/upload` | multipart/form-data (field: `file`) | `201 { id, filename, duration, width, height, hasAudio, hasVideo, fps }` |
| GET | `/api/media/:id` | - | `200 <Media object>` หรือ `404` |
| GET | `/api/media/:id/stream` | - | ส่งไฟล์วิดีโอ รองรับ `Range` header (206 Partial Content) |

### Export Routes (Phase 3)
| Method | Path | Body | Response |
|---|---|---|---|
| POST | `/api/export` | `<Timeline JSON>` | `202 { jobId }` หรือ `400 { errors: [...] }` |
| GET | `/api/export/:jobId/status` | - | `200 { status, progress, error }` |
| GET | `/api/export/:jobId/download` | - | ส่งไฟล์ output รองรับ `Range` header, `404` ถ้ายังไม่เสร็จ |

**Range request implementation** ใช้กับทั้ง `/api/media/:id/stream` และ `/api/export/:jobId/download`:
- อ่าน `Range: bytes=start-end` header, ตอบ `206 Partial Content` พร้อม `Content-Range`, `Accept-Ranges: bytes`, `Content-Length` ที่ถูกต้อง ใช้ `fs.createReadStream(path, {start, end})`

---

## Section 16 — Editor Interaction (Drag/Resize/Split/Reorder)

- **Drag clip บน main track**: mousedown บน clip element → track ตำแหน่ง mouse → mouseup คำนวณตำแหน่งใหม่ใน array → reorder (Section 4) → re-render timeline
- **Resize clip (trim)**: ลาก handle ซ้าย/ขวาของ clip element → คำนวณ `sourceIn`/`sourceOut` ใหม่ตาม pixel-to-second ratio ของ timeline zoom level ปัจจุบัน → update state → re-render
- **Split**: คลิกปุ่ม split ขณะ playhead อยู่กลาง clip → คำนวณ `t` จากตำแหน่ง playhead เทียบกับจุดเริ่ม clip → เรียก split logic (Section 4)
- **Reorder ด้วย drag**: ใช้ HTML5 drag events หรือ mouse-based custom drag (ไม่บังคับ library ภายนอก)
- ทุก interaction ต้อง re-render preview canvas (Section 8) ทันทีหลัง state เปลี่ยน
- Pixel-to-second ratio: กำหนดจาก `timelineWidthPx / totalDurationSeconds` ปรับได้ด้วย zoom control

---

## Section 17 — Security & Risk Points (จุดที่ AI มักพลาด)

1. **Command injection**: ห้ามใช้ `child_process.exec` กับ string ที่ต่อจาก user input — ใช้ `execFile`/`spawn` พร้อม args array เท่านั้น ทุกจุดที่เรียก ffmpeg/ffprobe
2. **Path traversal**: ห้ามใช้ filename จาก client ตรง ๆ ในการสร้าง path บน filesystem — generate id เองเสมอ, validate ว่า resolved path ยังอยู่ใต้ `uploads/`/`output/` เท่านั้น
3. **Upload DoS**: ต้อง enforce ขนาดไฟล์ระหว่าง stream ไม่ใช่แค่เช็ก header (client โกหก header ได้)
4. **FFmpeg resource exhaustion**: จำกัด job export พร้อมกันสูงสุด (แนะนำ 1 job ต่อครั้งใน v1.0 — queue แบบง่าย ถ้ามี job รันอยู่ ให้ job ใหม่รอ)
5. **Overlay geometry overflow**: ต้อง validate ก่อนส่งเข้า ffmpeg ไม่ใช่ปล่อยให้ ffmpeg error แล้วค่อยจับ
6. **anullsrc footgun**: ห้ามเผลอเติม silent audio track ให้ clip ที่ไม่มีเสียงจริง — ต้อง reject ตั้งแต่ validation แทน

---

## Section 18 — Definition of Done ต่อ Phase

### Phase 1 DoD
- [ ] Server start ได้โดยไม่ error
- [ ] `GET /` serve index.html ได้ถูกต้อง
- [ ] Static files (`style.css`, `editor.js`) โหลดได้ด้วย mime type ถูกต้อง
- [ ] Route skeleton ทั้ง 5 เส้นตอบ response ตามที่ระบุ (placeholder ก็ได้)
- [ ] 404 handler ทำงาน
- [ ] Error ใด ๆ ไม่ทำให้ process crash

### Phase 2 DoD
- [ ] อัปโหลดไฟล์วิดีโอจริงได้สำเร็จ ไม่ค้าง ไม่ error สำหรับไฟล์ < 500MB
- [ ] ไฟล์ที่เกิน 500MB ถูก reject ด้วย 413
- [ ] นามสกุลไฟล์ที่ไม่ whitelist ถูก reject
- [ ] Media object ที่ตอบกลับมี field ครบตาม Section 3 และค่าตรงกับไฟล์จริง (เทียบกับ ffprobe manual)
- [ ] `/api/media/:id/stream` รองรับ Range request จริง (ทดสอบด้วย curl -r)
- [ ] ไม่มีการอ่าน body ทั้งไฟล์เข้า memory ก่อน parse (ตรวจโค้ดว่า stream จริง)

### Phase 3 DoD (รวม 3a-3d)
- [ ] Export 1 clip เดี่ยว (ไม่ split ไม่ overlay) ได้ไฟล์ output ที่เล่นได้จริง ความยาวตรงกับ trim
- [ ] Export หลายคลิปต่อกัน (concat) ได้ผลลัพธ์ต่อเนื่อง ไม่มี frame กระตุก/desync เสียง
- [ ] Export พร้อม overlay 1 ตัวได้ผลลัพธ์ที่ overlay อยู่ตำแหน่งและช่วงเวลาที่ถูกต้อง ไม่มีเสียงจาก overlay
- [ ] Validation (Section 13) reject request ที่ผิดกฎได้ครบทุกข้อ พร้อม error message ชัดเจน
- [ ] `/api/export/:jobId/status` รายงาน progress ที่สมเหตุสมผล (ไม่ค้างที่ 0 จนจบ)
- [ ] `/api/export/:jobId/download` รองรับ Range request

### Phase 4 DoD
- [ ] Layout ตรงตาม Section 7 แสดงผลถูกต้องบน browser (desktop)
- [ ] ไม่มี JS logic ใด ๆ ทำงานอยู่ (เป็น static UI ล้วน)

### Phase 5 DoD
- [ ] Drag reorder clip บน main track ทำงานได้จริงบน browser
- [ ] Resize (trim) clip ทำงานได้จริง ค่า sourceIn/sourceOut อัปเดตถูกต้อง
- [ ] Split clip ที่ตำแหน่ง playhead ทำงานถูกต้อง
- [ ] Canvas preview sync กับ timeline state และ playhead ถูกต้อง รวม overlay
- [ ] ส่ง timeline ที่แก้ไขแล้วไป export ได้ผลลัพธ์ตรงกับที่เห็นใน preview

### Phase 6 DoD
- [ ] ทุก scenario ใน Section 19 ผ่านจริง
- [ ] ไม่มี regression กับ Phase 1-5

---

## Section 19 — Integration Testing Plan (Phase 6)

1. **Happy path เต็มระบบ**: upload 2 คลิป → trim ทั้งคู่ → split คลิปแรก → reorder → เพิ่ม overlay → export → download → เล่นไฟล์ผลลัพธ์ตรวจด้วยตาจริง
2. **Edge case: คลิปเดียวไม่ trim**: upload 1 คลิป → export ตรง ๆ โดยไม่แก้ไข → output ต้องเหมือนต้นฉบับ (duration/resolution)
3. **Edge case: overlay เต็มความยาว timeline**: overlay ที่ `timelineStart=0` และยาวเท่า main track ทั้งหมด
4. **Edge case: validation reject**: ส่ง timeline ที่มี overlay เกิน bounds → ต้องได้ 400 พร้อม error ชัดเจน ไม่ crash server
5. **Edge case: ไฟล์ไม่มีเสียง**: upload ไฟล์ video-only เป็น main clip → ต้องถูก reject ตั้งแต่ validation ไม่ใช่ error ตอน ffmpeg รัน
6. **Range request**: ขอ partial content ของทั้งไฟล์ต้นฉบับและไฟล์ export ด้วย curl `-r 0-1023` → ตรวจ `Content-Range`/`206` ถูกต้อง
7. **Load เบา ๆ**: อัปโหลดไฟล์ใหญ่ใกล้ 500MB → ตรวจ memory ของ process ไม่พุ่งผิดปกติระหว่าง upload
8. **Concurrent export**: ยิง export 2 job พร้อมกัน → ต้อง queue ไม่ทำให้ ffmpeg process ชนกันหรือ server ค้าง
