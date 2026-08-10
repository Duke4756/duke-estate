// Local owner-listing database. It grows as live searches complete and is
// deliberately stored on this machine, so no Facebook data is sent elsewhere.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FILE = path.join(__dirname, 'owner-posts.json')

function read() {
  try {
    const data = JSON.parse(fs.readFileSync(FILE, 'utf8'))
    return Array.isArray(data.posts) ? data.posts : []
  } catch {
    return []
  }
}

function write(posts) {
  fs.writeFileSync(FILE, JSON.stringify({ updatedAt: new Date().toISOString(), posts }, null, 2))
}

function identity(post) {
  return post.permalink || post.id || `${post.author || ''}|${post.text || ''}`.slice(0, 1000)
}

function cleanProject(raw) {
  if (!raw) return null
  const value = raw
    .replace(/\s*\.{2,}\s*ดูเพิ่มเติม.*$/i, '')
    .replace(/^[\s:|•\-–—]+|[\s:|•\-–—]+$/g, '')
    .replace(/\s+(?:ราคา(?:เช่า)?|ค่าเช่า|rent(?:al)?|for rent|฿|\d[\d,]*\s*(?:บาท|baht|thb|\/เดือน|\/month)).*$/i, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
  if (!value || value.length < 3 || value.length > 90) return null
  if (/^(?:for rent|ให้เช่า|owner post|available|ว่าง|ราคา|ค่าเช่า|\d[\d,\s]*(?:บาท|baht|thb)?)/i.test(value)) return null
  return value
}

function findProject(text) {
  const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean)
  const labelled = text.match(/(?:โครงการ|project)\s*[:：]\s*([^\n|•]{2,90})/i)?.[1]
  if (cleanProject(labelled)) return cleanProject(labelled)

  // Most Facebook listings put the project on its own line after “For Rent”
  // or “ให้เช่า”. Prefer a line that looks like a property name and reject
  // price/specification-only lines.
  const likelyLine = lines.find((line) =>
    !/(?:ราคา|ค่าเช่า|฿|\b\d[\d,]*\s*(?:บาท|baht|thb)|ห้องนอน|bed(?:room)?|ตร\.?(?:ม\.)?|sqm|โทร|line\b)/i.test(line)
      && /(?:คอนโด|condo|noble|aspire|life\b|lumpini|plum|belle|parkland|ide[oa]|the |บ้านกลางเมือง|หมู่บ้าน|classe|สุขุมวิท|ratchada|ลาดพร้าว|onnut|rama)/i.test(line),
  )
  if (cleanProject(likelyLine)) return cleanProject(likelyLine.replace(/^(?:ให้เช่า|for rent)\s*/i, ''))

  const afterOffer = text.match(/(?:ให้เช่า(?:คอนโด|บ้าน)?|for rent)\s*[:：|\-–—]?\s*([^\n|]{3,100})/i)?.[1]
  if (cleanProject(afterOffer)) return cleanProject(afterOffer)

  const hashtag = text.match(/#\s*([A-Za-zก-๙][A-Za-zก-๙0-9\- ]{3,60})/)?.[1]
  if (cleanProject(hashtag)) return cleanProject(hashtag)

  const condo = text.match(/(?:คอนโด|condo(?:minium)?)\s*([^\n|]{3,90})/i)?.[1]
  return cleanProject(condo && `คอนโด ${condo}`)
}

// A no-cost first pass for the listing fields. Gemini classification (when a
// free Gemini key is configured) still decides the category; these rules keep
// the saved database useful even when the key is unavailable.
function listingDetails(lead) {
  const text = String(lead.text || '')
  const one = (re) => text.match(re)?.[1]?.trim() || null
  const bedrooms = /\bstudio\b|สตูดิโอ/i.test(text)
    ? 'Studio'
    : one(/(\d+)\s*(?:ห้องนอน|bed(?:room)?s?)/i)?.replace(/^/, '')
  const size = one(/(\d+(?:\.\d+)?)\s*(?:ตร\.?\s*ม\.?|ตรม\.?|sqm|sq\.?\s*m\.?|m²)/i)
  const priceCandidate = one(/(?:ราคา(?:เช่า)?|ค่าเช่า|rent(?:al)?(?:\s*price)?|for rent[^\n]{0,40}?)\s*[:@=]?\s*(฿?\s*\d[\d,]*(?:\s*(?:บาท|baht|thb|k))?(?:\s*\/?\s*(?:เดือน|month|mth))?)/i)
    || one(/(฿\s*\d[\d,]*(?:\s*\/?\s*(?:เดือน|month))?)/i)
  const price = Number(String(priceCandidate || '').replace(/\D/g, '')) >= 1000 ? priceCandidate : null
  const bts = one(/\b((?:BTS|MRT|Airport Rail Link)\s*[-:–]?\s*[A-Za-zก-๙0-9\- ]{2,40})/i)
  const project = findProject(text)
  const petAllowed = /(?:เลี้ยงสัตว์ได้|รับสัตว์เลี้ยง|pet[- ]?friendly|pets? allowed)/i.test(text)
    ? 'ได้'
    : /(?:ไม่(?:รับ|อนุญาต).*สัตว์|ห้ามเลี้ยงสัตว์|no pets?|pets? not allowed)/i.test(text)
      ? 'ไม่ได้'
      : 'ไม่ระบุ'
  const location = bts || one(/(?:ย่าน|โซน|ทำเล|ใกล้)\s*[:：]?\s*([^\n|•]{2,60})/i) || lead.extracted?.location || null
  return {
    project: project || null,
    price: price || lead.extracted?.budget || null,
    location,
    bedrooms: bedrooms ? (bedrooms === 'Studio' ? bedrooms : `${bedrooms} ห้องนอน`) : null,
    size: size ? `${size} ตร.ม.` : null,
    petAllowed,
    contact: lead.extracted?.contact || one(/(?:line|โทร|tel|phone)\s*[:：]?\s*([^\s\n,]{3,50})/i) || one(/(0\d[\d\-\s]{7,})/) || null,
    source: lead.category === 'owner' ? 'AI/Keyword: owner' : 'ตรวจพบประกาศเช่า',
  }
}

function isRentalListing(lead) {
  const text = String(lead.text || '')
  return lead.category === 'owner' || /(?:ปล่อยเช่า|ให้เช่า|ว่างให้เช่า|for rent|available for rent|#forrent|#ให้เช่า|#ปล่อยเช่า|ราคาเช่า|ค่าเช่า)/i.test(text)
}

export function saveOwnerPosts(leads) {
  const existing = read()
  const byIdentity = new Map(existing.map((post) => [post.identity, post]))
  const savedAt = new Date().toISOString()
  let added = 0

  for (const lead of leads.filter(isRentalListing)) {
    const key = identity(lead)
    if (!key) continue
    const previous = byIdentity.get(key)
    const post = {
      identity: key,
      id: lead.id || previous?.id || key,
      author: lead.author || '',
      group: lead.group || '',
      text: lead.text || '',
      createdAt: lead.createdAt || '',
      permalink: lead.permalink || '',
      reason: lead.reason || '',
      extracted: { ...(lead.extracted || {}), ...listingDetails(lead) },
      firstSavedAt: previous?.firstSavedAt || savedAt,
      lastSeenAt: savedAt,
      seenCount: (previous?.seenCount || 0) + 1,
    }
    if (!previous) added += 1
    byIdentity.set(key, post)
  }

  const posts = [...byIdentity.values()].sort((a, b) =>
    new Date(b.lastSeenAt) - new Date(a.lastSeenAt),
  )
  write(posts)
  return { added, total: posts.length }
}

export function listOwnerPosts() {
  // Re-derive fields at read time so existing saved listings gain improved
  // project/price parsing without requiring users to scrape Facebook again.
  return read()
    .map((post) => ({ ...post, extracted: { ...(post.extracted || {}), ...listingDetails(post) } }))
    .sort((a, b) => new Date(b.lastSeenAt) - new Date(a.lastSeenAt))
}

export function queryOwnerPosts(options = {}) {
  const page = Math.max(1, Number(options.page) || 1)
  const pageSize = Math.min(100, Math.max(10, Number(options.pageSize) || 30))
  const query = String(options.query || '').trim().toLowerCase()
  const project = String(options.project || '').trim().toLowerCase()
  const location = String(options.location || '').trim().toLowerCase()
  const bedrooms = String(options.bedrooms || '').trim().toLowerCase()
  const pet = String(options.pet || '').trim()
  const minPrice = Number(options.minPrice) || 0
  const maxPrice = Number(options.maxPrice) || Infinity
  const priceNumber = (value) => Number(String(value || '').replace(/[^0-9.]/g, '')) || 0

  let posts = listOwnerPosts().filter((post) => {
    const x = post.extracted || {}
    const price = priceNumber(x.price)
    const haystack = [post.author, post.group, post.text, x.project, x.location, x.price, x.bedrooms, x.size]
      .join(' ')
      .toLowerCase()
    return (!query || haystack.includes(query))
      && (!project || String(x.project || '').toLowerCase().includes(project))
      && (!location || String(x.location || '').toLowerCase().includes(location))
      && (!bedrooms || String(x.bedrooms || '').toLowerCase().includes(bedrooms))
      && (!pet || x.petAllowed === pet)
      && (!minPrice || price >= minPrice)
      && (!Number.isFinite(maxPrice) || price <= maxPrice)
  })
  posts.sort((a, b) => options.sort === 'priceLow'
    ? priceNumber(a.extracted?.price) - priceNumber(b.extracted?.price)
    : options.sort === 'priceHigh'
      ? priceNumber(b.extracted?.price) - priceNumber(a.extracted?.price)
      : new Date(b.lastSeenAt) - new Date(a.lastSeenAt))
  const total = posts.length
  const start = (page - 1) * pageSize
  const all = read()
  return {
    posts: posts.slice(start, start + pageSize),
    page,
    pageSize,
    total,
    pages: Math.max(1, Math.ceil(total / pageSize)),
    stats: {
      all: all.length,
      petAllowed: all.filter((p) => listingDetails(p).petAllowed === 'ได้').length,
    },
  }
}

export function deleteOwnerPost(identity) {
  const posts = read().filter((post) => post.identity !== identity)
  write(posts)
  return true
}
