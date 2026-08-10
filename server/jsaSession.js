import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchBrowser } from './browserLauncher.js'
import { parsePropertyHtml } from './propertyImporter.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SESSION_FILE = process.env.JSA_SESSION_PATH || path.join(__dirname, 'jsa-session.json')
let loginBrowser = null
let loginContext = null
let loginPage = null

export function isJsaPropertyUrl(value) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && /(^|\.)jsa\.co\.th$/i.test(url.hostname)
      && /^\/admin\/property\/view\/\d+\/?$/i.test(url.pathname)
  } catch { return false }
}

export function jsaSessionStatus() {
  return { connected: fs.existsSync(SESSION_FILE), loginOpen: Boolean(loginBrowser) }
}

async function closeLoginBrowser() {
  try { await loginBrowser?.close() } catch { /* already closed */ }
  loginBrowser = null
  loginContext = null
  loginPage = null
}

export async function startJsaLogin(targetUrl = 'https://www.jsa.co.th/admin/property') {
  await closeLoginBrowser()
  loginBrowser = await launchBrowser({ headless: false })
  loginContext = await loginBrowser.newContext({ locale: 'th-TH', viewport: { width: 1440, height: 960 } })
  loginPage = await loginContext.newPage()
  const safeTarget = isJsaPropertyUrl(targetUrl) ? targetUrl : 'https://www.jsa.co.th/admin/property'
  await loginPage.goto(safeTarget, { waitUntil: 'domcontentloaded', timeout: 60_000 })
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
    await page.goto(sourceUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 })
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {})
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
      const output = []
      let total = 0
      for (const url of urls) {
        try {
          const response = await fetch(url, { credentials: 'include', signal: AbortSignal.timeout(20_000) })
          if (!response.ok) continue
          const blob = await response.blob()
          if (!blob.type.startsWith('image/') || blob.type === 'image/svg+xml' || blob.size > maxEach || total + blob.size > maxTotal) continue
          const dataUrl = await new Promise((resolve, reject) => {
            const reader = new FileReader()
            reader.onload = () => resolve(reader.result)
            reader.onerror = reject
            reader.readAsDataURL(blob)
          })
          total += blob.size
          output.push(dataUrl)
        } catch { /* skip individual broken images */ }
      }
      return output
    }, { urls: imageUrls, maxEach: 8 * 1024 * 1024, maxTotal: 35 * 1024 * 1024 })
    return { sourceUrl: currentUrl, name, text, images, imageCount: images.length }
  } finally {
    await browser.close()
  }
}
