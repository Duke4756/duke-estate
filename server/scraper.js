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
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { launchBrowser } from './browserLauncher.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SESSION_PATH = process.env.FB_SESSION_PATH || path.join(__dirname, 'fb-session.json')
const HEADLESS = process.env.HEADLESS !== 'false' // default headless; set HEADLESS=false to watch
const DEBUG = process.env.DEBUG_SCRAPER === '1'
const SCROLLS = parseInt(process.env.SCRAPER_SCROLLS, 10) || 6
const CONCURRENCY = Math.min(6, Math.max(1, parseInt(process.env.SCRAPER_CONCURRENCY, 10) || 3))
const SCROLL_DISTANCE = Math.max(1500, parseInt(process.env.SCRAPER_SCROLL_DISTANCE, 10) || 4500)
const SCROLL_WAIT_MS = Math.max(350, parseInt(process.env.SCRAPER_SCROLL_WAIT_MS, 10) || 900)
const KNOWN_ONLY_STOP_STEPS = Math.max(2, parseInt(process.env.SCRAPER_KNOWN_STOP_STEPS, 10) || 3)
const HOVER_DATES = process.env.SCRAPER_HOVER_DATES === '1'

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

// Timestamp links usually expose an accessible relative time (for example
// "30 นาที" or "2 h") even when Facebook scrambles the visible characters.
// Reading that value from the DOM avoids a network/tooltip round-trip for
// every post. Exact tooltip hovering remains an opt-in compatibility fallback.
export function parseFacebookDate(raw = '', now = new Date()) {
  const text = String(raw || '').trim()
  if (!text) return null
  const relative = text.toLowerCase().match(
    /(?:^|\s)(\d+)\s*(นาที|min(?:ute)?s?|ชม\.?|ชั่วโมง|h(?:ou)?r?s?|วัน|d(?:ay)?s?)(?:\s|$)/iu,
  )
  if (relative) {
    const amount = Number(relative[1])
    const unit = relative[2]
    const multiplier = /^(?:นาที|min)/iu.test(unit)
      ? 60_000
      : /^(?:ชม|ชั่วโมง|h)/iu.test(unit)
        ? 3_600_000
        : 86_400_000
    return new Date(now.getTime() - amount * multiplier)
  }
  if (/^(?:เมื่อสักครู่|just now|now)$/iu.test(text)) return new Date(now)
  return parseTooltipDate(text)
}

