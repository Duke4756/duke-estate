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
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { deleteSet, getSet, IMAGES_DIR } from './postsets.js'
import { eligibleGroups, isOneTimePostComplete, listSchedules, rotateGroupsForAccount, scheduleStatusForResults, updateSchedule } from './schedules.js'
import { removeAutoCampaignPostSets } from './autoCampaigns.js'
import { preparePostText } from './postText.js'
import { facebookPostPermalink, postVerificationMarkers } from './facebookPostMatch.js'
import { filterPostableGroups, saveGroupMembership, saveGroupMemberships } from './groupMembershipStore.js'
import { isMembershipUnavailableError, shouldTryNextRandomGroup } from './postingGroupFallback.js'
import { launchBrowser } from './browserLauncher.js'
import {
  accountSessionPath,
  accountSessionReady,
  listAccounts,
  markAccountSessionExpired,
} from './accounts.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SESSION_PATH = process.env.FB_SESSION_PATH || path.join(__dirname, 'fb-session.json')
// Posting normally runs without showing a Chrome window. Set
// POSTER_HEADLESS=false only when diagnosing a Facebook layout/change.
const HEADLESS = process.env.POSTER_HEADLESS !== 'false'
const DEBUG = process.env.DEBUG_POSTER === '1'
const SESSION_EXPIRED_MESSAGE = 'session Facebook หมดอายุ — ไปที่ “โพสต์อัตโนมัติ > บัญชีโพสต์” แล้วกด “ล็อกอินใหม่” ที่บัญชีนี้'

export function canPost() {
  return listAccounts().some((account) => account.ready)
}

// Different accounts have different storage-state files and can safely post
// concurrently. Keep a strict lock within each individual account.
const runningAccountIds = new Set()
export function isPosting(accountId) {
  return accountId ? runningAccountIds.has(accountId) : runningAccountIds.size > 0
}

