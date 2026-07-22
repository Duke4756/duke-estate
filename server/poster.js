// Auto-post executor (Playwright). Posts a Post Set (text + images) into one or
// more Facebook groups using the SAME session (`server/fb-session.json`) the
// scraper uses — run `npm run login` once to create it.
//
// The browser/context setup below mirrors server/scraper.js (launch args,
// storageState, locale, anti-fingerprint init scripts) on purpose so FB serves
// the normal (non-obfuscated) DOM and so the session behaves identically.
//
// ⚠️ Facebook's composer DOM is obfuscated and changes often. The selectors
// below are best-effort with fallbacks; if a future FB update breaks posting,
// run with DEBUG_POSTER=1 to dump a screenshot + HTML per group into
// ./scratch-debug for re-tuning (same workflow as the scraper).

import 'dotenv/config'
import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getSet, IMAGES_DIR } from './postsets.js'
import { listSchedules, updateSchedule } from './schedules.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SESSION_PATH = process.env.FB_SESSION_PATH || path.join(__dirname, 'fb-session.json')
const HEADLESS = process.env.HEADLESS !== 'false' // default headless; set HEADLESS=false to watch
const DEBUG = process.env.DEBUG_POSTER === '1'

export function canPost() {
  return fs.existsSync(SESSION_PATH)
}

// One global browser session at a time — FB sessions conflict if two browsers
// reuse the same cookies concurrently, and posting is heavy. Callers check this
// before starting a run.
let running = false
export function isPosting() {
  return running
}

// Same browser + context setup as server/scraper.js (storageState = saved FB
// session). Returns { browser, context }.
async function launchContext() {
  const browser = await chromium.launch({
    headless: HEADLESS,
    args: ['--disable-blink-features=AutomationControlled'],
  })
  const context = await browser.newContext({
    storageState: SESSION_PATH,
    viewport: { width: 1366, height: 900 },
    locale: 'th-TH',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  })
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
    Object.defineProperty(navigator, 'languages', { get: () => ['th-TH', 'th', 'en'] })
  })
  return { browser, context }
}

const groupLabel = (url = '') => (url.match(/groups\/([^/?]+)/) || [])[1] || url

// Find and click the composer trigger on a group feed ("What's on your mind…").
// Some groups render the composer inline (no dialog); others open a modal. We
// return the dialog locator if one appears, else null (inline composer).
async function openComposer(page) {
  // The group composer entry is a div[role="button"] with the placeholder text
  // (localized): TH "เขียนอะไรบางอย่าง…"/"คุณกำลังคิดอะไรอยู่", EN "Write something…".
  const promptRe = /เขียนอะไรบางอย่าง|คิดอะไรอยู่|เขียนโพสต์|on your mind|write something/i
  const candidates = [
    page.getByRole('button', { name: promptRe }).first(),
    page.locator('div[role="button"]').filter({ hasText: promptRe }).first(),
    page.locator('[aria-label*="สร้างโพสต์" i], [aria-label*="Create a post" i]').first(),
  ]
  let opened = false
  for (const c of candidates) {
    try {
      if ((await c.count()) === 0) continue
      await c.click({ timeout: 5000 })
      opened = true
      break
    } catch {
      /* try next strategy */
    }
  }
  if (!opened) throw new Error('ไม่พบปุ่มเปิดช่องเขียนโพสต์ (composer)')
  // FB renders the composer across nested dialogs — the outer one is just a
  // "Create post" wrapper (only a Close button). The REAL composer is the dialog
  // that holds the file input + Post button; pick that, not `.last()`.
  const dialog = page
    .locator('[role="dialog"]')
    .filter({ has: page.locator('input[type="file"]') })
    .last()
  try {
    await dialog.waitFor({ state: 'visible', timeout: 12000 })
    return dialog
  } catch {
    const alt = page
      .locator('[role="dialog"]')
      .filter({ has: page.getByRole('button', { name: /^โพสต์$|^Post$/i }) })
      .last()
    if ((await alt.count()) > 0) return alt
    throw new Error('เปิด composer แล้ว แต่หา dialog ที่มีช่องเขียน/ปุ่มโพสต์ไม่เจอ')
  }
}

// Pick the contenteditable editor to type into (inside the dialog if present).
function editorLocator(page, dialog) {
  const root = dialog || page
  return root.locator('[contenteditable="true"]').first()
}

