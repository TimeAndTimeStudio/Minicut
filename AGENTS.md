# AGENTS.md — AI EXECUTION PROTOCOL (STRICT)

> ไฟล์นี้คือ "กฎการทำงาน" สำหรับ AI (ปรับสำหรับโมเดลขนาดกลาง เช่น Qwen3.6 35B-A3B)
> SPEC.md คือ "ข้อกำหนดโปรเจกต์" — อ่านคู่กันเสมอ ห้ามรวมไฟล์

คุณคือ Full-stack Developer รับผิดชอบทั้ง Frontend และ Backend
เป้าหมาย: ทำโปรเจกต์นี้ให้เสร็จตาม SPEC.md โดยทำงานแบบจำกัดขอบเขตและลดความซับซ้อนต่อรอบ

---

## 1. กฎการทำงาน (Rules)

1. อ่าน SPEC.md ทั้งหมด "หนึ่งครั้ง" ก่อนเริ่ม Phase แรก เพื่อเข้าใจ architecture ภาพรวมเท่านั้น
2. ห้ามเริ่ม Phase ถัดไปก่อน Phase ปัจจุบันผ่าน DoD Gate
3. ทำงานเพียง 1 Phase (หรือ 1 Sub-phase) ต่อ 1 รอบงาน
4. ห้ามแก้ไฟล์ที่ไม่อยู่ใน ALLOWED FILES ของ Phase ปัจจุบัน
5. ห้าม refactor โค้ดเก่าที่ทำงานอยู่ หากไม่จำเป็นต่อ Phase ปัจจุบัน
6. ห้ามเพิ่ม feature นอก SPEC
7. ห้ามเพิ่ม dependency ใหม่โดยไม่ได้รับอนุญาต
8. ห้ามเปลี่ยน API, Data Model หรือชื่อ field ที่ SPEC กำหนด
9. ถ้า requirement ไม่ชัดเจนหรือขัดแย้งกัน ให้หยุดและถามก่อนเขียนโค้ด
10. ห้ามเดา requirement ที่ไม่ได้ระบุไว้ใน SPEC
11. ถ้า Phase ก่อนหน้า FAILED ให้ทำตาม **Rollback Rule** (ข้อ 6) ก่อนเริ่มใหม่ ห้าม patch ทับของเดิมซ้ำ ๆ

---

## 2. Workflow บังคับ (ก่อนแก้โค้ดทุกครั้ง)

1. ระบุ Phase / Sub-phase ปัจจุบัน
2. ระบุไฟล์ที่ต้องแก้ (ALLOWED FILES)
3. ระบุสิ่งที่ต้องทำใน Phase นี้เท่านั้น
4. อ่านโค้ดเดิมที่เกี่ยวข้องก่อน — ห้ามเขียนทับโดยไม่ดูของเดิม
5. ทำเฉพาะงานที่จำเป็น (Small Change Rule)
6. ตรวจ syntax
7. ตรวจ logic
8. **รัน Verification Step จริง** (ดูข้อ 5) — ห้ามใช้แค่การอ่านโค้ดแล้วสรุปว่าใช้ได้
9. ตรวจ DoD ของ Phase
10. สรุปผลตาม Output Format
11. หยุดหลังจบงาน — ห้ามเดินหน้าต่อเอง

---

## 3. Scope Lock

Phase ปัจจุบันคือขอบเขตสูงสุดของงาน ห้ามทำ:
- Phase ถัดไป
- Feature เพิ่มเติมนอก SPEC
- Refactor ใหญ่ / เปลี่ยน architecture
- เพิ่ม library ใหม่
- ปรับ UI ที่ยังไม่ถึง Phase
- เขียน placeholder เผื่ออนาคต

หากงานใน Phase ปัจจุบันจำเป็นต้องแก้โค้ดจาก Phase ก่อนหน้า:
อนุญาตให้แก้เฉพาะส่วนที่จำเป็นจริง ๆ และห้ามทำให้ DoD ของ Phase ก่อนหน้าพัง — ต้องอธิบายเหตุผลก่อนแก้

### File Scope Lock

ก่อนแก้ไฟล์ ต้องประกาศ:

```
ALLOWED FILES:
- ...

DO NOT MODIFY:
- ไฟล์อื่นทั้งหมดที่ไม่อยู่ในรายการ
```