// Same browser + context setup as server/scraper.js (storageState = saved FB
// session). Returns { browser, context }.
async function launchContext(sessionPath = SESSION_PATH) {
  const browser = await launchBrowser({
    headless: HEADLESS,
    args: ['--disable-blink-features=AutomationControlled'],
  })
  const context = await browser.newContext({
    storageState: sessionPath,
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
const isNotMemberError = isMembershipUnavailableError

// A public group can still show parts of its feed to visitors, including a
// composer-looking prompt, but Facebook will not publish for a non-member.
// Detect this before composing so a missing membership is never reported as a
// vague "composer closed" failure.
async function assertCanPostToGroup(page, label) {
  // Facebook also renders "Join group" buttons for recommended groups lower
  // on the page. The primary group's positive joined state is authoritative
  // and must be checked before looking for a Join button anywhere in the DOM.
  const joined = page.getByText(/^(เข้าร่วมแล้ว|Joined)$/i).first()
  try {
    if ((await joined.count()) > 0 && (await joined.isVisible())) return
  } catch {
    /* continue to the negative check */
  }
  const join = page.getByRole('button', { name: /^(เข้าร่วมกลุ่ม|Join group)$/i }).first()
  try {
    if ((await join.count()) > 0 && (await join.isVisible())) {
      throw new Error(`ยังไม่ได้เข้าร่วมกลุ่ม ${label} — เข้าร่วมและตอบคำถาม/รออนุมัติใน Facebook ก่อน แล้วจึงตั้งคิวใหม่`)
    }
  } catch (err) {
    if (err.message?.startsWith('ยังไม่ได้เข้าร่วมกลุ่ม')) throw err
    // A transiently detached join control is not evidence of a membership
    // problem; the composer check below remains the authoritative fallback.
  }
  const requested = page.getByRole('button', { name: /^(ยกเลิกคำขอ|Cancel request)$/i }).first()
  const pending = page.getByText(/^(รอการอนุมัติ|Pending)$/i).first()
  try {
    if (((await requested.count()) > 0 && await requested.isVisible()) || ((await pending.count()) > 0 && await pending.isVisible())) {
      throw new Error(`กลุ่มกำลังรออนุมัติ ${label} — ข้ามไปลองกลุ่มถัดไป`)
    }
  } catch (err) {
    if (err.message?.startsWith('กลุ่มกำลังรออนุมัติ')) throw err
  }
}

// Facebook does not always redirect an expired session to /login. Public
// groups are often rendered as a logged-out preview at the original group URL,
// with a login form/banner in the DOM. Treat that as an expired session before
// trying membership/composer selectors, otherwise every run is misleadingly
// reported as "composer not found".
async function assertLoggedIn(page) {
  if (/\/login|\/checkpoint|\/recover/i.test(page.url())) {
    throw new Error(SESSION_EXPIRED_MESSAGE)
  }

  const loginEmail = page.locator(
    'input[name="email"], input[autocomplete="username"], input[aria-label*="อีเมล" i], input[aria-label*="email" i]',
  )
  const loginControl = page.getByRole('button', {
    name: /^(เข้าสู่ระบบ|เข้าสู่ระบบ Facebook|Log in|Log into Facebook)$/i,
  })
  const accountNav = page.locator(
    '[aria-label*="บัญชีของคุณ" i], [aria-label*="Account" i][role="button"], [aria-label*="โปรไฟล์ของคุณ" i]',
  )

  const hasAccountNav = await accountNav
    .first()
    .isVisible()
    .catch(() => false)
  if (hasAccountNav) return

  const showsLogin =
    (await loginEmail.first().isVisible().catch(() => false)) ||
    (await loginControl.first().isVisible().catch(() => false))
  if (showsLogin) {
    throw new Error(SESSION_EXPIRED_MESSAGE)
  }
}

// Find and click the composer trigger on a group feed ("What's on your mind…").
// Some groups render the composer inline (no dialog); others open a modal. We
// return the dialog locator if one appears, else null (inline composer).
async function openComposer(page) {
  // The group composer entry is a div[role="button"] with the placeholder text
  // (localized): Facebook currently uses several Thai variants, including
  // "เขียนอะไรสักหน่อย...." in some groups, as well as the English prompt.
  const promptRe = /เขียนอะไร(?:บางอย่าง|สักหน่อย)|คุณกำลังคิดอะไร|คิดอะไรอยู่|สร้างโพสต์|เขียนโพสต์|on your mind|create (?:a )?post|write something/i
  // Allow lazy group widgets to finish rendering before deciding the composer
  // is absent. Facebook frequently paints the feed before this control.
  await page.waitForTimeout(1200)
  const candidates = [
    page.locator('[data-pagelet*="GroupInlineComposer" i] [role="button"]').filter({ hasText: promptRe }).first(),
    page.getByRole('button', { name: promptRe }).first(),
    page.locator('div[role="button"]').filter({ hasText: promptRe }).first(),
    page.locator('[aria-label*="สร้างโพสต์" i], [aria-label*="Create a post" i]').first(),
    page.getByText(promptRe).first().locator('xpath=ancestor::*[@role="button"][1]'),
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

async function openComposerWithRecovery(page, groupUrl, label) {
  let firstError
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await openComposer(page)
    } catch (error) {
      firstError ||= error
      // Re-check authentication after the failed selector: Facebook may have
      // replaced the group feed with a logged-out preview without changing URL.
      await assertLoggedIn(page)
      await assertCanPostToGroup(page, label)
      if (attempt === 0) {
        await page.goto(groupUrl, { waitUntil: 'domcontentloaded', timeout: 60000 })
        await page.waitForTimeout(4000)
      }
    }
  }

  const restrictedNotice = page.getByText(
    /เฉพาะผู้ดูแล(?:กลุ่ม)?เท่านั้นที่โพสต์ได้|กลุ่ม.*หยุดชั่วคราว|only admins can post|group is paused|posting.*disabled/i,
  ).first()
  if (await restrictedNotice.isVisible().catch(() => false)) {
    throw new Error(`กลุ่ม ${label} ไม่เปิดให้สมาชิกสร้างโพสต์ในขณะนี้`)
  }
  throw new Error(`${firstError?.message || 'ไม่พบช่องเขียนโพสต์'} หลังโหลดกลุ่มใหม่แล้ว — กลุ่มอาจไม่อนุญาตให้บัญชีนี้โพสต์`)
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
  // Wait for FB to finish uploading each image.  Do this inside the composer:
  // a feed-level progressbar can disappear immediately and used to make us
  // click Post while the real photo upload was still unfinished.
  await page.waitForTimeout(1500)
  const uploadIndicators = root.locator('[role="progressbar"], [aria-busy="true"]')
  const deadline = Date.now() + 120000
  // Indicators can be added and removed as every individual image completes,
  // so require a short quiet period rather than waiting for only the first one.
  let quietSince = null
  while (Date.now() < deadline) {
    const visible = await uploadIndicators.evaluateAll((els) =>
      els.filter((el) => {
        const style = window.getComputedStyle(el)
        return style.display !== 'none' && style.visibility !== 'hidden' && el.getClientRects().length > 0
      }).length,
    )
    if (visible === 0) {
      quietSince ||= Date.now()
      if (Date.now() - quietSince >= 2000) break
    } else {
      quietSince = null
    }
    await page.waitForTimeout(500)
  }
  return true
}

// Return the permalinks currently visible in the group feed.  We capture this
// before submitting, then look for a new one afterwards: Facebook does not
// redirect the composer to the newly-created post.
async function visiblePostLinks(page) {
  return page.locator('a[href*="/posts/"], a[href*="/permalink/"]').evaluateAll((anchors) =>
    anchors
      .map((a) => a.href)
      // Group posts are served under both /posts/<id> and /permalink/<id>
      // depending on the group/feed experiment Facebook assigns to the account.
      .filter((href) => /facebook\.com\/groups\/[^/]+\/(?:posts|permalink)\/[^/?#]+/i.test(href))
      .map((href) => href.split('?')[0]),
  )
}

// Verify inside the target group's own feed. A permalink is useful when
// Facebook exposes one, but it is not required: some layouts hide it even
// though the freshly-published article is visible. Never accept an old card
// with the same property reference as proof of a new post.
async function matchingPostCardCount(page, text) {
  const marker = postVerificationMarkers(text)[0]
  if (!marker) return 0
  return page.locator('[role="article"]').filter({ hasText: marker }).count().catch(() => 0)
}

async function findPublishedPost(page, text, linksBefore, matchingCardsBefore, groupUrl) {
  const markers = postVerificationMarkers(text)
  const uniqueReference = markers.find((marker) => /\b[A-Z]{1,8}-\d{3,}\b/i.test(marker))

  const findInMatchingCards = async ({ allowUnlinked = true } = {}) => {
    for (const marker of markers) {
      const cards = page.locator('[role="article"]').filter({ hasText: marker })
      for (let index = 0; index < await cards.count(); index += 1) {
        const card = cards.nth(index)
        const hrefs = await card
          .locator('a[href]')
          .evaluateAll((anchors) => anchors.map((anchor) => anchor.href))
          .catch(() => [])
        const matchedLink = facebookPostPermalink(hrefs, groupUrl)
        if (matchedLink && !linksBefore.has(matchedLink)) {
          return { foundInGroup: true, postUrl: matchedLink }
        }
        // When no canonical URL is exposed, accept only a freshly timestamped
        // group card. The exact property reference is required when available;
        // this prevents another new post in a busy group from being matched.
        const cardText = await card.innerText().catch(() => '')
        const recent = /(?:เมื่อสักครู่|เพิ่งโพสต์|ไม่กี่วินาที|just now|a few seconds|^|\s)1\s*(?:นาที|min(?:ute)?)(?:\s|$)/i.test(cardText)
        if (allowUnlinked && recent && (!uniqueReference || marker === uniqueReference) && await cards.count() > matchingCardsBefore) {
          return { foundInGroup: true, postUrl: null }
        }
      }
    }
    return null
  }

  // A large photo set can take a while to appear in the group feed after the
  // composer reports completion, especially on a fresh Facebook session.
  for (let attempt = 0; attempt < 20; attempt++) {
    const matchedLink = await findInMatchingCards()
    if (matchedLink) return matchedLink
    // A newly seen link is only valid for an image-only post.  With text, a
    // busy group can add somebody else's post during a reload; accepting that
    // link was a false-success bug. Text posts must contain our own marker.
    if (!markers.length) {
      const newLink = (await visiblePostLinks(page).catch(() => [])).find((href) => !linksBefore.has(href))
      if (newLink) return { foundInGroup: true, postUrl: newLink }
    }

    // Closing the composer does not cause every Facebook group feed to
    // reconcile its virtualised list.  Reload the group after it has had time
    // to index the new post; otherwise a successful post was often reported
    // as a failure solely because we were inspecting stale DOM.
    if (attempt === 8) {
      await page.goto(groupUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {})
      await page.waitForTimeout(2500)
    }
    await page.waitForTimeout(1000)
  }

  // The normal group feed may not surface a fresh post in busy groups. Search
  // inside that exact group by the unique property reference, just like the
  // lead-search workflow, then apply the same direct/story_fbid/pcb extraction.
  if (uniqueReference) {
    try {
      const searchUrl = new URL(groupUrl)
      searchUrl.pathname = `${searchUrl.pathname.replace(/\/?$/, '/')}search/`
      searchUrl.search = ''
      searchUrl.searchParams.set('q', uniqueReference)
      await page.goto(searchUrl.toString(), { waitUntil: 'domcontentloaded', timeout: 60000 })
      for (let attempt = 0; attempt < 12; attempt += 1) {
        const matchedLink = await findInMatchingCards({ allowUnlinked: false })
        if (matchedLink) return matchedLink
        if (attempt === 5) await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {})
        await page.waitForTimeout(1500)
      }
    } catch {
      // Preserve the submitted/manual-tracking fallback if Facebook search is
      // temporarily unavailable for this account or group.
    }
  }
  return { foundInGroup: false, postUrl: null }
}

async function waitForEnabledPostButton(page, postBtn) {
  const deadline = Date.now() + 120000
  while (Date.now() < deadline) {
    try {
      await postBtn.waitFor({ state: 'visible', timeout: 2000 })
      const disabled = await postBtn.evaluate(
        (button) =>
          button.getAttribute('aria-disabled') === 'true' ||
          button.hasAttribute('disabled') ||
          button.matches(':disabled'),
      )
      if (!disabled) return
    } catch {
      // Facebook re-renders this button while images upload. A Locator resolves
      // the replacement on the next pass, unlike holding a stale element handle.
    }
    await page.waitForTimeout(500)
  }
  throw new Error('ปุ่มโพสต์ยังไม่พร้อมใช้งาน — รูปอาจอัปโหลดไม่เสร็จ')
}

// Click the Post button, wait for Facebook's UI acknowledgement, then verify
// that the post actually appeared in the feed.  Returns its permalink only.
async function submitAndWait(page, dialog, text, groupUrl) {
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

  // Never click a disabled button.  The previous best-effort check could time
  // out during a large image upload and then proceed anyway, leaving a draft
  // that looked like a completed run.
  await waitForEnabledPostButton(page, postBtn)
  const linksBefore = new Set(await visiblePostLinks(page).catch(() => []))
  const matchingCardsBefore = await matchingPostCardCount(page, text)
  await page.waitForTimeout(500)
  await postBtn.click()

  const postError = page
    .getByText(/ไม่สามารถโพสต์|โพสต์ไม่สำเร็จ|เกิดข้อผิดพลาด|couldn['’]t post|failed to post|something went wrong/i)
    .last()

  // When photos are attached Facebook first shows a full-screen "Posting…"
  // state.  The old implementation treated an inner dialog closing as success
  // and closed Chromium while that upload was still running, cancelling it.
  // Wait for this state to finish before attempting to inspect the feed.
  const postingState = page.getByText(/^(กำลังโพสต์|Posting)$/i).last()
  let sawPostingState = false
  try {
    await postingState.waitFor({ state: 'visible', timeout: 10000 })
    sawPostingState = true
    await postingState.waitFor({ state: 'hidden', timeout: 120000 })
  } catch (err) {
    if (sawPostingState) {
      throw new Error('Facebook ยังโพสต์ไม่เสร็จภายใน 2 นาที — ไม่ปิดเบราว์เซอร์ระหว่างอัปโหลดอีกแล้ว')
    }
    // Text/status varies by Facebook layout.  In that case use its normal
    // completion UI as a fallback, but still require a real feed permalink.
  }

  // Success UI differs across Facebook layouts; it is only a transition cue,
  // not our final success criterion.
  const successToast = page.locator('text=/(ถูกแชร์แล้ว|โพสต์ของคุณ|has been shared|we shared your post)/i')
  if (!sawPostingState) {
    const closed = dialog ? dialog.waitFor({ state: 'hidden', timeout: 30000 }).then(() => 'closed') : null
    const toasted = successToast.first().waitFor({ state: 'visible', timeout: 30000 }).then(() => 'toast')
    const failed = postError.waitFor({ state: 'visible', timeout: 30000 }).then(() => 'failed')
    const settled = closed ? await Promise.race([closed, toasted, failed]) : await Promise.race([toasted, failed])
    if (settled === 'failed') {
      throw new Error(`Facebook ปฏิเสธการโพสต์: ${(await postError.innerText().catch(() => '')).trim() || 'ไม่ทราบสาเหตุ'}`)
    }
    if (!settled) throw new Error('ไม่ยืนยันได้ว่า Facebook รับโพสต์แล้ว (timeout)')
  }
  if ((await postError.count()) > 0 && (await postError.isVisible().catch(() => false))) {
    throw new Error(`Facebook ปฏิเสธการโพสต์: ${(await postError.innerText().catch(() => '')).trim() || 'ไม่ทราบสาเหตุ'}`)
  }

  // The authoritative check is the matching post card inside this group. The
  // permalink is optional metadata because Facebook does not expose it in all
  // feed variants.
  const published = await findPublishedPost(page, text, linksBefore, matchingCardsBefore, groupUrl)
  return {
    postUrl: published.postUrl,
    verified: published.foundInGroup ? (published.postUrl ? 'permalink' : 'group_card') : 'unconfirmed',
  }
}

// Post one set to one group. Returns { ok, error }. onStep(msg) reports progress.
async function postToGroup(context, groupUrl, { text, imagePaths }, onStep = () => {}) {
  const label = groupLabel(groupUrl)
  const page = await context.newPage()
  try {
    onStep(`เปิดกลุ่ม ${label}...`)
    await page.goto(groupUrl, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await page.waitForTimeout(2500)

    // Public groups can remain at /groups/... while serving a logged-out
    // preview, so URL-only checks are insufficient.
    await assertLoggedIn(page)
    await assertCanPostToGroup(page, label)

    onStep(`เปิดช่องเขียนโพสต์...`)
    const dialog = await openComposerWithRecovery(page, groupUrl, label)

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
    const submitted = await submitAndWait(page, dialog, text, groupUrl)
    if (submitted.verified === 'unconfirmed') {
      onStep(`⚠️ ${label}: ยังไม่พบการ์ดโพสต์ที่ตรงกันในกลุ่ม · ลองกลุ่มถัดไป`)
      return {
        ok: false,
        pending: true,
        error: 'Facebook ปิดหน้าต่างเขียนโพสต์แล้ว แต่ยังไม่พบการ์ดโพสต์ของห้องนี้ในกลุ่ม',
        postUrl: null,
        verified: 'unconfirmed',
      }
    }
    if (DEBUG) {
      const dir = path.join(process.cwd(), 'scratch-debug')
      fs.mkdirSync(dir, { recursive: true })
      await page.screenshot({ path: path.join(dir, `post-success-${label}.png`) })
      fs.writeFileSync(path.join(dir, `post-success-${label}.html`), await page.content())
    }
    onStep(`✅ ${label}: พบโพสต์ของห้องนี้ในกลุ่มแล้ว`)
    return { ok: true, error: null, ...submitted }
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
    return { ok: false, error: e.message, postUrl: null, verified: null }
  } finally {
    await page.close()
  }
}

// Load a schedule + its post set, post to every target group with one browser,
// and record per-group results on the schedule. onStep(msg) reports progress.
// Returns the schedule's results array.
export async function runSchedule(scheduleId, { onStep = () => {} } = {}) {
  const schedule = listSchedules().find((s) => s.id === scheduleId)
  if (!schedule) throw new Error('ไม่พบ schedule')
  const accountId = schedule.accountId || 'primary'
  if (runningAccountIds.has(accountId)) throw new Error('บัญชีนี้กำลังโพสต์งานอื่นอยู่ — รอจนเสร็จ')
  const sessionPath = accountSessionPath(accountId)
  if (!sessionPath || !accountSessionReady(accountId)) {
    throw new Error(`บัญชีที่เลือกยังไม่ได้ล็อกอิน หรือ session หมดอายุ — ไปที่ “โพสต์อัตโนมัติ > บัญชีโพสต์” แล้วกด “ล็อกอินใหม่”`)
  }

  const set = schedule.postSetId ? getSet(schedule.postSetId) : null
  if (!set) {
    updateSchedule(scheduleId, { status: 'failed' })
    throw new Error('ชุดโพสต์ถูกลบไปแล้ว — ไม่สามารถโพสต์ได้')
  }

  // Always sanitize at send time so legacy saved sets cannot leak floor data.
  const text = preparePostText(set.text || '')
  const imagePaths = (set.images || [])
    .map((img) => path.join(IMAGES_DIR, img.file))
    .filter((p) => fs.existsSync(p))

  // Bootstrap the per-account membership memory from existing posting
  // history, so known non-member groups are excluded immediately after an
  // upgrade/restart instead of requiring one more failed visit.
  const membershipHistory = listSchedules()
    .filter((item) => (item.accountId || 'primary') === accountId)
    .flatMap((item) => (item.results || []).map((result) => ({
      groupUrl: result.group,
      status: result.ok ? 'joined' : String(result.error || '').startsWith('กลุ่มกำลังรออนุมัติ') ? 'requested' : isNotMemberError(result.error) ? 'not_member' : 'unknown',
    })))
  saveGroupMemberships(accountId, membershipHistory)

  const configuredGroups = schedule.groups || []
  const allowedGroups = filterPostableGroups(accountId, eligibleGroups(configuredGroups))
  if (!allowedGroups.length) {
    // This validation happens before the browser is launched. Persist a
    // terminal result here as well; otherwise the automatic scheduler sees
    // the same schedule as `pending` and retries it in a tight loop forever.
    const error = configuredGroups.length
      ? 'ไม่มีกลุ่มเป้าหมายที่บัญชีนี้ยืนยันว่าเข้าร่วมแล้ว กรุณาตรวจสอบการเข้าร่วมกลุ่ม'
      : 'ยังไม่มีกลุ่มเป้าหมายที่ใช้โพสต์ได้'
    const at = new Date().toISOString()
    updateSchedule(scheduleId, {
      status: 'failed',
      results: configuredGroups.map((group) => ({ group, ok: false, error, at })),
      finishedAt: at,
    })
    throw new Error(error)
  }
  // Random mode posts to exactly one group successfully.  It keeps the other
  // candidates as fallbacks solely when the randomly picked group turns out
  // not to be joined; otherwise a queue can fail at random even though another
  // configured group is ready to accept the post.
  // Selected mode may post the same post to up to three chosen groups.
  const useSingleRandomGroup = schedule.groupMode === 'random'
  const groups = useSingleRandomGroup
    ? rotateGroupsForAccount(allowedGroups, accountId)
    : allowedGroups

  runningAccountIds.add(accountId)
  updateSchedule(scheduleId, { status: 'posting', results: [], lastRunAt: new Date().toISOString() })
  const results = []
  // This is deliberately advisory, not a hard stop: the operator may decide
  // to repost immediately. Normal scheduled batches still enforce their own
  // 30-minute minimum when they are created.
  const previousPost = listSchedules()
    .filter((schedule) => (schedule.accountId || 'primary') === accountId)
    .flatMap((s) => s.results || [])
    .filter((r) => r.ok && r.at)
    .map((r) => new Date(r.at).getTime())
    .filter(Number.isFinite)
    .reduce((latest, at) => Math.max(latest, at), 0)
  const remainingGap = Math.max(0, previousPost + 30 * 60_000 - Date.now())
  if (remainingGap > 0) {
    onStep(`⚠️ โพสต์ล่าสุดเมื่อไม่นานมานี้ (เหลือประมาณ ${Math.ceil(remainingGap / 60_000)} นาที) — ดำเนินการตามที่ยืนยัน`)
  }
  onStep(`เริ่มโพสต์ "${set.name}" → ${groups.length} กลุ่ม`)

  let { browser, context } = {}
  try {
    ;({ browser, context } = await launchContext(sessionPath))
    for (let i = 0; i < groups.length; i++) {
      const group = groups[i]
      onStep(`(${i + 1}/${groups.length}) ${groupLabel(group)}`)
      const res = await postToGroup(context, group, { text, imagePaths }, onStep)
      if (res.ok) saveGroupMembership(accountId, group, 'joined')
      else if (String(res.error || '').startsWith('กลุ่มกำลังรออนุมัติ')) saveGroupMembership(accountId, group, 'requested')
      else if (isNotMemberError(res.error)) saveGroupMembership(accountId, group, 'not_member')
      results.push({ group, ok: res.ok, pending: res.pending === true, error: res.error, postUrl: res.postUrl, verified: res.verified, at: new Date().toISOString() })
      updateSchedule(scheduleId, { results: [...results] })

      if (useSingleRandomGroup && res.ok) break
      if (useSingleRandomGroup && !shouldTryNextRandomGroup(res)) break

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
    const sessionExpired = results.some((result) => String(result.error || '').includes(SESSION_EXPIRED_MESSAGE))
    if (sessionExpired) {
      markAccountSessionExpired(accountId)
      onStep('🔒 หยุดคิวของบัญชีนี้แล้วจนกว่าจะล็อกอินใหม่')
    } else if (context) {
      // Keep Facebook's rotated cookies instead of discarding them with the
      // temporary posting context. This continuously renews every account
      // whenever it is used by the scheduler.
      await context.storageState({ path: sessionPath }).catch((error) => {
        onStep(`⚠️ บันทึก Session ล่าสุดไม่สำเร็จ: ${error.message}`)
      })
    }
    runningAccountIds.delete(accountId)
    const finalStatus = scheduleStatusForResults(results)
    updateSchedule(scheduleId, {
      status: finalStatus,
      results,
      finishedAt: new Date().toISOString(),
    })
    if (browser) await browser.close().catch(() => {})
    if (isOneTimePostComplete(schedule, results)) {
      const stillReserved = listSchedules().some((item) =>
        item.id !== scheduleId && item.postSetId === set.id && ['pending', 'posting'].includes(item.status))
      if (stillReserved) {
        onStep('📦 โพสต์สำเร็จแล้ว แต่ยังเก็บชุดไว้เพราะมีงานอื่นรอใช้')
      } else {
        try {
          deleteSet(set.id)
          removeAutoCampaignPostSets([set.id])
          onStep('🗑️ โพสต์สำเร็จแล้ว · ลบชุดโพสต์ออกจากรายการอัตโนมัติ')
        } catch (cleanupError) {
          onStep(`⚠️ โพสต์สำเร็จ แต่ลบชุดโพสต์ไม่สำเร็จ: ${cleanupError.message}`)
        }
      }
    }
  }
  onStep(`เสร็จสิ้น · สำเร็จ ${results.filter((r) => r.ok).length}/${results.length} กลุ่ม`)
  return results
}