// Attach images via FB's hidden file input(s). FB has several <input type=file>
// in the dialog; we want one that accepts images. Returns true if attached.
async function attachImages(page, dialog, imagePaths) {
  if (!imagePaths.length) return false
  // Sometimes the "Photo/Video" tab must be clicked first to surface the input.
  const root = dialog || page
  try {
    const photoTab = root.getByRole('tab', { name: /รูปภาพ|Photo|Video/i }).first()
    if ((await photoTab.count()) > 0) await photoTab.click({ timeout: 3000 })
  } catch {
    /* tab not required on this FB layout */
  }

  // FB's composer has several file inputs: a VIDEO-only single-file input and
  // one or more MULTIPLE image inputs. Pick a multiple image input (the video
  // one is non-multiple and rejects >1 file). Order of preference:
  //   1) accepts image AND multiple   2) accepts image   3) any input
  const inputs = root.locator('input[type="file"]')
  const count = await inputs.count()
  const metas = []
  for (let i = 0; i < count; i++) {
    const el = inputs.nth(i)
    const accept = (await el.getAttribute('accept').catch(() => '')) || ''
    const multiple = await el.evaluate((e) => e.multiple).catch(() => false)
    metas.push({ i, isImage: /image/i.test(accept), multiple })
  }
  const pick =
    metas.find((m) => m.isImage && m.multiple) || metas.find((m) => m.isImage) || metas[0]
  if (!pick) throw new Error('ไม่พบช่องอัปโหลดรูป (file input) ใน composer')
  const target = inputs.nth(pick.i)

  // A non-multiple input can only take one file — cap to avoid a crash.
  const files = pick.multiple ? imagePaths : imagePaths.slice(0, 1)
  await target.setInputFiles(files)
  // Wait for FB to finish uploading each image (progress bars disappear).
  await page.waitForTimeout(1500)
  try {
    await page
      .locator('[role="progressbar"], [aria-busy="true"]')
      .first()
      .waitFor({ state: 'hidden', timeout: 60000 })
  } catch {
    /* progress bar selector missed — give it a short buffer instead */
    await page.waitForTimeout(3000)
  }
  return true
}

// Click the Post button and wait for confirmation (dialog closes or success
// toast appears). Throws on timeout.
async function submitAndWait(page, dialog) {
  const root = dialog || page
  // Do NOT use an instant .count() check — right after attaching images FB
  // re-renders the composer, so the Post button can appear a moment later.
  // Wait for it (auto-retry); fall back to a page-wide search if the dialog
  // reference changed during the re-render.
  let postBtn = root.getByRole('button', { name: /^โพสต์$|^Post$/i }).first()
  try {
    await postBtn.waitFor({ state: 'visible', timeout: 25000 })
  } catch {
    postBtn = page.getByRole('button', { name: /^โพสต์$|^Post$/i }).last()
    try {
      await postBtn.waitFor({ state: 'visible', timeout: 10000 })
    } catch {
      throw new Error('ไม่พบปุ่ม "โพสต์" ใน composer (รอแล้วไม่ขึ้น)')
    }
  }

  // The button stays aria-disabled until images finish uploading — wait for it
  // to become enabled before clicking (up to ~20s).
  try {
    await postBtn
      .and(page.locator(':not([aria-disabled="true"])'))
      .waitFor({ state: 'visible', timeout: 20000 })
  } catch {
    /* proceed anyway — some layouts never expose aria-disabled */
  }
  await page.waitForTimeout(500)
  await postBtn.click()

  // Success = the composer dialog closes OR a "post shared" toast shows up.
  const successToast = page.locator('text=/(ถูกแชร์แล้ว|โพสต์ของคุณ|has been shared|we shared your post)/i')
  const closed = dialog ? dialog.waitFor({ state: 'hidden', timeout: 30000 }).then(() => 'closed') : null
  const toasted = successToast.first().waitFor({ state: 'visible', timeout: 30000 }).then(() => 'toast')
  const settled = closed ? await Promise.race([closed, toasted]) : await toasted
  if (!settled) throw new Error('ไม่ยืนยันได้ว่าโพสต์สำเร็จ (timeout)')
}

