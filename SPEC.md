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

### Track Model (Multi-track Layer — v1.1)

- Timeline มีทั้งหมดสูงสุด **4 track** ตายตัว: `trackIndex 0, 1, 2, 3`
- **`trackIndex 0` คือ main track เสมอ** — เป็น track เดียวที่ให้เสียง (audio) กับ output, คลิปเรียงต่อกันตามลำดับ (ไม่มีช่องว่าง, ไม่มีการซ้อนเวลากันเองภายใน track เดียวกัน)
- **`trackIndex 1, 2, 3` คือ overlay layer** — วางซ้อนภาพบน main track ได้อิสระ (มี `timelineStart` ของตัวเอง ไม่ต่อกันอัตโนมัติแบบ main)
- **Z-order (ลำดับการซ้อนทับ)**: track เลขมากกว่า = อยู่ "บนสุด" เสมอ กล่าวคือ `trackIndex 3` ทับ `trackIndex 2` ทับ `trackIndex 1` ทับ `trackIndex 0` (base)
- ภายใน overlay track เดียวกัน (เช่น track 1) **ห้าม clip ซ้อนเวลากันเอง** — ถ้า 2 overlay อยู่ track เดียวกันต้องมีช่วงเวลาไม่ทับกัน (validate ใน Section 13) ถ้าต้องการซ้อนเวลากันจริง ให้ผู้ใช้ย้ายไปคนละ track แทน
- จำนวน track ตายตัวที่ 4 (ห้าม dynamic เพิ่ม/ลด track ใน v1.1) — client ส่งเฉพาะ track ที่มีการใช้งานจริงมาได้ (track ที่ไม่มีคลิปเลย = array ว่าง)

### Clip (อ้างอิงไฟล์ต้นฉบับ 1 ไฟล์ — ใช้ได้ทั้ง main และ overlay track)
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
- `trackIndex`: `0` = main track (บังคับ, ต่อกันตามลำดับ timeline), `1|2|3` = overlay layer

### Overlay Clip (ใช้ trackIndex 1, 2 หรือ 3 เท่านั้น)
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
  "height": 180,
  "opacity": 1.0
}
```
- `timelineStart`: วินาทีบน timeline หลักที่ overlay เริ่มปรากฏ
- `x, y, width, height`: หน่วย pixel บน output frame — ต้อง validate `x+width <= outputWidth` และ `y+height <= outputHeight`
- `opacity`: ทศนิยม 0.0–1.0 (default `1.0` ถ้าไม่ส่งมา) — ความโปร่งใสคงที่ตลอดช่วงเวลาที่ overlay แสดงผล **ไม่ใช่ fade in/out** (ดู Section 9 หมายเหตุเรื่อง transition)
- overlay **ไม่มี audio เสมอ** ในทุก track (mute เสมอ ไม่ว่าไฟล์ต้นฉบับจะมีเสียงหรือไม่ — เสียงมาจาก `trackIndex 0` เท่านั้น)

### Timeline
```json
{
  "outputWidth": 1280,
  "outputHeight": 720,
  "fps": 30,
  "mainTrack": [ "<Clip ที่ trackIndex=0 ตามลำดับ>" ],
  "overlayTracks": {
    "1": [ "<Overlay Clip ที่ trackIndex=1>" ],
    "2": [ "<Overlay Clip ที่ trackIndex=2>" ],
    "3": [ "<Overlay Clip ที่ trackIndex=3>" ]
  }
}
```
- `overlayTracks` เป็น object คีย์ตายตัว `"1"`, `"2"`, `"3"` — key ไหนไม่มีคลิปให้ส่ง array ว่าง `[]` (ต้องมีครบ 3 key เสมอ ไม่ omit)

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
    <div id="overlay-track-1" class="track overlay-track" data-track-index="1"></div>
    <div id="overlay-track-2" class="track overlay-track" data-track-index="2"></div>
    <div id="overlay-track-3" class="track overlay-track" data-track-index="3"></div>
  </div>
  <div id="export-status"></div>
</div>
```

