import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchBrowser, LOW_RESOURCE_INTERACTIVE_ARGS, reduceInteractiveContextLoad } from './browserLauncher.js'
import { parsePropertyHtml } from './propertyImporter.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SESSION_FILE = process.env.JSA_SESSION_PATH || path.join(__dirname, 'jsa-session.json')
let loginBrowser = null
let loginContext = null
let loginPage = null
let loginExpiryTimer = null
let lastRefreshedAt = null
let lastRefreshError = null

export function isJsaPropertyUrl(value) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && /(^|\.)jsa\.co\.th$/i.test(url.hostname)
      && /^\/admin\/property\/view\/\d+\/?$/i.test(url.pathname)
  } catch { return false }
}

export function jsaSessionStatus() {
  return { connected: fs.existsSync(SESSION_FILE), loginOpen: Boolean(loginBrowser), lastRefreshedAt, lastRefreshError }
}

function invalidateExpiredJsaSession() {
  // An expired cookie file cannot recover by retrying. Removing only this
  // unusable credential snapshot stops the one-minute browser retry loop and
  // makes the UI truthfully request a new login.
  try { fs.unlinkSync(SESSION_FILE) } catch { /* already absent */ }
}

export async function listJsaPropertyCandidates() {
  if (!fs.existsSync(SESSION_FILE)) throw new Error('กรุณาเชื่อมต่อและล็อกอิน JSA ก่อนนำเข้าประกาศ')
  const browser = await launchBrowser({ headless: true })
  try {
    const context = await browser.newContext({ storageState: SESSION_FILE, locale: 'th-TH', viewport: { width: 1440, height: 1000 } })
    const page = await context.newPage()
    await page.goto('https://www.jsa.co.th/admin/property', { waitUntil: 'domcontentloaded', timeout: 60_000 })
    // This React page keeps background requests open and can replace its page
    // during `networkidle`. Wait for the actual table instead.
    let tableReady = false
    for (let attempt = 0; attempt < 3 && !tableReady; attempt += 1) {
      try {
        await page.waitForSelector('a[href*="/admin/property/view/"]', { state: 'attached', timeout: 12_000 })
        tableReady = true
      } catch {
        if (attempt < 2) await page.reload({ waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => {})
      }
    }
    await page.waitForTimeout(2_000)
    const bodyText = await page.locator('body').innerText().catch(() => '')
    if (/login|sign-in/i.test(new URL(page.url()).pathname) || /เข้าสู่ระบบ|ลงชื่อเข้าใช้/i.test(bodyText.slice(0, 1500))) {
      invalidateExpiredJsaSession()
      throw new Error('Session JSA หมดอายุ กรุณาเชื่อมต่อ JSA ใหม่')
    }
    if (!tableReady) throw new Error('หน้า JSA ไม่แสดงรายการทรัพย์หลังลองใหม่ 3 ครั้ง ระบบจะลองอีกครั้งอัตโนมัติใน 1 นาที')
    const candidates = await page.evaluate(() => [...document.querySelectorAll('tbody tr')].map((row, order) => {
      const cells = [...row.querySelectorAll(':scope > td')]
      const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim()
      const detail = row.querySelector('a[href*="/admin/property/view/"]')
      const sourceUrl = detail ? new URL(detail.getAttribute('href'), location.origin).href : ''
      const pmCell = cells[12]
      const availableCell = cells[11]
      const approvalCell = cells[14]
      const imageCell = cells[15]
      const updatedTime = cells[16]?.querySelector('time')?.getAttribute('datetime') || ''
      const price = Number(clean(cells[8]?.innerText).replace(/[^\d.]/g, '')) || 0
      return {
        id: sourceUrl.match(/\/view\/(\d+)/)?.[1] || '',
        sourceUrl,
        ref: clean(cells[1]?.innerText),
        price,
        // JSA does not expose deal type in the list. Detail import verifies it;
        // this conservative threshold matches the portal's rental pricing.
        deal: price > 0 && price < 1_000_000 ? 'rent' : 'sale',
        available: /ว่าง|available/i.test(clean(availableCell?.innerText)) && /text-green|bg-green/.test(availableCell?.innerHTML || ''),
        pmApproved: /text-green|bg-green/.test(pmCell?.innerHTML || ''),
        approved: /อนุมัติแล้ว/i.test(clean(approvalCell?.innerText)) && /text-green|bg-green/.test(approvalCell?.innerHTML || ''),
        hasImages: /มีรูป/i.test(clean(imageCell?.innerText)) && /text-green|bg-green/.test(imageCell?.innerHTML || ''),
        updatedAt: updatedTime,
        order,
      }
    }).filter((item) => item.id && item.sourceUrl))
    await context.storageState({ path: SESSION_FILE })
    lastRefreshedAt = new Date().toISOString()
    lastRefreshError = null
    return candidates
  } finally {
    await browser.close()
  }
}

export async function refreshJsaSession() {
  if (!fs.existsSync(SESSION_FILE)) return { ...jsaSessionStatus(), skipped: 'not-connected' }
  const browser = await launchBrowser({ headless: true })
  try {
    const context = await browser.newContext({ storageState: SESSION_FILE, locale: 'th-TH', viewport: { width: 1280, height: 800 } })
    const page = await context.newPage()
    await page.goto('https://www.jsa.co.th/admin/property', { waitUntil: 'domcontentloaded', timeout: 60_000 })
    const bodyText = await page.locator('body').innerText().catch(() => '')
    if (/login|sign-in/i.test(new URL(page.url()).pathname) || /เข้าสู่ระบบ|ลงชื่อเข้าใช้/i.test(bodyText.slice(0, 1500))) {
      invalidateExpiredJsaSession()
      throw new Error('Session JSA หมดอายุ กรุณาเชื่อมต่อ JSA ใหม่')
    }
    await context.storageState({ path: SESSION_FILE })
    lastRefreshedAt = new Date().toISOString()
    lastRefreshError = null
    return jsaSessionStatus()
  } catch (error) {
    lastRefreshError = error.message || String(error)
    throw error
  } finally {
    await browser.close().catch(() => {})
  }
}

async function closeLoginBrowser() {
  if (loginExpiryTimer) clearTimeout(loginExpiryTimer)
  loginExpiryTimer = null
  try { await loginBrowser?.close() } catch { /* already closed */ }
  loginBrowser = null
  loginContext = null
  loginPage = null
}

export async function startJsaLogin(targetUrl = 'https://www.jsa.co.th/admin/property') {
  await closeLoginBrowser()
  loginBrowser = await launchBrowser({ headless: false, args: LOW_RESOURCE_INTERACTIVE_ARGS })
  loginContext = await loginBrowser.newContext({ locale: 'th-TH', viewport: { width: 1100, height: 760 }, serviceWorkers: 'block', reducedMotion: 'reduce' })
  await reduceInteractiveContextLoad(loginContext)
  loginPage = await loginContext.newPage()
  const safeTarget = isJsaPropertyUrl(targetUrl) ? targetUrl : 'https://www.jsa.co.th/admin/property'
  await loginPage.goto(safeTarget, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  loginExpiryTimer = setTimeout(() => closeLoginBrowser(), 15 * 60_000)
  loginExpiryTimer.unref()
  return jsaSessionStatus()
}

export async function finishJsaLogin() {
  if (!loginContext || !loginPage) throw new Error('ยังไม่ได้เปิดหน้าล็อกอิน JSA')
  const currentUrl = loginPage.url()
  const body = await loginPage.locator('body').innerText().catch(() => '')
  if (/login|sign-in/i.test(new URL(currentUrl).pathname) || /เข้าสู่ระบบ|ลงชื่อเข้าใช้/i.test(body)) {
    throw new Error('ยังไม่พบการเข้าสู่ระบบ กรุณาล็อกอินในหน้าต่าง JSA ให้สำเร็จก่อน')
  }
  await loginContext.storageState({ path: SESSION_FILE })
  await closeLoginBrowser()
  return jsaSessionStatus()
}

export async function disconnectJsaSession() {
  await closeLoginBrowser()
  try { fs.unlinkSync(SESSION_FILE) } catch { /* no saved session */ }
  return jsaSessionStatus()
}

function cleanAdminText(value = '') {
  const ignored = /^(Admin Portal|Home|ออกจากระบบ|การจัดการโครงการ|การจัดการสินทรัพย์|การจัดการดีลและข้อมูล)$/i
  return String(value).split('\n').map((line) => line.trim()).filter((line) => line && !ignored.test(line))
    .filter((line, index, all) => index === 0 || line !== all[index - 1]).join('\n').slice(0, 12_000)
}

function formatMoney(value) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number.toLocaleString('en-US', { maximumFractionDigits: 0 }) : '-'
}

function thaiPost(property) {
  const sale = property.deal === 'sale' || (property.deal !== 'rent' && Number(property.price || 0) >= 1_000_000)
  const bedroom = property.bedroom === 0 ? 'Studio' : `${property.bedroom || '-'} ห้องนอน`
  const lines = [
    `🔥 ${sale ? 'ขาย' : 'ให้เช่า'} ${property.project || 'ทรัพย์ JSA'} 🔥`,
    sale ? `💰 ราคาขาย ${formatMoney(property.price)} บาท` : `💰 ราคาเช่า ${formatMoney(property.price)} บาท/เดือน`,
    property.transit ? `🚆 ใกล้ ${property.transit}` : '',
    '',
    'รายละเอียดห้อง',
    `• ${bedroom}`,
    property.bathroom ? `• ${property.bathroom} ห้องน้ำ` : '',
    property.size ? `• ${property.size} ตร.ม.` : '',
    `• Ref No.: ${property.ref || '-'}`,
    '',
    '📩 สนใจนัดชมห้อง ติดต่อ Line หรือโทรเท่านั้น (ไม่เห็นแชท Facebook)',
    '📞 Tel: 064-542-5959 (Agent Duke)',
    '💬 Line: @duke.estate (Agent Duke)',
  ]
  return lines.filter((line, index) => line || lines[index - 1] !== '').join('\n').trim()
}

export async function importJsaProperty(sourceUrl) {
  if (!isJsaPropertyUrl(sourceUrl)) throw new Error('รองรับลิงก์รูปแบบ https://www.jsa.co.th/admin/property/view/เลขรหัส เท่านั้น')
  if (!fs.existsSync(SESSION_FILE)) throw new Error('กรุณาเชื่อมต่อและล็อกอิน JSA ก่อนนำเข้าประกาศ')
  const browser = await launchBrowser({ headless: true })
  try {
    const context = await browser.newContext({ storageState: SESSION_FILE, locale: 'th-TH', viewport: { width: 1440, height: 1200 } })
    const page = await context.newPage()
    await page.goto(sourceUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {})
    const currentUrl = page.url()
    const bodyText = await page.locator('body').innerText().catch(() => '')
    if (/login|sign-in/i.test(new URL(currentUrl).pathname) || /เข้าสู่ระบบ|ลงชื่อเข้าใช้/i.test(bodyText.slice(0, 1500))) {
      throw new Error('Session JSA หมดอายุ กรุณาเชื่อมต่อ JSA ใหม่')
    }
    const html = await page.content()
    const parsed = parsePropertyHtml(html, currentUrl)
    const dom = await page.evaluate(async () => {
      const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim()
      const normalize = (value) => clean(value).toLowerCase()
      const parseNumber = (value) => {
        const text = String(value || '').replace(/,/g, '')
        const million = text.match(/(\d+(?:\.\d+)?)\s*ล้าน/i)
        if (million) return Number(million[1]) * 1_000_000
        const match = text.match(/\d+(?:\.\d+)?/)
        return match ? Number(match[0]) : 0
      }
      const findValue = (labels) => {
        const targets = labels.map(normalize)
        for (const row of document.querySelectorAll('tr')) {
          const cells = [...row.querySelectorAll('th,td')]
          if (cells.length < 2) continue
          const first = normalize(cells[0].innerText || cells[0].textContent)
          if (targets.some((label) => first === label || first.includes(label))) {
            const candidate = cells.slice(1).map((cell) => clean(cell.innerText || cell.textContent)).filter(Boolean).join(' ')
            if (candidate) return candidate
          }
        }
        for (const node of document.querySelectorAll('label,dt,th,td,strong,b,span,div,p')) {
          const labelText = normalize(node.innerText || node.textContent)
          if (!labelText || labelText.length > 48 || !targets.some((label) => labelText === label)) continue
          const scope = node.parentElement
          if (!scope) continue
          const direct = [...scope.children].filter((child) => child !== node)
            .map((child) => clean(child.innerText || child.textContent))
            .filter((text) => text && normalize(text) !== labelText && text.length < 250).join(' ')
          if (direct) return direct
          let sibling = node.nextElementSibling
          for (let index = 0; sibling && index < 3; index += 1, sibling = sibling.nextElementSibling) {
            const text = clean(sibling.innerText || sibling.textContent)
            if (text && text.length < 250) return text
          }
        }
        return ''
      }
      const body = document.body?.innerText || ''
      const project = clean(findValue(['โครงการ'])) || [...document.querySelectorAll('h1,h2,h3')].map((node) => clean(node.innerText)).find((text) => text.length > 2 && text.length < 150) || ''
      const refRaw = findValue(['รหัสทรัพย์สิน', 'รหัสทรัพย์', 'เลขทรัพย์', 'reference']) || body.match(/[A-Z]{1,8}\s*-\s*\d{3,12}/)?.[0] || ''
      const ref = String(refRaw).toUpperCase().replace(/\s+/g, '').match(/[A-Z]{1,8}-\d{3,12}/)?.[0] || ''
      const dealRaw = findValue(['ประเภทดีล', 'ประเภทรายการ', 'ประเภทสัญญา', 'สถานะดีล'])
      const saleRaw = findValue(['ราคาขาย', 'ราคาขายรวม', 'ราคาขายสุทธิ'])
      const rentRaw = findValue(['ราคาเช่า', 'ค่าเช่า'])
      const genericRaw = findValue(['ราคา', 'ราคาเสนอ']) || body.match(/(?:฿\s*|ราคา\s*)([\d,]{4,})/)?.[1] || ''
      const saysSale = /ขาย|sale|ซื้อ/i.test(dealRaw)
      const saysRent = /เช่า|rent/i.test(dealRaw)
      const priceRaw = saysSale && parseNumber(saleRaw) ? saleRaw : saysRent && parseNumber(rentRaw) ? rentRaw : genericRaw || saleRaw || rentRaw
      const price = parseNumber(priceRaw)
      const property = {
        ref,
        project,
        propertyType: findValue(['ประเภทโครงการ', 'ประเภททรัพย์สิน', 'ประเภททรัพย์']),
        price,
        deal: saysSale && !saysRent ? 'sale' : saysRent && !saysSale ? 'rent' : price >= 1_000_000 ? 'sale' : 'rent',
        bedroom: /studio/i.test(findValue(['ห้องนอน', 'จำนวนห้องนอน'])) ? 0 : parseNumber(findValue(['ห้องนอน', 'จำนวนห้องนอน'])) || '',
        bathroom: parseNumber(findValue(['ห้องน้ำ', 'จำนวนห้องน้ำ'])) || '',
        size: parseNumber(findValue(['พื้นที่ใช้สอย', 'ขนาดพื้นที่', 'ขนาด', 'พื้นที่'])) || '',
        floor: parseNumber(findValue(['ชั้นที่', 'ชั้น'])) || '',
        transit: clean(findValue(['สถานีรถไฟฟ้า', 'BTS/MRT', 'สถานี'])),
      }
      const photoHeading = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6,div,span,strong,b,p')]
        .find((node) => normalize(node.innerText || node.textContent) === 'รูปภาพ')
      let scope = photoHeading?.parentElement || document.body
      if (photoHeading) {
        let best = scope
        for (let node = photoHeading.parentElement, level = 0; node && level < 10; node = node.parentElement, level += 1) {
          const count = node.querySelectorAll('img,[data-original],[data-full],[data-src],[data-lazy-src],[data-zoom-image]').length
          if (count >= 4) { best = node; break }
        }
        scope = best
      }
      const candidates = [...scope.querySelectorAll('img')]
      for (const image of candidates) {
        image.removeAttribute('loading')
        image.loading = 'eager'
        image.scrollIntoView({ block: 'center', behavior: 'instant' })
        await new Promise((resolve) => setTimeout(resolve, 70))
      }
      const images = candidates.map((image) => ({
        // Next.js may advertise a 3840px `src` that its optimizer rejects,
        // while `currentSrc` is the exact 1920px URL the browser loaded.
        src: image.getAttribute('data-original') || image.getAttribute('data-full') || image.getAttribute('data-src') || image.getAttribute('data-lazy-src') || image.getAttribute('data-zoom-image') || image.currentSrc || image.src,
        width: Math.max(image.naturalWidth || 0, image.getBoundingClientRect().width || 0),
        height: Math.max(image.naturalHeight || 0, image.getBoundingClientRect().height || 0),
        marker: `${image.alt || ''} ${image.className || ''} ${image.closest('[class]')?.className || ''}`,
      })).filter((image) => image.src && image.width >= 280 && image.height >= 180 && !/logo|icon|avatar|map|tile|marker|leaflet/i.test(image.marker) && !/googleapis|gstatic|openstreetmap|mapbox/i.test(image.src))
      return { property, images }
    })
    const propertyCode = sourceUrl.match(/\/view\/(\d+)/)?.[1] || ''
    const name = `${dom.property.deal === 'sale' ? 'ขาย' : 'ให้เช่า'} ${dom.property.project || `ทรัพย์ JSA ${propertyCode}`} · ${dom.property.ref || propertyCode}`
    const text = thaiPost(dom.property)
    const imageUrls = [...new Set([...dom.images.map((image) => image.src), ...parsed.imageUrls])].slice(0, 10)
    // Node's HTTP client cannot validate JSA's private certificate chain on
    // some Macs, even though Chrome has already loaded the same images. Fetch
    // through the authenticated page so it uses Chrome's system trust store,
    // cookies, referer and the exact browser session.
    const images = await page.evaluate(async ({ urls, maxEach, maxTotal }) => {
      // Fetch in parallel. Sequential 20-second timeouts could make a
      // 10-photo room block inventory refills for more than three minutes.
      const fetched = await Promise.all(urls.map(async (url) => {
        try {
          const response = await fetch(url, { credentials: 'include', signal: AbortSignal.timeout(10_000) })
          if (!response.ok) return null
          const blob = await response.blob()
          if (!blob.type.startsWith('image/') || blob.type === 'image/svg+xml' || blob.size > maxEach) return null
          const dataUrl = await new Promise((resolve, reject) => {
            const reader = new FileReader()
            reader.onload = () => resolve(reader.result)
            reader.onerror = reject
            reader.readAsDataURL(blob)
          })
          return { dataUrl, size: blob.size }
        } catch { return null }
      }))
      const output = []
      let total = 0
      for (const image of fetched) {
        if (!image || total + image.size > maxTotal) continue
        total += image.size
        output.push(image.dataUrl)
      }
      return output
    }, { urls: imageUrls, maxEach: 8 * 1024 * 1024, maxTotal: 35 * 1024 * 1024 })
    await context.storageState({ path: SESSION_FILE })
    lastRefreshedAt = new Date().toISOString()
    lastRefreshError = null
    return { sourceUrl: currentUrl, name, text, images, imageCount: images.length, deal: dom.property.deal }
  } finally {
    await browser.close()
  }
}

export async function resolveJsaPropertyUrlByCd(cd) {
  const code = String(cd || '').trim().toUpperCase()
  if (!/^CD-\d{6}$/.test(code)) { const error = new Error('invalid CD'); error.code = 'INVALID_CD'; throw error }
  if (!fs.existsSync(SESSION_FILE)) { const error = new Error('JSA login required'); error.code = 'JSA_LOGIN_REQUIRED'; throw error }
  const browser = await launchBrowser({ headless: true })
  try {
    const context = await browser.newContext({ storageState: SESSION_FILE, locale: 'th-TH' })
    const page = await context.newPage()
    const expired = async () => /login|sign-in/i.test(page.url()) || await page.locator('input[type="password"]').isVisible().catch(() => false)
    await page.goto('https://www.jsa.co.th/admin/property', { waitUntil: 'domcontentloaded', timeout: 30000 })
    if (await expired()) throw Object.assign(new Error('กรุณาเข้าสู่ระบบ JSA ใหม่'), { code: 'JSA_SESSION_EXPIRED' })
    // Like listJsaPropertyCandidates, wait for the React DOM, not networkidle.
    // Return only an unambiguous, editable code/search field; never guess the
    // first text input (JSA also has property-name, phone and price filters).
    let input
    try {
      const handle = await page.waitForFunction(() => {
        const visible = (node) => node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden'
        const fields = [...document.querySelectorAll('input')].filter((node) =>
          visible(node) && !node.disabled && !node.readOnly && /^(text|search)$/.test(node.type))
        const codePattern = /รหัสทรัพย์(?:สิน)?|property[\s_-]*code|(?:^|[\s_-])ref(?:erence)?(?:$|[\s_-])|^code$/i
        const ranked = fields.map((node) => {
          const metadata = [node.name, node.id, node.placeholder, node.getAttribute('aria-label')]
          const labels = [...(node.labels || [])].map((label) => label.innerText)
          for (const id of (node.getAttribute('aria-labelledby') || '').split(/\s+/)) {
            labels.push(document.getElementById(id)?.innerText || '')
          }
          let score = metadata.some((text) => codePattern.test(text || '')) ? 3 : labels.some((text) => codePattern.test(text)) ? 2 : 0
          // Unassociated labels commonly sit beside an input wrapper.
          for (let scope = node.parentElement, depth = 0; !score && scope && depth < 3; scope = scope.parentElement, depth += 1) {
            if (fields.filter((field) => scope.contains(field)).length !== 1) break
            if (codePattern.test(scope.innerText)) score = 1
          }
          // A generic search box is safe only if it is the sole searchable
          // field in its form and the form explicitly mentions property codes.
          const form = node.closest('form, [role="search"]')
          if (!score && form && /ค้นหา|search/i.test(metadata.join(' ')) && codePattern.test(form.innerText)
            && fields.filter((field) => form.contains(field)).length === 1) score = 1
          return { node, score }
        }).filter((item) => item.score).sort((a, b) => b.score - a.score)
        return ranked.length && (!ranked[1] || ranked[0].score > ranked[1].score) ? ranked[0].node : false
      }, undefined, { timeout: 15000 })
      input = handle.asElement()
    } catch (error) {
      if (error.name !== 'TimeoutError') throw error
      if (await expired()) throw Object.assign(new Error('กรุณาเข้าสู่ระบบ JSA ใหม่'), { code: 'JSA_SESSION_EXPIRED' })
      console.warn('[JSA CD resolver] search input not found', await page.evaluate(() => {
        const visible = (node) => node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden'
        return {
          url: location.origin + location.pathname,
          inputs: [...document.querySelectorAll('input')].filter(visible).map(({ name, id, placeholder, type }) => ({ name, id, placeholder, type })),
          buttons: [...document.querySelectorAll('button, [role="button"], input[type="submit"]')].filter(visible).map((node) => node.innerText || node.value || ''),
        }
      }))
      throw Object.assign(new Error('ไม่พบช่องค้นหารหัสทรัพย์ใน JSA'), { code: 'SEARCH_INPUT_NOT_FOUND' })
    }
    await input.fill(code)
    await input.dispatchEvent('input')
    await input.dispatchEvent('change')
    const search = page.getByRole('button', { name: /^(?:ค้นหา|search)$/i }).filter({ visible: true }).first()
    if (await search.count()) await search.click()
    else await input.press('Enter')
    await page.waitForFunction((wanted) => {
      if (/login|sign-in/i.test(location.href) || document.querySelector('input[type="password"]')) return true
      const text = document.body.innerText
      return [...document.querySelectorAll('tr')].some(row => (row.innerText.toUpperCase().match(/\bCD-\d{6}\b/g) || []).includes(wanted)) || /ไม่พบข้อมูล|ไม่พบรายการ|no matching records|no records found/i.test(text)
    }, code, { timeout: 15000 })
    if (await expired()) throw Object.assign(new Error('กรุณาเข้าสู่ระบบ JSA ใหม่'), { code: 'JSA_SESSION_EXPIRED' })
    const rows = await page.locator('tr').evaluateAll((nodes, wanted) => nodes.filter(node => (node.innerText.toUpperCase().match(/\bCD-\d{6}\b/g) || []).includes(wanted)).map(row => [...row.querySelectorAll('a[href]')].map(a => a.href).filter(url => { const parsed = new URL(url); return parsed.protocol === 'https:' && /(^|\.)jsa\.co\.th$/i.test(parsed.hostname) && /^\/admin\/property\/view\/\d+\/?$/.test(parsed.pathname) })), code)
    if (rows.length > 1) throw Object.assign(new Error(`พบหลายแถวสำหรับ ${code}`), { code: 'MULTIPLE_MATCH' })
    if (!rows.length) throw Object.assign(new Error(`ไม่พบ ${code} ในผลค้นหา JSA`), { code: 'CD_NOT_FOUND' })
    const links = [...new Set(rows[0])]
    if (!links.length) throw Object.assign(new Error(`ไม่พบลิงก์ดูทรัพย์ ${code}`), { code: 'VIEW_LINK_NOT_FOUND' })
    if (links.length > 1) throw Object.assign(new Error(`พบหลายลิงก์สำหรับ ${code}`), { code: 'MULTIPLE_MATCH' })
    return links[0]
  } catch (error) {
    if (error?.name === 'TimeoutError') error.code = 'TIMEOUT'
    throw error
  } finally { await browser.close() }
}
