// Local Facebook group scraper (Playwright). Replaces the Apify integration.
//
// Uses the session saved by `npm run login`. For each group it opens the
// chronological feed, scrolls a few times, and extracts recent posts in the
// same shape the rest of the app expects:
//   { id, author, authorUrl, text, createdAt, permalink, group }
//
// Facebook's DOM is obfuscated and changes often. The selectors below are
// best-effort; if a future FB update breaks parsing, run with DEBUG_SCRAPER=1
// to dump a screenshot + HTML per group into ./scratch-debug for re-tuning.

import 'dotenv/config'
import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SESSION_PATH = process.env.FB_SESSION_PATH || path.join(__dirname, 'fb-session.json')
const HEADLESS = process.env.HEADLESS !== 'false' // default headless; set HEADLESS=false to watch
const DEBUG = process.env.DEBUG_SCRAPER === '1'
const SCROLLS = parseInt(process.env.SCRAPER_SCROLLS, 10) || 6

function groupLabel(url = '') {
  const m = url.match(/groups\/([^/?]+)/)
  return m ? m[1] : url
}

const TH_MONTHS = {
  มกราคม: 'January', กุมภาพันธ์: 'February', มีนาคม: 'March', เมษายน: 'April',
  พฤษภาคม: 'May', มิถุนายน: 'June', กรกฎาคม: 'July', สิงหาคม: 'August',
  กันยายน: 'September', ตุลาคม: 'October', พฤศจิกายน: 'November', ธันวาคม: 'December',
}