- `style.css` กำหนด layout เป็น flex/grid แบ่ง 3 โซนหลัก: preview (บน), media library (ซ้าย/ขวา), timeline (ล่าง)
- Timeline panel มี **4 track แถวตายตัว**: `main-track` (บนสุดของ panel แสดงเป็นแถวหลัก) + `overlay-track-1/2/3` เรียงถัดไป — แถว overlay ที่เลขมากกว่าควรวางแสดงผลใกล้ "ด้านบนภาพ" ให้ผู้ใช้เข้าใจ z-order (แนะนำ: เรียง track 3 ไว้แถวบนสุดของ timeline UI, main track ไว้ล่างสุด เพื่อสื่อว่า track บนซ้อนทับ track ล่างจริง แต่ยึด `trackIndex` เป็น source of truth ไม่ใช่ตำแหน่ง UI)
- ไม่มี add/remove track button ใน v1.1 (จำนวน track ตายตัวที่ 4 เสมอ)
- responsive ไม่จำเป็นสำหรับ mobile — ออกแบบสำหรับ desktop เท่านั้น
- ไม่ต้องมี framework CSS ภายนอก ใช้ CSS ธรรมดา

**Phase 4 ทำแค่โครง HTML/CSS นี้ ห้ามใส่ JS logic ใด ๆ ใน index.html (script tag แค่โหลด editor.js)**

---

## Section 8 — Canvas Compositing (พรีวิว ไม่ใช่ export จริง)

- Canvas ขนาดเท่า `outputWidth x outputHeight` ของ timeline
- วาด main track (trackIndex 0) clip ที่ตำแหน่ง playhead ปัจจุบันด้วย `drawImage` จาก `<video>` element ที่ซ่อนไว้ (hidden video elements ต่อ media หนึ่งตัว) — วาดเป็นชั้นล่างสุดเสมอ
- วาด overlay tracks ทับด้านบนตามลำดับ **trackIndex น้อย → มาก** (วาด track 1 ก่อน, แล้ว track 2 ทับ, แล้ว track 3 ทับบนสุด) เพื่อให้ z-order บน canvas ตรงกับ output จริงที่ export ออกมา (ดู Section 9 chained overlay)
- แต่ละ overlay clip วาดโดยตั้ง `ctx.globalAlpha = clip.opacity` ก่อน `drawImage` แล้วรีเซ็ต `globalAlpha = 1.0` หลังวาดเสร็จ เพื่อไม่ให้กระทบ clip อื่น
- แต่ละ overlay clip วาดเฉพาะเมื่อ playhead อยู่ในช่วง `timelineStart` ถึง `timelineStart + (sourceOut-sourceIn)` ของ track นั้น (ตัดตรงทันที ไม่มี fade ตอนเข้า/ออกช่วงเวลา — พรีวิวต้องสอดคล้องกับ export จริงตาม Section 9 ข้อ 10)
- นี่คือ **preview เท่านั้น** ไม่ใช่การ render จริง — ความแม่นยำ frame-level ไม่จำเป็นเท่า export
- Playhead scrubbing: ลาก playhead บน timeline panel → sync เวลาของ hidden `<video>` elements ที่เกี่ยวข้อง → redraw canvas

---

## Section 9 — Overlay Rules (สำคัญ — จุดเสี่ยงสูง, v1.1 multi-layer)

