# Source Intelligence

ระบบนี้ต่อยอด crawler เดิม โดย `raw_posts` ยังเป็นหลักฐานต้นทางและถูกบันทึกก่อนงาน extraction เสมอ

## สถานะ Source

- `DISCOVERED`: พบ URL แล้ว แต่ scheduler ห้าม crawl
- `PENDING_ACCESS`: รอการตรวจสิทธิ์/การเข้าถึง
- `AUTHORIZED` + `ACCESSIBLE` + `ACTIVE`: scheduler เลือกทำงานได้
- `PAUSED`, `INACCESSIBLE`, `ERROR`, `ARCHIVED`: scheduler ข้าม

รายชื่อกลุ่มเดิมถูก import เป็น authorized เพื่อรักษาพฤติกรรมเดิม ส่วน candidate จาก API หรือ visible DOM เริ่มที่ `DISCOVERED`

## API หลัก

- `GET /api/sources` — registry, metrics และสถานะ Autopilot
- `POST /api/sources/candidates` — เพิ่ม URL หนึ่งกลุ่ม (ยังไม่อนุญาตให้ crawl)
- `POST /api/sources/import` — import JSON array, JSON Lines หรือ `url,name` หลายบรรทัด
- `POST /api/sources/discover-visible` — รับ group cards จาก visible DOM ที่ผู้ใช้เปิด
- `PUT /api/sources/:id/authorization` — ยืนยันสิทธิ์และ access
- `POST /api/sources/autopilot/start|stop` — Freshness Lane
- `POST /api/sources/backfill/start|stop` — Backfill Lane
- `GET /api/sources/coverage` — heuristic coverage พร้อม disclaimer/uncertainty
- `GET /api/raw-posts/:id` — raw evidence, versions และ processing history

หน้า Settings มี Source Registry, ปุ่ม Autopilot/Backfill, สรุป coverage และการยืนยันสิทธิ์ ไม่มีการ auto-join หรือ bypass access control

## การจัดลำดับ

Adaptive priority ใช้ unique-listing yield, owner-lead yield, change/freshness, coverage gap, reliability และ exploration bonus หัก collection cost, duplicate rate และ failure rate กลุ่มใหม่จึงยังได้ทดลอง แต่ source เดียวไม่สามารถกิน concurrency budget ทั้งหมด

Freshness jobs ถูก claim ก่อน Backfill เสมอ งานมี persistent checkpoint, idempotency key, lock, retry/backoff และ stale-lock recovery การหยุด lane ยกเลิกเฉพาะงานที่ยังไม่เริ่ม; raw posts ที่ commit แล้วไม่ถูกย้อนลบ