// Post one set to one group. Returns { ok, error }. onStep(msg) reports progress.
async function postToGroup(context, groupUrl, { text, imagePaths }, onStep = () => {}) {
  const label = groupLabel(groupUrl)
  const page = await context.newPage()
  try {
    onStep(`เปิดกลุ่ม ${label}...`)
    await page.goto(groupUrl, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await page.waitForTimeout(2500)

    // If FB bounced to a login/checkpoint, the session is bad — stop early.
    if (/\/login|\/checkpoint|\/recover/i.test(page.url())) {
      throw new Error('session หมดอายุ — รัน "npm run login" ใหม่ (เปลี่ยนเส้นไปหน้า login/checkpoint)')
    }

    onStep(`เปิดช่องเขียนโพสต์...`)
    const dialog = await openComposer(page)

    if (text && text.trim()) {
      onStep(`พิมพ์ข้อความ...`)
      const editor = editorLocator(page, dialog)
      await editor.waitFor({ state: 'visible', timeout: 10000 })
      await editor.click()
      await page.waitForTimeout(300)
      // type char-by-char: FB's draftjs editor ignores direct DOM/fill() writes.
      await page.keyboard.type(text, { delay: 5 })
    }

    if (imagePaths.length) {
      onStep(`แนบรูป ${imagePaths.length} รูป...`)
      await attachImages(page, dialog, imagePaths)
    }

    onStep(`กดโพสต์ และรอยืนยัน...`)
    await submitAndWait(page, dialog)
    onStep(`✅ ${label}: โพสต์สำเร็จ`)
    return { ok: true, error: null }
  } catch (e) {
    if (DEBUG) {
      const dir = path.join(process.cwd(), 'scratch-debug')
      fs.mkdirSync(dir, { recursive: true })
      try {
        await page.screenshot({ path: path.join(dir, `post-${label}.png`) })
        fs.writeFileSync(path.join(dir, `post-${label}.html`), await page.content())
      } catch {
        /* page may have closed */
      }
      console.log(`     [debug] dumped scratch-debug/post-${label}.{png,html}`)
    }
    return { ok: false, error: e.message }
  } finally {
    await page.close()
  }
}

// Load a schedule + its post set, post to every target group with one browser,
// and record per-group results on the schedule. onStep(msg) reports progress.
// Returns the schedule's results array.
export async function runSchedule(scheduleId, { onStep = () => {} } = {}) {
  if (running) throw new Error('มีการโพสต์อื่นกำลังทำงานอยู่ — รอจนเสร็จ')
  if (!canPost()) throw new Error('ยังไม่มี session — รัน "npm run login" ก่อน')

  const schedule = listSchedules().find((s) => s.id === scheduleId)
  if (!schedule) throw new Error('ไม่พบ schedule')

  const set = schedule.postSetId ? getSet(schedule.postSetId) : null
  if (!set) {
    updateSchedule(scheduleId, { status: 'failed' })
    throw new Error('ชุดโพสต์ถูกลบไปแล้ว — ไม่สามารถโพสต์ได้')
  }

  const text = set.text || ''
  const imagePaths = (set.images || [])
    .map((img) => path.join(IMAGES_DIR, img.file))
    .filter((p) => fs.existsSync(p))

  running = true
  updateSchedule(scheduleId, { status: 'posting', results: [], lastRunAt: new Date().toISOString() })
  const groups = schedule.groups || []
  const results = []
  onStep(`เริ่มโพสต์ "${set.name}" → ${groups.length} กลุ่ม`)

  let { browser, context } = {}
  try {
    ;({ browser, context } = await launchContext())
    for (let i = 0; i < groups.length; i++) {
      const group = groups[i]
      onStep(`(${i + 1}/${groups.length}) ${groupLabel(group)}`)
      const res = await postToGroup(context, group, { text, imagePaths }, onStep)
      results.push({ group, ok: res.ok, error: res.error, at: new Date().toISOString() })
      updateSchedule(scheduleId, { results: [...results] })

      // Human-ish pause between groups (skip after the last one).
      if (i < groups.length - 1) {
        const waitMs = 6000 + Math.floor(Math.random() * 6000)
        await new Promise((r) => setTimeout(r, waitMs))
      }
    }
  } catch (e) {
    onStep(`⚠️ โพสต์ล้มเหลว: ${e.message}`)
    // A browser-level failure (couldn't launch) marks remaining groups as errored.
    if (results.length < groups.length) {
      for (const g of groups.slice(results.length)) {
        results.push({ group: g, ok: false, error: e.message, at: new Date().toISOString() })
      }
    }
  } finally {
    running = false
    const anyOk = results.some((r) => r.ok)
    const allOk = results.length > 0 && results.every((r) => r.ok)
    updateSchedule(scheduleId, {
      status: allOk ? 'done' : anyOk ? 'done' : 'failed',
      results,
      finishedAt: new Date().toISOString(),
    })
    if (browser) await browser.close().catch(() => {})
  }
  onStep(`เสร็จสิ้น · สำเร็จ ${results.filter((r) => r.ok).length}/${results.length} กลุ่ม`)
  return results
}