1. overlay **ต้องไม่มี audio ใน output เสมอ** ไม่ว่าไฟล์ต้นฉบับจะมีเสียงหรือไม่ (mute โดยไม่ map audio stream ของ overlay เข้า output เลย ทุก track 1/2/3)
2. `overlay.timelineStart + (sourceOut - sourceIn)` ต้องไม่เกินความยาว timeline รวม (ความยาวรวมของ `mainTrack`)
3. `sourceOut - sourceIn` ของ overlay ต้องไม่เกิน duration จริงของไฟล์ต้นฉบับ (ต้องเช็กกับ ffprobe metadata)
4. `x + width <= outputWidth` และ `y + height <= outputHeight` เสมอ — reject job ถ้าไม่ผ่าน (เช็กทุก overlay clip ทุก track)
5. **จำนวน track ตายตัวที่ 4**: `trackIndex` ต้องเป็น `0, 1, 2, 3` เท่านั้น — reject ถ้า client ส่ง `trackIndex >= 4` หรือติดลบ
6. **Z-order**: เลข track มากกว่า = อยู่บนสุดเสมอ (`3` ทับ `2` ทับ `1` ทับ `0`) — ลำดับนี้ตายตัว ไม่มี custom z-index ต่อ clip
7. ภายใน track เดียวกัน (1, 2 หรือ 3) overlay clip **ห้ามช่วงเวลาทับกันเอง** — validate ว่า `[timelineStart, timelineStart+duration)` ของแต่ละ clip ใน track เดียวกันไม่ overlap กัน (reject job พร้อมระบุ clip ที่ชนกันถ้าไม่ผ่าน)
8. Track ที่ไม่มีคลิปเลย (array ว่าง) ให้ข้าม ไม่ต้องสร้าง filter chain สำหรับ track นั้น
9. **Opacity**: `opacity` ต้องเป็นทศนิยม `0.0–1.0` เท่านั้น — reject job ถ้านอกช่วงนี้ ค่าคงที่ตลอดช่วงเวลาที่ overlay แสดงผล (ไม่มี fade)
10. **ไม่มี transition/fade ใด ๆ**: เมื่อ overlay เข้า/ออกจากช่วงเวลาที่กำหนด (`timelineStart` และจุดจบ) ให้ **ตัดตรง (hard cut)** เท่านั้น ไม่ implement fade-in/fade-out หรือ cross-dissolve ใน v1.1 — รวมถึงกรณี overlay 2 track ที่ช่วงเวลาทับกันพอดี ก็ไม่มี transition ระหว่างกัน แต่ละ track render อิสระแล้วซ้อนทับกันตาม z-order + opacity ของตัวเองเท่านั้น

### `buildOverlayFilter` — Chained Overlay Filter Graph (Phase 3c)

FFmpeg `overlay` filter รับ 2 input ต่อครั้ง (base + 1 layer) เพราะฉะนั้น overlay หลาย track ต้อง **chain ต่อกันทีละชั้น** ไล่จาก track เลขน้อยไปมาก (track น้อยกว่า = ใกล้ base มากกว่า, track มากกว่า = ทับบนสุด):

```
[ov1]format=rgba,colorchannelmixer=aa={opacity1}[ov1a]
[ov2]format=rgba,colorchannelmixer=aa={opacity2}[ov2a]
[ov3]format=rgba,colorchannelmixer=aa={opacity3}[ov3a]

[outv_from_concat][ov1a]overlay=enable='between(t,{start1},{end1})':x={x1}:y={y1}[tmp1]
[tmp1][ov2a]overlay=enable='between(t,{start2},{end2})':x={x2}:y={y2}[tmp2]
[tmp2][ov3a]overlay=enable='between(t,{start3},{end3})':x={x3}:y={y3}[outv_final]
```

