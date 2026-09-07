import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { clearTimeout, setTimeout } from 'node:timers'
import { fileURLToPath } from 'node:url'
import { launchBrowser, LOW_RESOURCE_INTERACTIVE_ARGS, reduceInteractiveContextLoad } from './browserLauncher.js'
import { detectGroupMembership, normalizeFacebookGroupUrl } from './groupMembership.js'
import { saveGroupMembership } from './groupMembershipStore.js'

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'autopost')
const file = path.join(dir, 'accounts.json')
const primarySession = process.env.FB_SESSION_PATH || path.join(path.dirname(fileURLToPath(import.meta.url)), 'fb-session.json')
const pending = new Map()
const pendingMembership = new Map()
// The public-group login overlay can return to the same guest modal after a
// successful-looking login. Use Facebook's dedicated login route and send the
// completed flow to /me so both the operator and status poller get an
// unambiguous authenticated page.
const LOGIN_ENTRY_URL = 'https://www.facebook.com/login/?next=%2Fme%2F'
const SESSION_CHECK_URL = 'https://www.facebook.com/me/'
const SESSION_CHECK_TTL_MS = 60 * 1000
const verificationCache = new Map()

function clearPendingLogin(id, item) {
  if (pending.get(id) === item) pending.delete(id)
  if (item?.expiryTimer) clearTimeout(item.expiryTimer)
}

function pendingLoginIsClosed(item) {
  return !item.browser.isConnected() || item.page.isClosed()
}

function hasFacebookUser(cookies) {
  return cookies.some(
    (cookie) => cookie.name === 'c_user' && /(^|\.)facebook\.com$/i.test(cookie.domain),
  )
}

export function sessionExpiryFromCookies(cookies = []) {
  const expiries = cookies
    .filter((cookie) => ['c_user', 'xs'].includes(cookie.name) && /(^|\.)facebook\.com$/i.test(cookie.domain || ''))
    .map((cookie) => Number(cookie.expires))
    .filter((expires) => Number.isFinite(expires) && expires > 0)
  return expiries.length ? new Date(Math.min(...expiries) * 1000).toISOString() : null
}

function sessionExpiryFromFile(sessionPath) {
  try { return sessionExpiryFromCookies(JSON.parse(fs.readFileSync(sessionPath, 'utf8')).cookies || []) }
  catch { return null }
}

