# PHASE CONTEXT MAP

> ใช้คู่กับ AGENTS.md — ระบุว่าแต่ละ Phase ต้องอ่าน Section ไหนของ SPEC.md, แก้ไฟล์ไหน,
> และห้ามแตะอะไร เพื่อจำกัด context ที่ AI ต้อง "ใช้งานจริง" ต่อรอบ

---

## Phase 1 — Base Server

READ:
- Section 0 (Overview)
- Section 1 (Project Structure)
- Section 2 (Base Server Setup)
- Section 18 → Phase 1 DoD

MODIFY:
- server.js

IGNORE FOR NOW:
- upload / multipart
- ffprobe
- ffmpeg export
- frontend editor

VERIFY:
- `node -c server.js`
- server start ได้จริง, route พื้นฐาน response ถูกต้อง

---

## Phase 2 — Upload & Media Info

READ:
- Section 0, Section 1, Section 2
- Section 12 (Upload Handling)
- Section 14 (Media Info / ffprobe)
- Section 15 → upload routes เท่านั้น
- Section 18 → Phase 2 DoD

MODIFY:
- server.js

PRESERVE:
- Phase 1 functionality ทั้งหมด

VERIFY:
- อัปโหลดไฟล์ทดสอบจริง → เช็ก response
- รัน ffprobe จริงกับไฟล์ทดสอบ → เช็ก JSON output
- ทดสอบ Range request จริงด้วย curl (`curl -r`)

---

## Phase 3 — Export Pipeline (แตกเป็น Sub-phase ตาม FFmpeg Isolation Rule)

### Phase 3a — Input & Main Trim
READ: Section 5, Section 17 (เฉพาะจุดเสี่ยงเรื่อง input/trim), Section 18 → Phase 3 DoD (เฉพาะข้อ trim)
MODIFY: server.js
TASK: `buildInputArgs`, `buildMainFilter`
VERIFY: export คลิปสั้น 1 ตัวจริง → ffprobe ตรวจ duration ตรงกับที่ trim

### Phase 3b — Concat
READ: Section 6, Section 3 (Data Model), Section 18 → Phase 3 DoD (เฉพาะข้อ concat)
MODIFY: server.js
TASK: `buildConcatFilter`
VERIFY: ต่อ 2-3 คลิปทดสอบจริง → ffprobe ตรวจว่าทุก segment มี video+audio ต่อเนื่อง ไม่มี anullsrc

### Phase 3c — Overlay
READ: Section 9 (Overlay Rules), Section 17
MODIFY: server.js
TASK: `buildOverlayFilter`
VERIFY: export พร้อม overlay ทดสอบจริง → เช็ก geometry (x+width ≤ outputWidth, y+height ≤ outputHeight), เช็กว่า overlay track ไม่มี audio

### Phase 3d — Output & Job Runner
READ: Section 10, Section 11, Section 13, Section 15 → export routes, Section 18 → Phase 3 DoD (ที่เหลือทั้งหมด)
MODIFY: server.js
TASK: `buildOutputArgs`, `buildFfmpegArgs`, `runExportJob`, validation รวม
VERIFY: export end-to-end จริงอย่างน้อย 1 job เต็มรูปแบบ → ffprobe output ไฟล์สุดท้าย

HIGH RISK ทั้ง Phase 3a-3d:
- FFmpeg filter_complex syntax
- audio/video sync
- overlay geometry & duration
- validation ที่ SPEC Section 13/17 กำหนด

---

## Phase 4 — Frontend Layout (Static)

READ:
- Section 7 (UI Layout)
- Section 18 → Phase 4 DoD

MODIFY:
- public/index.html
- public/style.css

DO NOT:
- implement editor logic ใด ๆ (Phase 5)

VERIFY:
- เปิดหน้าเว็บใน browser จริง → screenshot/บรรยาย layout ที่เห็น

---

## Phase 5 — Editor Interaction Logic

READ:
- Section 3 (Data Model)
- Section 4 (Timeline Model)
- Section 7 (UI Layout — อ้างอิงเท่านั้น)
- Section 8 (Canvas Compositing)
- Section 15 (API ที่เกี่ยวข้องกับ editor)
- Section 16 (Drag/Resize/Split/Reorder)
- Section 18 → Phase 5 DoD

MODIFY:
- public/editor.js
- แก้ HTML/CSS ได้เฉพาะจุดเล็ก ๆ ที่จำเป็นจริง (ต้องอธิบายก่อน)

HIGH RISK:
- canvas preview sync กับ timeline data
- split / reorder logic
- drag & resize coordinate calculation

VERIFY:
- manual test steps ที่ต้องให้ user ทำจริงบน browser (ระบุ steps ชัดเจนในรายงาน)

---

## Phase 6 — Integration Testing & Bug Fix

READ:
- Section 19 (Integration Testing Plan)
- Section 18 (DoD ทุก Phase — ใช้ตรวจซ้ำ)

TASK:
- integration testing ตาม Section 19
- bug fixes เท่านั้น

DO NOT:
- เพิ่ม feature ใหม่
- redesign architecture
- refactor ใหญ่

VERIFY:
- รัน end-to-end scenario ทั้งหมดใน Section 19 จริง แล้วรายงานผลทีละ scenario