- ก่อนเข้า `overlay` filter แต่ละ layer ต้องผ่าน `format=rgba,colorchannelmixer=aa={opacity}` เพื่อคุม opacity คงที่ (ถ้า `opacity=1.0` ก็ยังใส่ step นี้ได้ปกติ ไม่ต้องข้าม เพื่อความสม่ำเสมอของโค้ด)
- `ov1/ov2/ov3` คือ label ของ overlay clip แต่ละตัวหลังผ่าน trim/scale ของตัวเอง (ทำเหมือน main clip: `trim`/`setpts` ใน filter_complex ห้าม `-ss`/`-to`)
- ถ้า track นั้นมีหลาย overlay clip เรียงตามเวลา (ไม่ทับกัน ตามกฎข้อ 7) ให้ chain overlay ภายใน track เดียวกันต่อกันไปเรื่อย ๆ ก่อนส่งต่อไป track ถัดไป (แต่ละ clip ใน track เดียวกันใช้ `enable='between(t,start,end)'` และ opacity ของตัวเอง)
- ถ้า track ใดว่าง → ข้าม step ของ track นั้น (ทั้ง format/colorchannelmixer และ overlay) ต่อ label จาก step ก่อนหน้าไปยัง step ถัดไปตรง ๆ (เช่นไม่มี track 2 → ต่อจาก `[tmp1]` ไปที่ `overlay` ของ track 3 ได้เลย ไม่ต้องมี `[tmp2]`)
- ผลลัพธ์สุดท้ายของ chain นี้คือ label ที่ใช้ map เข้า output วิดีโอ (แทน label จาก concat ตรง ๆ ถ้ามี overlay อย่างน้อย 1 track ที่ไม่ว่าง)
- **จุดเสี่ยงสูงสุด**: ยิ่ง chain ยาว (3 layer + opacity step) ยิ่งต้องระวังชื่อ label ชนกัน/หลุดลำดับ, และ `format=rgba` เปลี่ยน pixel format ของ overlay stream ต้องตรวจว่า `overlay` filter รับ input แบบนี้ได้โดยไม่ error ก่อน chain ทั้ง 3 ชั้น — แนะนำให้ตรวจสอบ label mapping ด้วย log ก่อนส่ง args จริงเข้า ffmpeg

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
- ทุก overlay ผ่านกฎ Section 9 ครบทุกข้อ (รวม track count ≤ 4, ไม่มี trackIndex ติดลบหรือ ≥ 4, ไม่มี overlay ทับเวลากันเองใน track เดียวกัน)
- `timeline.overlayTracks` ต้องมี key `"1"`, `"2"`, `"3"` ครบ (array ว่างได้ แต่ห้าม missing key)
- `outputWidth`, `outputHeight` เป็นเลขบวก, เป็นเลขคู่ (ffmpeg libx264 ต้องการ even dimension)
- ทุก overlay clip: `opacity` ต้องอยู่ในช่วง `0.0–1.0` (ถ้า field หายไปให้ default เป็น `1.0` แทนการ reject)
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
- **Drag overlay clip บน overlay track (1/2/3)**: ลากซ้าย/ขวาเพื่อเปลี่ยน `timelineStart` (ไม่ reorder แบบ main track เพราะ overlay ไม่ต่อกันอัตโนมัติ) — ก่อนวางต้อง validate ว่าไม่ทับเวลากับ clip อื่นใน track เดียวกัน (Section 9 ข้อ 7) ถ้าทับให้ snap กลับตำแหน่งเดิมหรือ reject การวาง
- **ย้าย overlay clip ข้าม track (เช่นจาก track 1 → track 2)**: ลากขึ้น/ลงข้ามแถว track ใน timeline UI → อัปเดต `trackIndex` ของ clip นั้น → validate ตำแหน่งเวลาใน track ปลายทางว่าไม่ทับกับ clip อื่นก่อนยืนยัน (ห้ามย้ายเข้า/ออกจาก main track เลขที่ 0 — main track รับได้เฉพาะ clip ประเภท main เท่านั้น)
- **ปรับ opacity ของ overlay**: เลือก overlay clip บน timeline → properties panel แสดง slider `opacity` (ช่วง 0–100%, step ละเอียดพอสมควรเช่น 1%) → ลาก slider อัปเดตค่า `clip.opacity` (0.0–1.0) แบบ real-time → re-render canvas preview ทันทีด้วยค่าที่ปรับ (ไม่มี animate ค่า ใช้ค่าเดียวคงที่ตลอด clip นั้น)
- ทุก interaction ต้อง re-render preview canvas (Section 8) ทันทีหลัง state เปลี่ยน โดยวาดตามลำดับ z-order (track น้อย→มาก)
- Pixel-to-second ratio: กำหนดจาก `timelineWidthPx / totalDurationSeconds` ปรับได้ด้วย zoom control (ใช้ ratio เดียวกันทั้ง 4 track เพื่อให้ clip แนวตั้งตรงกันตามเวลาจริง)

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
- [ ] Export พร้อม overlay 1 track ได้ผลลัพธ์ที่ overlay อยู่ตำแหน่งและช่วงเวลาที่ถูกต้อง ไม่มีเสียงจาก overlay
- [ ] Export พร้อม overlay **2-3 track พร้อมกัน** ได้ z-order ถูกต้อง (track เลขมากทับเลขน้อยจริง) — ตรวจด้วยตาจากไฟล์ output จริง
- [ ] Export overlay ที่ตั้ง `opacity` ต่ำกว่า 1.0 (เช่น 0.5) ได้ภาพโปร่งใสจริงในไฟล์ output ตามที่กำหนด
- [ ] Validation (Section 13) reject request ที่ผิดกฎได้ครบทุกข้อ (รวม track count เกิน 4, overlay ทับเวลากันเอง) พร้อม error message ชัดเจน
- [ ] `/api/export/:jobId/status` รายงาน progress ที่สมเหตุสมผล (ไม่ค้างที่ 0 จนจบ)
- [ ] `/api/export/:jobId/download` รองรับ Range request