// Pull metadata (author + text) for a message element and its container.
const META_FN = (m) => {
  // Stay inside this post. Walking an arbitrary number of parents can escape
  // the article and accidentally pick a group-navigation link.
  const el = m.closest('[role="article"]') || m.parentElement
  const text = (m.innerText || '').trim()
  const messageNodes = Array.from(el.querySelectorAll('[data-ad-comet-preview="message"], [data-ad-preview="message"]'))
  const sharedTexts = messageNodes
    .filter((node) => node !== m && !m.contains(node))
    .map((node) => (node.innerText || '').trim())
    .filter((value, index, values) => value && value !== text && values.indexOf(value) === index)
  const links = Array.from(el.querySelectorAll('a[href]'))
  // The first /user/ link is usually the avatar (no text); pick the profile
  // link that actually carries the name (in aria-label or visible text).
  const al = links.find(
    (l) =>
      /\/user\//.test(l.getAttribute('href') || '') &&
      ((l.getAttribute('aria-label') || '').trim() || (l.innerText || '').trim()),
  )
  const author = al ? (al.getAttribute('aria-label') || al.innerText || '').trim() : ''
  // Clean-permalink pieces: numeric group id (from a /groups/<id>/user link)
  // and the post id (photo attachment links carry it as set=pcb.<postId>).
  const hrefs = links.map((l) => l.href)
  const gid = (hrefs.find((h) => /\/groups\/(\d+)\//.test(h)) || '').match(/\/groups\/(\d+)\//)?.[1] || ''
  const pcb = (hrefs.find((h) => /set=pcb\.(\d+)/.test(h)) || '').match(/set=pcb\.(\d+)/)?.[1] || ''
  // On the plain feed FB exposes a real permalink on the post — grab it directly.
  const postHref = links.find((l) =>
    /\/posts\/\d+|\/permalink\/\d+|[?&]story_fbid=\d+/.test(l.getAttribute('href') || ''),
  )?.href || ''
  const sharedPostHref = links.find((l) => {
    const href = l.getAttribute('href') || ''
    return /\/(?:posts|permalink)\/\d+|[?&]story_fbid=\d+/.test(href) && l.href !== postHref && l.closest('[data-ad-comet-preview="message"], [data-ad-preview="message"]') !== m
  })?.href || ''
  const storyId = (postHref.match(/[?&]story_fbid=(\d+)/) || [])[1] || ''
  const timestampLink = links.find((l) => {
    const h = l.getAttribute('href') || ''
    return /\/posts\/|\/permalink\/|story_fbid|__cft__/.test(h) && !/\/user\/|\/photo\//.test(h)
  })
  const timestampText = timestampLink
    ? [
        timestampLink.getAttribute('aria-label'),
        timestampLink.getAttribute('title'),
        timestampLink.querySelector('[aria-label]')?.getAttribute('aria-label'),
        timestampLink.textContent,
      ].filter(Boolean).join(' | ')
    : ''
  const unixTime = timestampLink?.querySelector('[data-utime]')?.getAttribute('data-utime') ||
    timestampLink?.getAttribute('data-utime') || ''
  const imageUrls = Array.from(el.querySelectorAll('img[src]')).map((node) => node.src).filter((src) => !/emoji|profile|scontent.*_s\./i.test(src))
  const videoUrls = Array.from(el.querySelectorAll('video[src], video source[src]')).map((node) => node.src).filter(Boolean)
  return { text, sharedTexts, sharedPostHref, author, authorUrl: al?.href || '', gid, pcb, postHref, storyId, timestampText, unixTime, imageUrls, videoUrls }
}

// Find the post's timestamp/permalink link element (to hover for the date).
const TS_FN = (m) => {
  const el = m.closest('[role="article"]') || m.parentElement
  const links = Array.from(el.querySelectorAll('a[href]'))
  return (
    links.find((l) => {
      const h = l.getAttribute('href') || ''
      return /\/posts\/|\/permalink\/|story_fbid|__cft__/.test(h) && !/\/user\/|\/photo\//.test(h)
    }) || null
  )
}

async function scrapeOneGroup(context, url, minutes, report = () => {}, onPosts = () => {}, signal, options = {}) {
  const isKnown = options.isKnown || (() => false)
  const onDiscovered = options.onDiscovered || (() => {})
  const label = groupLabel(url)
  let page = null
  // Use the plain feed (NOT ?sorting_setting=CHRONOLOGICAL): the chronological
  // view triggers FB's obfuscated markup where post permalinks are hidden. The
  // plain feed exposes real /posts/<id> links. We rely on the hovered timestamp
  // for the time filter instead of on feed order.
  const target = url
  // FB virtualizes the feed (drops scrolled-away posts), so we extract after
  // every scroll step and accumulate, instead of once at the end.
  // Longer historical windows need deeper scrolling, but retain a hard cap so
  // one difficult group cannot run forever.
  const baseSteps = Math.min(Math.max(SCROLLS, Math.ceil(minutes / 90)), 120)
  const steps = Math.min(Math.max(baseSteps, Number(options.depth) || 0), 120)
  // Facebook does not expose a durable feed cursor. A new page must still
  // begin at the top, but the persisted per-group depth lets us fast-forward
  // through the already-covered middle. Always inspect the newest rows and
  // keep an overlap near the previous frontier so feed insertions/reordering
  // do not create a blind gap.
  const resumeDepth = Math.min(steps, Math.max(0, Number(options.resumeDepth) || 0))
  const RECENT_FULL_STEPS = 5
  const FRONTIER_OVERLAP_STEPS = 6
  const fastForwardStart = RECENT_FULL_STEPS
  const fastForwardEnd = Math.max(fastForwardStart, resumeDepth - FRONTIER_OVERLAP_STEPS)
  const byKey = new Map()
  let unknown = 0
  let skippedKnown = 0
  let consecutiveKnownOnlySteps = 0
  let scannedSteps = 0
  try {
    // `newPage` can fail if a user cancels a stream or Chromium exits. Keep it
    // inside this boundary so a browser-engine error never leaks to the UI.
    page = await context.newPage()
    report(0.05, `📂 เปิดกลุ่ม ${label}...`)
    await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await page.waitForTimeout(3500)

    const emitted = new Set()
    const inWindow = (p) => p._mins === null || p._mins <= minutes
    for (let step = 0; step < steps; step++) {
      const stepNewPosts = []
      if (signal?.aborted) {
        report(1, `⏹ ${label}: หยุดโดยผู้ใช้`)
        break
      }
      const fastForwarding = step >= fastForwardStart && step < fastForwardEnd
      if (fastForwarding) {
        report(
          (step + 1) / steps,
          `⏩ ${label}: ข้ามช่วงที่เคยอ่าน ${step + 1}/${resumeDepth} · ไปต่อจาก checkpoint`,
        )
        await page.mouse.wheel(0, 9000)
        await page.waitForTimeout(650)
        continue
      }
      scannedSteps = step + 1
      // One top-level feed article = one source post. Selecting the first
      // message inside each article prevents comments, buttons, menus and
      // recommended-group UI from entering raw post text.
      const articles = await page.$$('[role="article"]')
      const msgEls = []
      for (const article of articles) {
        const isNestedArticle = await article.evaluate((node) => Boolean(node.parentElement?.closest('[role="article"]')))
        if (isNestedArticle) continue
        const message = await article.$('[data-ad-comet-preview="message"]')
        if (message) {
          // Facebook truncates long listings and keeps the price/specification
          // lines behind "ดูเพิ่มเติม". Expand only the control inside the
          // source message (not comments or the rest of the article).
          try {
            // In some Facebook layouts the control is a sibling of the text
            // node rather than its child, so search the top-level article.
            const controls = await article.$$('div[role="button"], span[role="button"], [tabindex="0"]')
            let expansions = 0
            for (const control of controls) {
              const label = await control.evaluate((element) =>
                (element.textContent || element.getAttribute('aria-label') || '').trim(),
              )
              if (/^(?:ดูเพิ่มเติม|see more)$/iu.test(label)) {
                // Facebook sometimes renders a transparent dialog layer over
                // this visible control. Force is limited to this harmless
                // expansion action; it does not bypass login or publishing UI.
                await control.click({ force: true })
                await page.waitForTimeout(80)
                expansions += 1
                if (expansions >= 3) break
              }
            }
            // Re-select after the click because React commonly replaces the
            // collapsed message node with a new expanded node.
            const expandedMessage = await article.$('[data-ad-comet-preview="message"]')
            if (expandedMessage) msgEls.push(expandedMessage)
            continue
          } catch {
            // A virtualized post can detach while expanding; extraction below
            // will either read the current text or safely skip that post.
          }
          msgEls.push(message)
        }
      }
      for (const msgEl of msgEls) {
        let meta
        try {
          meta = await msgEl.evaluate(META_FN)
        } catch {
          continue // element detached during virtualization
        }
        // Strip ALL whitespace for the dedup key so the same post rendered with
        // different line breaks isn't counted twice.
        const sharedText = (meta.sharedTexts || []).join('\n').trim()
        const completeText = [sharedText, meta.text].filter(Boolean).join('\n')
        const norm = completeText.replace(/\s+/g, ' ').trim()
        const key = meta.author + '|' + norm.replace(/\s/g, '').slice(0, 60)
        if (!norm || norm.length < 8 || byKey.has(key)) continue

        // Clean permalink priority:
        //   1) real /posts/<id> link exposed on the plain feed
        //   2) built from group id + post id (from a photo attachment)
        //   3) (fallback below) the timestamp link's resolved href
        const clean =
          cleanPostUrl(meta.postHref, meta.gid, meta.storyId) ||
          (meta.gid && meta.pcb ? `https://www.facebook.com/groups/${meta.gid}/posts/${meta.pcb}/` : '')

        // Prefer accessible/structured time already delivered over the
        // internet with the feed. This turns the old O(posts × ~770ms) hover
        // loop into a local parse. Hovering is available only for diagnostics.
        let when = Number(meta.unixTime) > 0
          ? new Date(Number(meta.unixTime) * 1000)
          : parseFacebookDate(meta.timestampText)
        let permalink = clean
        try {
          const tsHandle = await msgEl.evaluateHandle(TS_FN)
          const tsEl = tsHandle.asElement()
          if (tsEl) {
            // Use the RESOLVED href (el.href), not getAttribute — the attribute
            // is often relative (e.g. "?__cft__=…"), which would resolve against
            // our own site instead of facebook.com when clicked.
            if (!clean) {
              const timestampHref = await tsEl.evaluate((el) => el.href)
              permalink = cleanPostUrl(timestampHref, meta.gid)
            }
            if (!when && HOVER_DATES) {
              await tsEl.hover({ timeout: 1500 })
              await page.waitForTimeout(200)
              const tip = await page.evaluate(
                () => document.querySelector('[role="tooltip"]')?.innerText || '',
              )
              when = parseFacebookDate(tip)
            }
          }
        } catch {
          /* hover/extract failed → treat time as unknown */
        }

        const mins = when ? Math.round((Date.now() - when.getTime()) / 60000) : null
        if (mins === null) unknown++
        const post = {
          id: permalink + '#' + key.slice(0, 24),
          author: meta.author || 'Unknown',
          authorUrl: meta.authorUrl || '',
          text: meta.text,
          sharedText,
          sharedPermalink: cleanPostUrl(meta.sharedPostHref, meta.gid) || meta.sharedPostHref || '',
          createdAt: (when || new Date()).toISOString(),
          permalink,
          group: label,
          imageCount: meta.imageUrls?.length || 0,
          videoCount: meta.videoUrls?.length || 0,
          mediaUrls: [...(meta.imageUrls || []), ...(meta.videoUrls || [])],
          _mins: mins,
        }
        const known = Boolean(isKnown(post))
        post._known = known
        onDiscovered(post, { known, groupUrl: url })
        byKey.set(key, post)

        // Emit THIS post immediately (if within the window) so its card shows
        // up the moment it's scraped — one post at a time.
        if (inWindow(post)) {
          emitted.add(key)
          if (known) skippedKnown++
          else {
            const publicPost = { ...post }
            delete publicPost._mins
            delete publicPost._known
            stepNewPosts.push(publicPost)
          }
        }
      }
      // Serialize classification/persistence by scroll batch. The previous
      // fire-and-forget callback could overlap batches and repeat work.
      if (stepNewPosts.length) await onPosts(stepNewPosts, { groupUrl: url })
      if (stepNewPosts.length > 0) {
        consecutiveKnownOnlySteps = 0
      } else if (msgEls.length > 0) {
        consecutiveKnownOnlySteps += 1
      }
      report(
        (step + 1) / steps,
        `📁 ${label}: ไล่ย้อนหลัง ${step + 1}/${steps} · เจอ ${byKey.size} · ใหม่ ${stepNewPosts.length}`,
      )
      // New group posts normally appear near the top. Once several successive
      // loaded sections contain only posts already persisted in the database,
      // walking all the way back to an old checkpoint wastes most of the run.
      // Stop at this known boundary; if fresh posts keep appearing we continue
      // normally and still retain the historical frontier overlap.
      if (step >= 2 && consecutiveKnownOnlySteps >= KNOWN_ONLY_STOP_STEPS) {
        report(
          1,
          `⚡ ${label}: ถึงช่วงโพสต์เดิมแล้ว · หยุดข้าม checkpoint เพื่อประหยัดเวลา`,
        )
        break
      }
      await page.mouse.wheel(0, SCROLL_DISTANCE)
      await page.waitForTimeout(SCROLL_WAIT_MS)
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
      .filter((p) => !p._known)
      .map((post) => {
        const publicPost = { ...post }
        delete publicPost._mins
        delete publicPost._known
        return publicPost
      })
    console.log(
      `     · ${label}: ใหม่ ${posts.length} · ข้ามที่เคยดึง ${skippedKnown} (เห็น ${byKey.size}, เวลาไม่ทราบ ${unknown})`,
    )
    report(1, `✅ ${label}: ใหม่ ${posts.length} · ข้ามซ้ำ ${skippedKnown}`)
    return { posts, stats: { depth: scannedSteps, resumeDepth, seen: byKey.size, fresh: posts.length, skippedKnown } }
  } catch (e) {
    const cancelled = signal?.aborted
    const closed = /target page, context or browser has been closed|browser has been closed/i.test(e.message || '')
    console.warn(`     ⚠️  ${label} ล้มเหลว: ${e.message}`)
    report(1, cancelled ? `⏹ ${label}: หยุดโดยผู้ใช้` : closed ? `⚠️ ${label}: เบราว์เซอร์เชื่อมต่อหลุด — ข้ามกลุ่มนี้` : `⚠️ ${label} ล้มเหลว`)
    return { posts: [], stats: { depth: steps, resumeDepth, seen: byKey.size, fresh: 0, skippedKnown, failed: true } }
  } finally {
    await page?.close().catch(() => {})
  }
}

export function cleanPostUrl(rawUrl = '', groupId = '', knownPostId = '') {
  const raw = String(rawUrl || '')
  const postMatch = raw.match(/facebook\.com\/groups\/([^/?#]+)\/(?:posts|permalink)\/(\d+)/i)
  if (postMatch) return `https://www.facebook.com/groups/${postMatch[1]}/posts/${postMatch[2]}/`
  const storyId = knownPostId || raw.match(/[?&]story_fbid=(\d+)/i)?.[1]
  const gid = groupId || raw.match(/[?&]id=(\d+)/i)?.[1]
  if (storyId && gid) return `https://www.facebook.com/groups/${gid}/posts/${storyId}/`
  return ''
}

export function hasSession() {
  return fs.existsSync(SESSION_PATH)
}

// onProgress({ percent, message }) is called throughout the scrape (0–100 maps
// to the scrape phase; the caller can rescale). onPosts(posts) fires repeatedly
// with batches of newly-found posts (per scroll step) so callers can stream
// results as they appear. Both are safe to omit.
export async function scrapeGroups(groupUrls, minutes, onProgress = () => {}, onPosts = () => {}, signal, options = {}) {
  if (!hasSession()) {
    throw new Error(
      `ยังไม่มี session — รัน "npm run login" ก่อน (จะเซฟไว้ที่ ${SESSION_PATH})`,
    )
  }
  onProgress({ percent: 1, message: `🚀 เริ่มดึง ${groupUrls.length} กลุ่ม...` })
  const browser = await launchBrowser({
    headless: HEADLESS,
    args: ['--disable-blink-features=AutomationControlled'],
  })
  const context = await browser.newContext({
    storageState: SESSION_PATH,
    viewport: { width: 1366, height: 900 },
    locale: 'th-TH',
    serviceWorkers: 'block',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  })
  // Search needs HTML/text and GraphQL responses, not the heavy visual assets.
  // Blocking them substantially reduces transfer and rendering work on every
  // parallel group page while leaving scripts/XHR/document requests intact.
  await context.route('**/*', (route) => {
    const type = route.request().resourceType()
    return ['image', 'media', 'font'].includes(type)
      ? route.abort('blockedbyclient')
      : route.continue()
  })
  // Reduce automation fingerprints so FB serves the normal (non-obfuscated) DOM.
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
    Object.defineProperty(navigator, 'languages', { get: () => ['th-TH', 'th', 'en'] })
  })

  const total = groupUrls.length
  const all = []
  const progressByGroup = new Map(groupUrls.map((url) => [url, 0]))
  let nextIndex = 0
  try {
    const worker = async () => {
      while (!signal?.aborted) {
        const i = nextIndex++
        if (i >= total) return
        const groupUrl = groupUrls[i]
        const depth = options.getDepth?.(groupUrl, Math.min(Math.max(SCROLLS, Math.ceil(minutes / 90)), 120))
        const resumeDepth = options.getResumeDepth?.(groupUrl) || 0
        options.onGroupStart?.(groupUrl, { depth, resumeDepth })
        const result = await scrapeOneGroup(
          context,
          groupUrl,
          minutes,
          (frac, message) => {
            progressByGroup.set(groupUrl, frac)
            const completed = [...progressByGroup.values()].reduce((sum, value) => sum + value, 0)
            onProgress({ percent: Math.round((completed / total) * 100), message })
          },
          onPosts,
          signal,
          { ...options, depth, resumeDepth },
        )
        all.push(...result.posts)
        options.onGroupComplete?.(groupUrl, result.stats)
      }
    }
    const workers = Array.from({ length: Math.min(CONCURRENCY, total) }, () => worker())
    await Promise.all(workers)
    if (signal?.aborted) {
      onProgress({ percent: 100, message: `⏹ หยุดดึงโพสต์ · ได้ ${all.length} โพสต์ก่อนหยุด` })
    }
  } finally {
    // Preserve cookies Facebook refreshed during collection so the saved
    // primary session remains warm across scraper/browser restarts.
    await context.storageState({ path: SESSION_PATH }).catch(() => {})
    await browser.close()
  }
  return all
}

// Allow a quick standalone test:  npm run scrape:test
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
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