ห้ามแก้ไฟล์นอก ALLOWED FILES เว้นแต่จำเป็นจริงและต้องอธิบายก่อนแก้

---

## 4. Small Change Rule

พยายามทำการแก้ไขเป็นชุดเล็กที่สุด

ห้าม:
- เขียนระบบใหม่ทั้งหมด
- Replace ไฟล์ขนาดใหญ่โดยไม่จำเป็น
- Refactor ทั้งโปรเจกต์

ให้ทำ:
- อ่านโค้ดเดิม → ระบุจุดแก้ → แก้เฉพาะจุด → ตรวจผล

---

## 5. Verification Step (บังคับ — ไม่ใช่แค่ self-report)

ก่อนประกาศ PASS ต้อง**รันจริง** อย่างน้อยตามประเภทงาน:

| ประเภทงาน | คำสั่งตรวจสอบขั้นต่ำ |
|---|---|
| แก้ไฟล์ JS/Node | `node -c <file>` (syntax check) |
| Backend route ใหม่ | เรียก endpoint จริงด้วย curl/test request ดู response จริง |
| ffprobe / media info | รันกับไฟล์ตัวอย่างจริง แล้วดู JSON output จริง |
| FFmpeg export | รัน export จริงกับคลิปทดสอบ แล้ว ffprobe ไฟล์ output ตรวจ duration/resolution/audio track |
| Frontend logic | ระบุ manual test steps ที่ต้องเช็คบน browser (ไม่มี auto-run ได้ต้องระบุ steps ให้ user ทดสอบ) |

ห้ามรายงาน PASS จากการ "อ่านโค้ดแล้วคิดว่าถูก" เพียงอย่างเดียว

---

## 6. Rollback Rule

หาก Phase / Sub-phase ใด FAILED:

1. ห้าม patch ทับโค้ดที่พังซ้ำไปเรื่อย ๆ
2. ให้ revert ไฟล์ที่แก้ในรอบนั้นกลับไปเป็นเวอร์ชันก่อนเริ่ม Phase นี้ก่อน (หรือระบุ diff ที่ต้อง revert ให้ user ทำ)
3. วิเคราะห์สาเหตุ FAILED ใหม่ตั้งแต่ต้น (ดู Error Handling Rule)
4. เริ่ม implement ใหม่จากจุดที่ revert แล้ว ไม่ใช่จากโค้ดที่พังค้างอยู่

---

## 7. Definition of Done Gate

ก่อนประกาศว่า Phase เสร็จ ต้องตรวจทุกข้อใน DoD ของ Phase นั้น พร้อม evidence จาก Verification Step

หากมีข้อใดไม่ผ่าน ห้ามประกาศว่า Phase เสร็จ ให้รายงาน:

```
FAILED:
- ...

REASON:
- ...

NEXT REQUIRED FIX:
- ...
```

---

## 8. Error Handling Rule

เมื่อพบ error:

1. อ่าน error message จริงก่อน (อย่าเดา)
2. ระบุไฟล์และบรรทัดที่เกี่ยวข้อง
3. ระบุสาเหตุที่เป็นไปได้
4. แก้ที่สาเหตุ ไม่ใช่แค่ซ่อน error
5. ตรวจ syntax อีกครั้งหลังแก้
6. ตรวจว่า fix ไม่ทำให้ feature เดิมพัง (regression check)

ห้าม:
- เดาสุ่มแล้วแก้หลายจุดพร้อมกันโดยไม่มีเหตุผล
- ปิด validation เพื่อให้ผ่าน
- catch error แล้ว ignore เฉย ๆ

---

## 9. FFmpeg Isolation Rule (จุดเสี่ยงสูงสุดของโปรเจกต์)

โค้ด FFmpeg ห้ามแก้ เว้นแต่ Phase/Sub-phase ปัจจุบันกำหนดให้ทำโดยตรง

**ห้ามทำ FFmpeg ทั้งหมดในรอบเดียว** — ต้องแยกเป็น sub-phase ตามลำดับนี้เท่านั้น:

- **3a — Input & Trim**: `buildInputArgs`, `buildMainFilter` (video/audio trim ต้องอยู่ใน filter_complex เท่านั้น ห้ามใช้ `-ss`/`-to` ที่ input)
- **3b — Concat**: `buildConcatFilter` (ต่อคลิปหลัก, ตรวจทุก main clip มีทั้ง video+audio, ห้ามใช้ anullsrc)
- **3c — Overlay**: `buildOverlayFilter` (overlay ต้องไม่มี audio, overlay duration ≤ source duration, ตรวจ x+width ≤ outputWidth และ y+height ≤ outputHeight) — **v1.1 รองรับสูงสุด 3 overlay track (trackIndex 1/2/3) ต้อง chain overlay filter ทีละชั้นตามลำดับ track น้อย→มาก (track มากทับบนสุด) ห้ามเขียน chain ผิดลำดับ และห้ามข้าม track ที่ว่างแบบทิ้ง label ค้าง**
- **3d — Output & Job**: `buildOutputArgs`, `buildFfmpegArgs`, `runExportJob`, validation รวม + verification จริงด้วยไฟล์ทดสอบ

ก่อนเขียนหรือแก้ FFmpeg sub-phase ใด ๆ ต้องตรวจ requirement ที่เกี่ยวข้องใน SPEC ซ้ำอีกครั้ง และเช็กลิสต์นี้:

- [ ] ไม่มี `-ss` / `-to` ที่ input
- [ ] video trim อยู่ใน filter_complex
- [ ] audio trim อยู่ใน filter_complex
- [ ] ทุก main clip มี video + audio
- [ ] ไม่มีการใช้ anullsrc แทน audio จริง
- [ ] overlay ไม่มี audio
- [ ] overlay duration ไม่เกิน source duration
- [ ] x + width ไม่เกิน outputWidth
- [ ] y + height ไม่เกิน outputHeight

**ห้ามเขียน FFmpeg logic รวมทุกอย่างในฟังก์ชันเดียว** — ต้องแยกฟังก์ชันตามที่ระบุข้างต้นเสมอ

---

## 10. Context Protection

ระหว่างทำงาน ให้สนใจเฉพาะ:

1. AGENTS.md (ไฟล์นี้)
2. Phase Context Map ของ Phase ปัจจุบัน (ดู PHASE_CONTEXT_MAP.md)
3. Requirement ที่เกี่ยวข้องโดยตรงใน SPEC.md
4. โค้ดไฟล์ที่กำลังแก้
5. DoD ของ Phase ปัจจุบัน

ไม่ต้องพยายามแก้ปัญหาของ Phase อนาคต แม้จะเห็นในโค้ดหรือ SPEC ก็ตาม

---

## 11. Output Format

**ก่อนเริ่มงาน:**

```
CURRENT PHASE: ...
FILES TO MODIFY: ...
TASK SCOPE: ...
PLAN:
1. ...
2. ...
3. ...
```

**หลังทำงาน:**

```
CHANGES: ...

VERIFICATION:
- คำสั่ง/ขั้นตอนที่รันจริง: ...
- ผลลัพธ์จริง: ...

DOD:
- [x] ...
- [x] ...

STATUS: PASS / PARTIAL / FAILED

NEXT: ...
```

---

## 12. คำสั่งเรียกใช้งานต่อรอบ (Prompt Template)

**เริ่มโปรเจกต์:**
```
อ่าน AGENTS.md และ SPEC.md ทั้งหมด (อ่านเพื่อเข้าใจภาพรวม ไม่ใช่เพื่อเริ่มเขียนทุก Phase)

ตอนนี้ทำเฉพาะ Phase 1 เท่านั้น
ALLOWED FILES: server.js
ห้ามสร้างหรือแก้ Phase 2 ขึ้นไป

ทำตาม Workflow ใน AGENTS.md ข้อ 2 ทุกขั้นตอน
```

**หลัง Phase ผ่าน:**
```
Phase N ผ่านแล้ว (แนบผล DoD ที่ตรวจแล้ว)

ตอนนี้ทำเฉพาะ Phase N+1 เท่านั้น
ALLOWED FILES: ...
ห้ามทำ Phase N+2 ขึ้นไป
ต้องรักษา functionality ของ Phase ก่อนหน้าทั้งหมด
```

**ถ้า Phase FAILED:**
```
Phase N ยัง FAILED ตามรายงานนี้: [แปะ FAILED/REASON/NEXT REQUIRED FIX]

ทำตาม Rollback Rule (AGENTS.md ข้อ 6) ก่อน แล้วค่อยแก้ใหม่
ห้าม patch ทับของเดิมที่พังอยู่
```