export function evaluateFacebookSession({ cookies = [], url = '', loginFormVisible = false, responseStatus = 200 } = {}) {
  const hasUser = hasFacebookUser(cookies)
  const authRedirect = /\/(?:login|checkpoint|recover)(?:\/|[?#]|$)/i.test(url)
  if (!hasUser || loginFormVisible || authRedirect) {
    return {
      ready: false,
      sessionStatus: 'expired',
      statusReason: authRedirect
        ? 'Facebook ส่งไปหน้าเข้าสู่ระบบหรือยืนยันตัวตน'
        : 'Facebook ไม่ยอมรับ Session นี้แล้ว',
    }
  }
  if (responseStatus >= 500) {
    return {
      ready: false,
      sessionStatus: 'unknown',
      statusReason: `Facebook ตอบกลับ ${responseStatus}`,
    }
  }
  return {
    ready: true,
    sessionStatus: 'ready',
    statusReason: 'ตรวจสอบกับ Facebook สำเร็จ',
  }
}

function sessionFileLooksUsable(sessionPath) {
  if (!sessionPath || !fs.existsSync(sessionPath)) return false
  try {
    const state = JSON.parse(fs.readFileSync(sessionPath, 'utf8'))
    const userCookie = (state.cookies || []).find(
      (cookie) => cookie.name === 'c_user' && /(^|\.)facebook\.com$/i.test(cookie.domain),
    )
    if (!userCookie) return false
    return !Number.isFinite(userCookie.expires)
      || userCookie.expires <= 0
      || userCookie.expires * 1000 > Date.now()
  } catch {
    return false
  }
}

function read() {
  let saved = []
  try { saved = JSON.parse(fs.readFileSync(file, 'utf8')) } catch { /* first run */ }
  const savedPrimary = saved.find((item) => item.id === 'primary')
  const primary = {
    id: 'primary',
    name: savedPrimary?.name || 'บัญชีหลัก',
    sessionPath: primarySession,
    invalidAt: savedPrimary?.invalidAt || null,
    ready: !savedPrimary?.invalidAt && sessionFileLooksUsable(primarySession),
    createdAt: savedPrimary?.createdAt,
  }
  return [primary, ...saved.filter((item) => item.id !== 'primary').map((item) => ({
    ...item,
    ready: !item.invalidAt && sessionFileLooksUsable(item.sessionPath),
  }))]
}

function write(accounts) {
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(file, JSON.stringify(accounts.map((item) => item.id === 'primary'
    ? { id: item.id, name: item.name, createdAt: item.createdAt, invalidAt: item.invalidAt || undefined }
    : {
        id: item.id,
        name: item.name,
        sessionPath: item.sessionPath,
        createdAt: item.createdAt,
        invalidAt: item.invalidAt || undefined,
      }), null, 2))
}

export function listAccounts() {
  return read().map((item) => ({
    id: item.id,
    name: item.name,
    ready: item.ready,
    sessionStatus: item.ready ? 'ready' : item.invalidAt ? 'expired' : 'missing',
    createdAt: item.createdAt,
  }))
}

async function verifyStoredSession(browser, account) {
  if (!account.sessionPath || !sessionFileLooksUsable(account.sessionPath)) {
    return {
      ready: false,
      sessionStatus: account.invalidAt ? 'expired' : 'missing',
      statusReason: account.invalidAt ? 'Facebook แจ้งว่า Session หมดอายุ' : 'ไม่พบ Session ที่ใช้งานได้',
    }
  }
  let context
  try {
    context = await browser.newContext({
      storageState: account.sessionPath,
      locale: 'th-TH',
      viewport: { width: 1100, height: 760 },
    })
    const page = await context.newPage()
    const response = await page.goto(SESSION_CHECK_URL, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    })
    await page.waitForTimeout(500)
    const cookies = await context.cookies('https://www.facebook.com')
    const url = page.url()
    const loginFormVisible = await page.locator('input[name="email"], input[name="pass"]').first()
      .isVisible().catch(() => false)
    const verification = evaluateFacebookSession({
      cookies,
      url,
      loginFormVisible,
      responseStatus: response?.status() || 200,
    })
    // Facebook regularly rotates/extends authentication cookies while an
    // authenticated page is being used. Persist those refreshed values for
    // every account; otherwise the next browser starts from the older cookie
    // snapshot and the session expires much sooner than it should.
    if (verification.ready) {
      await context.storageState({ path: account.sessionPath })
    }
    return { ...verification, sessionExpiresAt: sessionExpiryFromCookies(cookies) }
  } finally {
    await context?.close().catch(() => {})
  }
}

export async function listAccountsVerified({ force = false } = {}) {
  const accounts = read()
  const checkedAt = new Date().toISOString()
  const needsBrowser = accounts.some((account) => {
    const cached = verificationCache.get(account.id)
    return sessionFileLooksUsable(account.sessionPath)
      && !account.invalidAt
      && (force || !cached || Date.now() - cached.checkedAtMs >= SESSION_CHECK_TTL_MS)
  })
  let browser = null
  if (needsBrowser) {
    try {
      browser = await launchBrowser({
        headless: true,
        args: ['--disable-blink-features=AutomationControlled'],
      })
    } catch (error) {
      const reason = `ตรวจสอบ Facebook ไม่สำเร็จ: ${error.message}`
      return accounts.map((account) => ({
        id: account.id,
        name: account.name,
        ready: false,
        sessionStatus: 'unknown',
        statusReason: reason,
        lastCheckedAt: checkedAt,
        createdAt: account.createdAt,
      }))
    }
  }
  try {
    const results = []
    for (const account of accounts) {
      const cached = verificationCache.get(account.id)
      let verification
      if (!force && cached && Date.now() - cached.checkedAtMs < SESSION_CHECK_TTL_MS) {
        verification = cached.result
      } else if (!sessionFileLooksUsable(account.sessionPath) || account.invalidAt) {
        verification = {
          ready: false,
          sessionStatus: account.invalidAt ? 'expired' : 'missing',
          statusReason: account.invalidAt ? 'Facebook แจ้งว่า Session หมดอายุ' : 'ไม่พบ Session ที่ใช้งานได้',
        }
      } else {
        try {
          verification = await verifyStoredSession(browser, account)
        } catch (error) {
          verification = {
            ready: false,
            sessionStatus: 'unknown',
            statusReason: `ตรวจสอบ Facebook ไม่สำเร็จ: ${error.message}`,
          }
        }
      }
      verificationCache.set(account.id, {
        checkedAtMs: Date.now(),
        result: verification,
      })
      if (verification.sessionStatus === 'expired' && !account.invalidAt) {
        markAccountSessionExpired(account.id)
      }
      results.push({
        id: account.id,
        name: account.name,
        ...verification,
        sessionExpiresAt: verification.sessionExpiresAt || sessionExpiryFromFile(account.sessionPath),
        lastCheckedAt: checkedAt,
        createdAt: account.createdAt,
      })
    }
    return results
  } finally {
    await browser?.close().catch(() => {})
  }
}


export function accountSessionPath(id = 'primary') {
  return read().find((item) => item.id === id)?.sessionPath || null
}

export function accountSessionReady(id = 'primary') {
  return Boolean(read().find((item) => item.id === id)?.ready)
}

export function markAccountSessionExpired(id = 'primary') {
  const accounts = read()
  const account = accounts.find((item) => item.id === id)
  if (!account) return false
  account.invalidAt = new Date().toISOString()
  account.ready = false
  write(accounts)
  verificationCache.delete(id)
  return true
}

export function renameAccount(id, name) {
  const cleanName = String(name || '').trim()
  if (!cleanName) throw new Error('กรุณาใส่ชื่อบัญชี')
  if (cleanName.length > 80) throw new Error('ชื่อบัญชียาวเกินไป')
  const accounts = read()
  const account = accounts.find((item) => item.id === id)
  if (!account) throw new Error('ไม่พบบัญชีนี้')
  account.name = cleanName
  write(accounts)
  return listAccounts().find((item) => item.id === id)
}

export async function startAccountLogin(name, existingId = null) {
  const existing = existingId ? read().find((item) => item.id === existingId) : null
  if (existingId && !existing) throw new Error('ไม่พบบัญชีที่ต้องการล็อกอินใหม่')
  const id = existing?.id || `acc_${Date.now()}`
  const previous = pending.get(id)
  if (previous && pendingLoginIsClosed(previous)) clearPendingLogin(id, previous)
  if (pending.has(id)) throw new Error('บัญชีนี้มีหน้าต่างล็อกอินเปิดอยู่แล้ว')
  const sessionPath = existing?.sessionPath || path.join(dir, `session-${id}.json`)
  let browser
  try {
    browser = await launchBrowser({ headless: false, args: LOW_RESOURCE_INTERACTIVE_ARGS })
    const context = await browser.newContext({
      viewport: { width: 1100, height: 760 },
      locale: 'th-TH',
      serviceWorkers: 'block',
      reducedMotion: 'reduce',
    })
    await reduceInteractiveContextLoad(context)
    await context.addInitScript(() => {
      Object.defineProperty(globalThis.navigator, 'webdriver', { get: () => undefined })
      Object.defineProperty(globalThis.navigator, 'languages', { get: () => ['th-TH', 'th', 'en'] })
    })
    const page = await context.newPage()
    await page.goto(LOGIN_ENTRY_URL, { waitUntil: 'domcontentloaded', timeout: 60000 })

    const account = {
      id,
      name: String(name || '').trim() || existing?.name || `บัญชี ${read().length + 1}`,
      sessionPath,
      createdAt: existing?.createdAt,
    }
    const item = {
      browser,
      context,
      page,
      account,
      qrOpened: false,
      reauth: Boolean(existing),
      startedAt: new Date().toISOString(),
    }
    item.expiryTimer = setTimeout(() => browser.close().catch(() => {}), 15 * 60_000)
    item.expiryTimer.unref()
    pending.set(id, item)
    browser.once('disconnected', () => clearPendingLogin(id, item))
    page.once('close', () => clearPendingLogin(id, item))
    return { id, name: account.name, qrOpened: false, reauth: Boolean(existing) }
  } catch (error) {
    await browser?.close().catch(() => {})
    throw error
  }
}

export function interactiveAccountBrowserOpen() {
  return pending.size > 0 || pendingMembership.size > 0
}

export async function accountLoginStatus(id) {
  const item = pending.get(id)
  if (!item) return { active: false, loggedIn: false, message: 'หน้าต่างล็อกอินสิ้นสุดแล้ว' }
  if (pendingLoginIsClosed(item)) {
    clearPendingLogin(id, item)
    return { active: false, loggedIn: false, message: 'หน้าต่าง Facebook ถูกปิด กรุณาเริ่มใหม่' }
  }
  let cookies
  try {
    cookies = await item.context.cookies()
  } catch (error) {
    if (pendingLoginIsClosed(item)) {
      clearPendingLogin(id, item)
      return { active: false, loggedIn: false, message: 'หน้าต่าง Facebook ถูกปิด กรุณาเริ่มใหม่' }
    }
    throw error
  }
  const loggedIn = hasFacebookUser(cookies)
    && !/\/login|\/checkpoint|\/recover/i.test(item.page.url())
  return {
    active: true,
    loggedIn,
    qrOpened: item.qrOpened,
    message: loggedIn
      ? 'เข้าสู่ระบบแล้ว ตรวจโปรไฟล์ในหน้าต่าง Facebook ก่อนบันทึก'
      : item.qrOpened
        ? 'รอการสแกน QR และอนุมัติจากมือถือ'
        : 'หน้านี้ไม่มี QR กรุณาใช้เบอร์โทร/อีเมลและยืนยันผ่านมือถือ',
  }
}

export async function finishAccountLogin(id) {
  const item = pending.get(id)
  if (!item) throw new Error('ไม่พบหน้าต่างล็อกอินนี้ กรุณาเริ่มใหม่')
  const cookies = await item.context.cookies()
  if (!hasFacebookUser(cookies) || /\/login|\/checkpoint|\/recover/i.test(item.page.url())) {
    throw new Error('ยังล็อกอินไม่สำเร็จ กรุณาล็อกอิน Facebook ในหน้าต่างที่เปิดอยู่ก่อน')
  }
  await item.context.storageState({ path: item.account.sessionPath })
  await item.browser.close()
  pending.delete(id)
  const accounts = read()
  const existingIndex = accounts.findIndex((account) => account.id === id)
  const savedAccount = {
    ...item.account,
    createdAt: item.account.createdAt || new Date().toISOString(),
    invalidAt: null,
  }
  if (existingIndex >= 0) accounts[existingIndex] = savedAccount
  else accounts.push(savedAccount)
  write(accounts)
  verificationCache.delete(id)
  return listAccounts().find((account) => account.id === id)
}

export async function cancelAccountLogin(id) {
  const item = pending.get(id)
  if (item) await item.browser.close().catch(() => {})
  pending.delete(id)
}

export async function startGroupMembership(id, groupUrl) {
  const account = read().find((item) => item.id === id)
  if (!account?.ready) throw new Error('บัญชีนี้ยังไม่มี session Facebook ที่พร้อมใช้')
  if (pendingMembership.has(id)) throw new Error('บัญชีนี้มีหน้าต่างจัดการกลุ่มเปิดอยู่แล้ว')
  const url = normalizeFacebookGroupUrl(groupUrl)
  let browser
  try {
    browser = await launchBrowser({ headless: false })
    const context = await browser.newContext({ storageState: account.sessionPath, viewport: { width: 1280, height: 900 }, locale: 'th-TH' })
    await context.addInitScript(() => { Object.defineProperty(globalThis.navigator, 'webdriver', { get: () => undefined }) })
    const page = await context.newPage()
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await page.waitForTimeout(1500)
    pendingMembership.set(id, { browser, context, page, account, url })
    return { active: true, accountId: id, groupUrl: url, membership: await detectGroupMembership(page) }
  } catch (error) {
    await browser?.close().catch(() => {})
    throw error
  }
}

export async function groupMembershipStatus(id) {
  const item = pendingMembership.get(id)
  if (!item || item.page.isClosed()) return { active: false, membership: 'unknown' }
  return { active: true, accountId: id, groupUrl: item.url, membership: await detectGroupMembership(item.page) }
}

export async function finishGroupMembership(id) {
  const item = pendingMembership.get(id)
  if (!item) throw new Error('ไม่พบหน้าต่าง Facebook กรุณากดเปิดกลุ่มใหม่')
  if (item.page.isClosed()) {
    pendingMembership.delete(id)
    throw new Error('หน้าต่าง Facebook ถูกปิดแล้ว กรุณาเปิดใหม่')
  }
  const membership = await detectGroupMembership(item.page).catch(() => 'unknown')
  saveGroupMembership(id, item.url, membership)
  await item.context.storageState({ path: item.account.sessionPath })
  await item.browser.close().catch(() => {})
  pendingMembership.delete(id)
  return { active: false, accountId: id, groupUrl: item.url, membership }
}

export async function cancelGroupMembership(id) {
  const item = pendingMembership.get(id)
  if (item) await item.browser.close().catch(() => {})
  pendingMembership.delete(id)
}

export function removeAccount(id) {
  if (id === 'primary') throw new Error('ลบบัญชีหลักไม่ได้')
  const account = read().find((item) => item.id === id)
  if (!account) return false
  if (fs.existsSync(account.sessionPath)) fs.unlinkSync(account.sessionPath)
  write(read().filter((item) => item.id !== id))
  verificationCache.delete(id)
  return true
}
