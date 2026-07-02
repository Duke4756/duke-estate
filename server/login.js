// One-time Facebook login → saves a reusable session (cookies) to disk.
//
//   npm run login
//
// A real Chrome window opens. Log in with your BACKUP Facebook account
// (handle 2FA / any checkpoint manually), make sure you can see your feed,
// then come back to the terminal and press ENTER. The session is saved to
// server/fb-session.json and reused by the scraper — you won't need to log
// in again until Facebook expires the session.

import { chromium } from 'playwright'
import readline from 'node:readline'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SESSION_PATH = process.env.FB_SESSION_PATH || path.join(__dirname, 'fb-session.json')

function waitForEnter(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  return new Promise((resolve) => rl.question(question, () => { rl.close(); resolve() }))
}

const run = async () => {
  console.log('\n  เปิดเบราว์เซอร์... กรุณา login ด้วย "บัญชีสำรอง" ของคุณ\n')
  const browser = await chromium.launch({ headless: false })
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    locale: 'th-TH',
  })
  const page = await context.newPage()
  await page.goto('https://www.facebook.com/login', { waitUntil: 'domcontentloaded' })

  console.log('  👉 1) Login ในหน้าต่างที่เปิดขึ้น (รวม 2FA ถ้ามี)')
  console.log('  👉 2) ตรวจให้แน่ใจว่าเห็นหน้า feed แล้ว')
  console.log('  👉 3) กลับมาที่นี่แล้วกด ENTER เพื่อบันทึก session\n')

  await waitForEnter('  >> กด ENTER เมื่อ login เสร็จแล้ว... ')

  await context.storageState({ path: SESSION_PATH })
  await browser.close()
  console.log(`\n  ✅ บันทึก session แล้วที่: ${SESSION_PATH}`)
  console.log('     ตอนนี้รัน "npm run dev" ได้เลย — scraper จะใช้ session นี้\n')
  process.exit(0)
}

run().catch((e) => {
  console.error('  ❌ login ล้มเหลว:', e.message)
  process.exit(1)
})
