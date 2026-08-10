import dns from 'node:dns/promises'
import net from 'node:net'

const MAX_HTML_BYTES = 3 * 1024 * 1024
const MAX_IMAGE_BYTES = 8 * 1024 * 1024
const MAX_IMAGES = 10
const MAX_TOTAL_IMAGE_BYTES = 35 * 1024 * 1024
const REQUEST_TIMEOUT_MS = 20_000

function decodeHtml(value = '') {
  const named = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' }
  return String(value)
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (match, name) => named[name.toLowerCase()] ?? match)
    .replace(/\s+/g, ' ')
    .trim()
}

function meta(html, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']*)["'][^>]*>`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${escaped}["'][^>]*>`, 'i'),
  ]
  return decodeHtml(patterns.map((pattern) => html.match(pattern)?.[1]).find(Boolean) || '')
}

function jsonLdObjects(html) {
  const objects = []
  const scripts = html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)
  for (const match of scripts) {
    try {
      const parsed = JSON.parse(match[1].trim())
      const visit = (value) => {
        if (!value) return
        if (Array.isArray(value)) return value.forEach(visit)
        if (typeof value !== 'object') return
        objects.push(value)
        if (value['@graph']) visit(value['@graph'])
      }
      visit(parsed)
    } catch {
      // Malformed analytics JSON-LD must not make an otherwise valid page fail.
    }
  }
  return objects
}

function absoluteUrl(value, baseUrl) {
  if (typeof value !== 'string' || !value.trim()) return ''
  try { return new URL(value, baseUrl).href }
  catch { return '' }
}

export function parsePropertyHtml(html, pageUrl) {
  const objects = jsonLdObjects(html)
  const property = objects.find((item) => {
    const types = Array.isArray(item['@type']) ? item['@type'] : [item['@type']]
    return types.some((type) => /Product|Offer|Residence|Apartment|House|SingleFamilyResidence|RealEstateListing/i.test(String(type || '')))
  }) || objects.find((item) => item.name || item.description) || {}
  const offer = Array.isArray(property.offers) ? property.offers[0] : property.offers || {}
  const title = meta(html, 'og:title') || decodeHtml(property.name) || meta(html, 'twitter:title')
    || decodeHtml(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '')
  const description = meta(html, 'og:description') || decodeHtml(property.description)
    || meta(html, 'description') || meta(html, 'twitter:description')
  const rawImages = [
    meta(html, 'og:image:secure_url'), meta(html, 'og:image'), meta(html, 'twitter:image'),
    ...(Array.isArray(property.image) ? property.image : [property.image]),
  ]
  for (const match of html.matchAll(/<meta[^>]+property=["']og:image(?::url)?["'][^>]+content=["']([^"']+)["']/gi)) rawImages.push(decodeHtml(match[1]))
  const images = [...new Set(rawImages.map((value) => typeof value === 'object' ? value?.url : value)
    .map((value) => absoluteUrl(value, pageUrl)).filter((value) => /^https?:\/\//i.test(value)))].slice(0, MAX_IMAGES)
  const price = offer.price || property.price
  const currency = offer.priceCurrency || property.priceCurrency || 'THB'
  const lines = [title, description]
  if (price && !description.includes(String(price))) {
    const formatted = Number.isFinite(Number(price)) ? Number(price).toLocaleString('th-TH') : price
    lines.push(`ราคา ${formatted} ${currency === 'THB' ? 'บาท' : currency}`)
  }
  lines.push(`ดูรายละเอียด: ${pageUrl}`)
  return { name: title || new URL(pageUrl).hostname, text: lines.filter(Boolean).join('\n\n'), imageUrls: images }
}

function isPrivateIp(address) {
  if (net.isIPv4(address)) {
    const parts = address.split('.').map(Number)
    return parts[0] === 10 || parts[0] === 127 || parts[0] === 0
      || (parts[0] === 169 && parts[1] === 254) || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
      || (parts[0] === 192 && parts[1] === 168) || parts[0] >= 224
  }
  if (net.isIPv6(address)) {
    const normalized = address.toLowerCase()
    return normalized === '::1' || normalized === '::' || normalized.startsWith('fc')
      || normalized.startsWith('fd') || normalized.startsWith('fe8') || normalized.startsWith('fe9')
      || normalized.startsWith('fea') || normalized.startsWith('feb')
  }
  return true
}

async function assertPublicUrl(value) {
  let url
  try { url = new URL(value) } catch { throw new Error('ลิงก์ไม่ถูกต้อง') }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('รองรับเฉพาะลิงก์ http หรือ https')
  if (url.username || url.password) throw new Error('ลิงก์ต้องไม่มีชื่อผู้ใช้หรือรหัสผ่าน')
  const records = await dns.lookup(url.hostname, { all: true })
  if (!records.length || records.some((record) => isPrivateIp(record.address))) {
    throw new Error('ไม่อนุญาตให้เข้าถึงที่อยู่ภายในระบบ')
  }
  return url
}

async function safeFetch(value, accept, maxBytes) {
  let url = await assertPublicUrl(value)
  for (let redirects = 0; redirects <= 5; redirects += 1) {
    const response = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: { Accept: accept, 'User-Agent': 'DukeEstateImporter/1.0' },
    })
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location')
      if (!location) throw new Error('เว็บไซต์ส่งต่อโดยไม่มีปลายทาง')
      url = await assertPublicUrl(new URL(location, url).href)
      continue
    }
    if (!response.ok) throw new Error(`เว็บไซต์ตอบกลับ ${response.status}`)
    const declared = Number(response.headers.get('content-length'))
    if (declared > maxBytes) throw new Error('ข้อมูลจากลิงก์มีขนาดใหญ่เกินกำหนด')
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.byteLength > maxBytes) throw new Error('ข้อมูลจากลิงก์มีขนาดใหญ่เกินกำหนด')
    return { response, bytes, finalUrl: url.href }
  }
  throw new Error('ลิงก์ส่งต่อหลายครั้งเกินไป')
}

export async function importPropertyUrl(sourceUrl) {
  const page = await safeFetch(sourceUrl, 'text/html,application/xhtml+xml', MAX_HTML_BYTES)
  const contentType = page.response.headers.get('content-type') || ''
  if (!/text\/html|application\/xhtml\+xml/i.test(contentType)) throw new Error('ลิงก์นี้ไม่ใช่หน้าเว็บไซต์ HTML')
  const parsed = parsePropertyHtml(new TextDecoder().decode(page.bytes), page.finalUrl)
  if (!parsed.name && !parsed.text) throw new Error('ไม่พบรายละเอียดประกาศในหน้านี้')
  const images = []
  let totalBytes = 0
  for (const imageUrl of parsed.imageUrls) {
    try {
      const image = await safeFetch(imageUrl, 'image/*', MAX_IMAGE_BYTES)
      const type = (image.response.headers.get('content-type') || '').split(';')[0].toLowerCase()
      if (!type.startsWith('image/') || type === 'image/svg+xml') continue
      totalBytes += image.bytes.byteLength
      if (totalBytes > MAX_TOTAL_IMAGE_BYTES) break
      images.push(`data:${type};base64,${Buffer.from(image.bytes).toString('base64')}`)
    } catch {
      // A broken gallery image should not discard the usable text and images.
    }
  }
  return { sourceUrl: page.finalUrl, name: parsed.name, text: parsed.text, images, imageCount: images.length }
}
