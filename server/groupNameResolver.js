import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchBrowser } from './browserLauncher.js'

const SESSION_PATH = process.env.FB_SESSION_PATH || path.join(path.dirname(fileURLToPath(import.meta.url)), 'fb-session.json')

function parseMemberCount(value) {
  const match = String(value || '').match(/([\d,.]+)\s*(แสน|หมื่น|พัน|ล้าน|k|m)?/iu)
  if (!match) return null
  const number = Number(match[1].replace(/,/g, ''))
  const unit = String(match[2] || '').toLowerCase()
  const multiplier = unit === 'แสน' ? 100_000 : unit === 'หมื่น' ? 10_000 : unit === 'พัน' ? 1_000 : unit === 'ล้าน' || unit === 'm' ? 1_000_000 : unit === 'k' ? 1_000 : 1
  return Number.isFinite(number) ? Math.round(number * multiplier) : null
}

export async function resolveFacebookGroupNames(urls = []) {
  const browser = await launchBrowser({ headless: true })
  const context = await browser.newContext(fs.existsSync(SESSION_PATH) ? { storageState: SESSION_PATH } : {})
  const resolved = []
  try {
    const targets = [...new Set(urls.map((value) => String(value).trim()).filter(Boolean))]
    let cursor = 0
    const worker = async () => {
      const page = await context.newPage()
      while (cursor < targets.length) {
        const url = targets[cursor++]
      try {
        await page.goto(url.replace(/^https?:\/\/www\.facebook\.com/i, 'https://web.facebook.com'), { waitUntil: 'domcontentloaded', timeout: 45_000 })
        await page.waitForTimeout(1_200)
        const details = await page.evaluate(() => {
          const clean = (value) => String(value || '').replace(/\s*\|\s*Facebook.*$/i, '').replace(/^Facebook\s*:\s*/i, '').trim()
          const candidates = [
            document.querySelector('meta[property="og:title"]')?.content,
            document.querySelector('h1')?.textContent,
            document.title,
          ]
          const name = candidates.map(clean).find((value) => value && !/^Facebook$/i.test(value)) || ''
          const text = document.body?.innerText || ''
          const match = text.match(/([\d,.]+\s*(?:แสน|หมื่น|พัน|ล้าน|k|m)?)[^\n]{0,18}(?:สมาชิก|คนติดตาม|followers|members)/iu)
          return { name, memberText: match?.[1] || '' }
        })
        resolved.push({ url, name: details.name, memberCount: parseMemberCount(details.memberText), ok: Boolean(details.name) })
      } catch (error) {
        resolved.push({ url, name: '', ok: false, error: error.message })
      }
      }
      await page.close().catch(() => {})
    }
    await Promise.all(Array.from({ length: Math.min(3, targets.length) }, () => worker()))
    await context.storageState({ path: SESSION_PATH }).catch(() => {})
    return resolved
  } finally {
    await browser.close()
  }
}