### Phase 4 DoD
- [ ] timeline panel แสดง 4 track แถว (main-track + overlay-track-1/2/3) ครบตาม Section 7
- [ ] Layout ตรงตาม Section 7 แสดงผลถูกต้องบน browser (desktop)
- [ ] ไม่มี JS logic ใด ๆ ทำงานอยู่ (เป็น static UI ล้วน)

### Phase 5 DoD
- [ ] Drag reorder clip บน main track ทำงานได้จริงบน browser
- [ ] Resize (trim) clip ทำงานได้จริง ค่า sourceIn/sourceOut อัปเดตถูกต้อง
- [ ] Split clip ที่ตำแหน่ง playhead ทำงานถูกต้อง
- [ ] เพิ่ม/ลาก overlay clip บน track 1, 2, 3 ได้จริง และ validate ไม่ให้ทับเวลากันเองใน track เดียวกัน
- [ ] ย้าย overlay clip ข้าม track (เช่น track 1 → 2) ได้จริง โดยไม่ให้ย้ายเข้า main track
- [ ] ปรับ opacity ของ overlay clip ผ่าน slider ได้จริง และ preview บน canvas อัปเดตทันที
- [ ] Canvas preview sync กับ timeline state และ playhead ถูกต้อง วาด z-order ตามลำดับ track (น้อย→มาก) ตรงกับที่จะ export จริง
- [ ] ส่ง timeline ที่แก้ไขแล้วไป export ได้ผลลัพธ์ตรงกับที่เห็นใน preview

### Phase 6 DoD
- [ ] ทุก scenario ใน Section 19 ผ่านจริง
- [ ] ไม่มี regression กับ Phase 1-5

---

## Section 19 — Integration Testing Plan (Phase 6)

1. **Happy path เต็มระบบ**: upload 2 คลิป → trim ทั้งคู่ → split คลิปแรก → reorder → เพิ่ม overlay → export → download → เล่นไฟล์ผลลัพธ์ตรวจด้วยตาจริง
2. **Edge case: คลิปเดียวไม่ trim**: upload 1 คลิป → export ตรง ๆ โดยไม่แก้ไข → output ต้องเหมือนต้นฉบับ (duration/resolution)
3. **Edge case: overlay เต็มความยาว timeline**: overlay ที่ `timelineStart=0` และยาวเท่า main track ทั้งหมด
3b. **Edge case: multi-layer overlay**: วาง overlay 3 ตัวพร้อมกันคนละ track (1, 2, 3) ในช่วงเวลาซ้อนกันบางส่วน → export → ตรวจ z-order ว่า track 3 ทับ track 2 ทับ track 1 ทับ main จริง
3c. **Edge case: overlay ทับเวลากันเองใน track เดียวกัน**: ส่ง 2 overlay clip ใน track เดียวกันที่เวลาทับกัน → ต้องถูก reject ด้วย 400 พร้อมระบุ clip ที่ชนกัน
3d. **Edge case: opacity + hard cut**: overlay 2 track ตั้ง `opacity` ต่างกัน (เช่น 1.0 และ 0.5) ในช่วงเวลาทับกันบางส่วน → export → ตรวจว่าความโปร่งใสตรงตามค่าที่ตั้ง และไม่มี fade transition ตอนเข้า/ออกช่วงเวลา (ตัดตรงทันที)
4. **Edge case: validation reject**: ส่ง timeline ที่มี overlay เกิน bounds → ต้องได้ 400 พร้อม error ชัดเจน ไม่ crash server
5. **Edge case: ไฟล์ไม่มีเสียง**: upload ไฟล์ video-only เป็น main clip → ต้องถูก reject ตั้งแต่ validation ไม่ใช่ error ตอน ffmpeg รัน
6. **Range request**: ขอ partial content ของทั้งไฟล์ต้นฉบับและไฟล์ export ด้วย curl `-r 0-1023` → ตรวจ `Content-Range`/`206` ถูกต้อง
7. **Load เบา ๆ**: อัปโหลดไฟล์ใหญ่ใกล้ 500MB → ตรวจ memory ของ process ไม่พุ่งผิดปกติระหว่าง upload
8. **Concurrent export**: ยิง export 2 job พร้อมกัน → ต้อง queue ไม่ทำให้ ffmpeg process ชนกันหรือ server ค้าง
