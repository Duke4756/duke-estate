# 🏠 Condo Lead Finder

เว็บแอป React + Tailwind ที่ **ดึงโพสต์จากกลุ่ม Facebook เอง (Local Playwright)** แล้วใช้
**Gemini AI / Keyword** คัดกรองว่าใครคือ **"คนกำลังหาห้องเช่า" (renter)** — แยกออกจากเจ้าของ/นายหน้า/คนขาย
พร้อมดึง ทำเล / งบ / เบอร์ติดต่อ ให้อัตโนมัติ

---

## 📋 ต้องมีก่อน (ครั้งเดียว)
- **Node.js 18 ขึ้นไป** (แนะนำ 20+) — เช็คด้วย `node -v`
- **บัญชี Facebook สำรอง** (ห้ามใช้บัญชีหลัก — ดูคำเตือนท้ายไฟล์) ที่เป็นสมาชิกกลุ่มที่จะดึง
- (ไม่บังคับ) **Gemini API Key** ฟรีจาก https://aistudio.google.com/app/apikey — ไม่มีก็ใช้โหมด Keyword ได้

---

## 🚀 ติดตั้งครั้งแรก (หลัง `git clone` / pull มาใหม่)

รันทีละคำสั่งในโฟลเดอร์โปรเจกต์ (`E:\Duke-Estate`):

```bash
# 1) ติดตั้ง dependencies
npm install

# 2) โหลดเบราว์เซอร์ให้ Playwright (ครั้งเดียว)
npx playwright install chromium

# 3) สร้างไฟล์ตั้งค่า แล้วใส่ Gemini API Key (เปิด .env แก้บรรทัด GEMINI_API_KEY=)
cp .env.example .env

# 4) Login Facebook ครั้งเดียว (เซฟ session ไว้ใช้ยาว)
npm run login
```

**ตอนรัน `npm run login`:** เบราว์เซอร์จะเปิดขึ้น → login ด้วยบัญชีสำรอง (ทำ 2FA ได้) →
เห็นหน้า feed แล้ว → กลับมาที่ terminal **กด ENTER** → session ถูกเซฟที่ `server/fb-session.json`

> เสร็จ 4 ข้อนี้ครั้งเดียวพอ ไม่ต้องทำซ้ำทุกวัน

---

## 🔁 ใช้งานประจำวัน (เปิดคอมวันใหม่)

แค่คำสั่งเดียว:

```bash
npm run dev
```

แล้วเปิดเบราว์เซอร์ที่ **http://localhost:5173**

- โหลดครั้งแรกจะ **scrape ~2-3 นาที** (ดึงทุกกลุ่ม + อ่านเวลาโพสต์) จากนั้น cache ทำให้เร็ว
- มุมขวาบนขึ้น **● Live (Facebook)** = ใช้งานได้ปกติ
- กด `Ctrl + C` ใน terminal เพื่อปิด

**ถ้าเปิดมาแล้วขึ้น `● Demo` หรือดึงไม่ได้** = session Facebook หมดอายุ → login ใหม่ครั้งเดียว:
```bash
npm run login    # แล้วรัน npm run dev ต่อ
```

---

## 🖥️ การใช้งานในหน้าเว็บ
- **ช่วงเวลา**: เลือก 1 / 3 / 6 / 12 ชม. (ดึงโพสต์ย้อนหลังตามที่เลือก)
- **โหมดคัดกรอง**: `⚡ Keyword` (เร็ว ไม่ใช้ AI) หรือ `🤖 AI` (Gemini แม่นกว่า)
- **⚙️ กลุ่ม**: เพิ่ม/ลบกลุ่ม Facebook ที่มอนิเตอร์ (บันทึกอัตโนมัติที่ `server/groups.json`)
- **ดึงโพสต์ล่าสุด**: บังคับ scrape ใหม่ (ไม่ใช้ cache)

---

## ⚠️ คำเตือนสำคัญ
- **ห้ามใช้บัญชี Facebook หลัก** — automation เสี่ยงโดนล็อก/แบนถาวร ใช้**บัญชีสำรอง**เท่านั้น
- การ scrape ขัด ToS ของ Facebook — รับความเสี่ยงเอง ใช้กับข้อมูลสาธารณะ เคารพ PDPA
- กลุ่มที่จะดึง บัญชีที่ login ต้องเป็น**สมาชิก**ก่อน

---

## 🧩 โครงสร้างโปรเจกต์
| ไฟล์ | หน้าที่ |
|------|---------|
| `src/` | หน้าเว็บ React + Tailwind |
| `server/index.js` | API + คัดกรอง (Keyword / Gemini) + cache |
| `server/scraper.js` | ดึงโพสต์จาก FB ด้วย Playwright |
| `server/login.js` | เซฟ session Facebook (`npm run login`) |
| `server/groups.js` + `groups.json` | รายการกลุ่มที่แก้ผ่านปุ่ม ⚙️ กลุ่ม |
| `.env` | Gemini key + ค่าตั้งต้น (ไม่ถูก commit) |

## ⚙️ ตัวเลือกเสริม (ใน `.env`)
| ตัวแปร | ความหมาย |
|--------|----------|
| `GEMINI_API_KEY` | key สำหรับโหมด AI |
| `FB_GROUP_URLS` | กลุ่มตั้งต้น (คั่นด้วย `,`) — ปกติแก้ผ่านปุ่ม ⚙️ กลุ่ม แทน |
| `HEADLESS=false` | เปิดให้เห็นเบราว์เซอร์ตอน scrape (ดีบั๊ก) |
| `DEBUG_SCRAPER=1` | เซฟ screenshot + html ลง `scratch-debug/` ไว้จูน selector |

## 🩹 แก้ปัญหาเบื้องต้น
- **ดึงได้ 0 โพสต์ / น้อยผิดปกติ**: FB เปลี่ยน layout — รัน `DEBUG_SCRAPER=1 HEADLESS=false npm run scrape:test 60` แล้วดู `scratch-debug/` เพื่อจูน selector ใน `server/scraper.js`
- **พอร์ตชน (EADDRINUSE 8787/5173)**: มี process เดิมค้าง — ปิดให้หมดก่อนรัน `npm run dev` ใหม่
- **ทดสอบ scraper อย่างเดียว**: `npm run scrape:test 60` (ดึง 60 นาทีล่าสุดแล้วพิมพ์ผล)