// FB scrambles the visible timestamp, but hovering the time link shows a real
// date tooltip like "Tuesday 30 June 2026 at 20:08" (or Thai equivalent).
// Parse that into a Date. Returns null if unparseable.
function parseTooltipDate(raw = '') {
  let t = raw.trim()
  if (!t) return null
  const now = new Date()
  for (const [th, en] of Object.entries(TH_MONTHS)) t = t.replace(th, en)
  // strip Thai weekday ("วันอังคารที่"), "เวลา", "น.", and English weekday
  t = t
    .replace(/วัน[฀-๿]+ที่/g, '')
    .replace(/เวลา/g, ' ')
    .replace(/น\./g, '')
    .replace(/^[A-Za-z]+,?\s+/, '')
    .replace(/\bat\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  // "Today / Yesterday / วันนี้ / เมื่อวานนี้ at HH:MM"
  const hm = t.match(/(\d{1,2}):(\d{2})/)
  if (/today|วันนี้/i.test(raw)) {
    const d = new Date(now)
    if (hm) d.setHours(+hm[1], +hm[2], 0, 0)
    return d
  }
  if (/yesterday|เมื่อวาน/i.test(raw)) {
    const d = new Date(now.getTime() - 86400000)
    if (hm) d.setHours(+hm[1], +hm[2], 0, 0)
    return d
  }

  const d = new Date(t)
  if (isNaN(d.getTime())) return null
  // Thai Buddhist year (e.g. 2569) → Gregorian
  if (d.getFullYear() > 2400) d.setFullYear(d.getFullYear() - 543)
  return d
}

// Pull metadata (author + text) for a message element and its container.
const META_FN = (m) => {
  let el = m
  for (let i = 0; i < 12 && el.parentElement; i++) el = el.parentElement
  const text = (m.innerText || '').trim()
  const links = Array.from(el.querySelectorAll('a[href]'))
  // The first /user/ link is usually the avatar (no text); pick the profile
  // link that actually carries the name (in aria-label or visible text).
  const al = links.find(
    (l) =>
      /\/user\//.test(l.getAttribute('href') || '') &&
      ((l.getAttribute('aria-label') || '').trim() || (l.innerText || '').trim()),
  )
  const author = al ? (al.getAttribute('aria-label') || al.innerText || '').trim() : ''
  return { text, author }
}

// Find the post's timestamp/permalink link element (to hover for the date).
const TS_FN = (m) => {
  let el = m
  for (let i = 0; i < 12 && el.parentElement; i++) el = el.parentElement
  const links = Array.from(el.querySelectorAll('a[href]'))
  return (
    links.find((l) => {
      const h = l.getAttribute('href') || ''
      return /\/posts\/|\/permalink\/|story_fbid|__cft__/.test(h) && !/\/user\/|\/photo\//.test(h)
    }) || null
  )
}

async function scrapeOneGroup(context, url, minutes) {
  const label = groupLabel(url)
  const page = await context.newPage()
  const target = url.replace(/\/?$/, '/') + '?sorting_setting=CHRONOLOGICAL'
  // FB virtualizes the feed (drops scrolled-away posts), so we extract after
  // every scroll step and accumulate, instead of once at the end.
  const steps = Math.min(Math.max(SCROLLS, Math.ceil(minutes / 15)), 30)
  const byKey = new Map()
  let oldStreak = 0
  let unknown = 0
  try {
    await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await page.waitForTimeout(3500)

    for (let step = 0; step < steps; step++) {
      const msgEls = await page.$$('[data-ad-comet-preview="message"]')
      for (const msgEl of msgEls) {
        let meta
        try {
          meta = await msgEl.evaluate(META_FN)
        } catch {
          continue // element detached during virtualization
        }
        // Strip ALL whitespace for the dedup key so the same post rendered with
        // different line breaks isn't counted twice.
        const norm = meta.text.replace(/\s+/g, ' ').trim()
        const key = meta.author + '|' + norm.replace(/\s/g, '').slice(0, 60)
        if (!norm || norm.length < 8 || byKey.has(key)) continue

        // Hover the time link to read the real date tooltip.
        let when = null
        let permalink = url
        try {
          const tsHandle = await msgEl.evaluateHandle(TS_FN)
          const tsEl = tsHandle.asElement()
          if (tsEl) {
            permalink = (await tsEl.getAttribute('href')) || url
            await page.mouse.move(2, 2)
            await page.waitForTimeout(120)
            await tsEl.hover({ timeout: 3000 })
            await page.waitForTimeout(650)
            const tip = await page.evaluate(
              () => document.querySelector('[role="tooltip"]')?.innerText || '',
            )
            when = parseTooltipDate(tip)
          }
        } catch {
          /* hover/extract failed → treat time as unknown */
        }

        const mins = when ? Math.round((Date.now() - when.getTime()) / 60000) : null
        if (mins === null) unknown++
        byKey.set(key, {
          id: permalink + '#' + key.slice(0, 24),
          author: meta.author || 'Unknown',
          authorUrl: '',
          text: meta.text,
          createdAt: (when || new Date()).toISOString(),
          permalink,
          group: label,
          _mins: mins,
        })

        // Chronological feed → once we hit several posts older than the
        // window, everything below is older too. Stop early.
        if (mins !== null) oldStreak = mins > minutes ? oldStreak + 1 : 0
      }
      if (oldStreak >= 5) break
      await page.mouse.wheel(0, 3000)
      await page.waitForTimeout(1700)
    }

    if (DEBUG) {
      const dir = path.join(process.cwd(), 'scratch-debug')
      fs.mkdirSync(dir, { recursive: true })
      await page.screenshot({ path: path.join(dir, `${label}.png`) })
      fs.writeFileSync(path.join(dir, `${label}.html`), await page.content())
      console.log(`     [debug] dumped scratch-debug/${label}.{png,html}`)
    }

    // Keep posts within the window. Unknown-time posts are kept (FB hid the
    // time) since the chronological feed makes them likely-recent.
    const posts = [...byKey.values()]
      .filter((p) => p._mins === null || p._mins <= minutes)
      .map(({ _mins, ...p }) => p)
    console.log(
      `     · ${label}: ${posts.length} โพสต์ (ใน ${minutes} นาที, เห็นทั้งหมด ${byKey.size}, เวลาไม่ทราบ ${unknown})`,
    )
    return posts
  } catch (e) {
    console.warn(`     ⚠️  ${label} ล้มเหลว: ${e.message}`)
    return []
  } finally {
    await page.close()
  }
}

export function hasSession() {
  return fs.existsSync(SESSION_PATH)
}

export async function scrapeGroups(groupUrls, minutes) {
  if (!hasSession()) {
    throw new Error(
      `ยังไม่มี session — รัน "npm run login" ก่อน (จะเซฟไว้ที่ ${SESSION_PATH})`,
    )
  }
  const browser = await chromium.launch({ headless: HEADLESS })
  const context = await browser.newContext({
    storageState: SESSION_PATH,
    viewport: { width: 1280, height: 1000 },
    locale: 'th-TH',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  })

  const all = []
  try {
    for (const url of groupUrls) {
      const posts = await scrapeOneGroup(context, url, minutes)
      all.push(...posts)
    }
  } finally {
    await browser.close()
  }
  return all
}

// Allow a quick standalone test:  npm run scrape:test
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const urls = (process.env.FB_GROUP_URLS || 'https://www.facebook.com/groups/condoowner')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  scrapeGroups(urls, parseInt(process.argv[2], 10) || 60)
    .then((posts) => {
      console.log(`\nรวม ${posts.length} โพสต์:`)
      posts.forEach((p) => console.log(` - [${p.group}] ${p.author}: ${p.text.slice(0, 60)}`))
      process.exit(0)
    })
    .catch((e) => {
      console.error('scrape error:', e.message)
      process.exit(1)
    })
}
