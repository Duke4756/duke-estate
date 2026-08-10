// One-time Facebook login → saves a reusable session (cookies) to disk.
//
//   npm run login
//
// A real Chrome window opens. Log in with your BACKUP Facebook account
// (handle 2FA / any checkpoint manually), make sure you can see your feed,
// then come back to the terminal and press ENTER. The session is saved to
// server/fb-session.json and reused by the scraper — you won't need to log
// in again until Facebook expires the session.

import readline from 'node:readline'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchBrowser } from './browserLauncher.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SESSION_PATH = process.env.FB_SESSION_PATH || path.join(__dirname, 'fb-session.json')

function waitForEnter(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  return new Promise((resolve) => rl.question(question, () => { rl.close(); resolve() }))
}

const run = async () => {
  console.log('\n  เปิดเบราว์เซอร์... กรุณา login ด้วย "บัญชีสำรอง" ของคุณ\n')
  const browser = await launchBrowser({ headless: false })
  const context = await browser.newContext({
    ...(fs.existsSync(SESSION_PATH) ? { storageState: SESSION_PATH } : {}),
    viewport: { width: 1280, height: 900 },
    locale: 'th-TH',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  })
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
    Object.defineProperty(navigator, 'languages', { get: () => ['th-TH', 'th', 'en'] })
  })
  const page = await context.newPage()
  // The dedicated /login page currently omits QR login. Facebook exposes its
  // QR entry point in the login banner rendered over a public group instead.
  await page.goto('https://web.facebook.com/groups/519346030556100/', {
    waitUntil: 'domcontentloaded',
  })

  // Facebook now offers QR login on some layouts. Open it automatically when
  // available; the normal email/password form remains the fallback.
  const qrLogin = page.getByRole('button', {
    name: /เข้าสู่ระบบด้วยคิวอาร์โค้ด|เข้าสู่ระบบด้วย QR|log in with (a )?qr code/i,
  })
  try {
    await qrLogin.first().click({ timeout: 5000 })
    console.log('  📱 เปิด QR Code แล้ว — สแกนด้วยแอป Facebook บนมือถือ')
  } catch {
    console.log('  ℹ️ หน้านี้ไม่มีตัวเลือก QR Code — ใช้ email/เบอร์โทรและรหัสผ่านแทน')
  }

  console.log('  👉 1) Login ในหน้าต่างที่เปิดขึ้น (สแกน QR หรือใช้รหัสผ่าน)')
  console.log('  👉 2) ตรวจให้แน่ใจว่าเห็นหน้า feed แล้ว')
  console.log('  👉 3) กลับมาที่นี่แล้วกด ENTER เพื่อบันทึก session\n')

  await waitForEnter('  >> กด ENTER เมื่อ login เสร็จแล้ว... ')

  // Do not overwrite a previously working session when Enter is pressed before
  // login/2FA is actually complete.
  const cookies = await context.cookies()
  const hasFacebookUser = cookies.some(
    (cookie) => cookie.name === 'c_user' && /(^|\.)facebook\.com$/i.test(cookie.domain),
  )
  if (!hasFacebookUser || /\/login|\/checkpoint|\/recover/i.test(page.url())) {
    throw new Error('ยังเข้าสู่ระบบ Facebook ไม่สำเร็จ — กรุณา login/ผ่าน checkpoint ให้เรียบร้อยก่อนกด ENTER')
  }

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
