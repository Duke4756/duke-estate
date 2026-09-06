// "ชุดของโพสต์" (Post Sets) — reusable post content (text + images) for the
// auto-post feature. Stored locally under server/autopost/ (gitignored) so the
// data survives git pulls and isn't shared between users.
//
// Metadata lives in postsets.json; image bytes are written as files under
// autopost/images/ and served at /api/postsets/images/<file>.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DIR = path.join(__dirname, 'autopost')
export const IMAGES_DIR = path.join(DIR, 'images')
const FILE = path.join(DIR, 'postsets.json')

function ensure() {
  fs.mkdirSync(IMAGES_DIR, { recursive: true })
}
function read() {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'))
  } catch {
    return []
  }
}
function write(list) {
  ensure()
  fs.writeFileSync(FILE, JSON.stringify(list, null, 2))
}

// Decode base64 data-URLs → image files. Returns saved filenames.
function saveImages(prefix, dataUrls) {
  ensure()
  const files = []
  ;(dataUrls || []).forEach((d, i) => {
    const m = /^data:image\/(\w+);base64,(.+)$/s.exec(d || '')
    if (!m) return
    const ext = m[1] === 'jpeg' ? 'jpg' : m[1]
    const file = `${prefix}_${i}.${ext}`
    fs.writeFileSync(path.join(IMAGES_DIR, file), Buffer.from(m[2], 'base64'))
    files.push(file)
  })
  return files
}
function removeImages(files) {
  ;(files || []).forEach((f) => {
    try {
      fs.unlinkSync(path.join(IMAGES_DIR, f))
    } catch {
      /* already gone */
    }
  })
}

// Public shape adds a ready-to-use URL for each image.
function toPublic(s) {
  return { ...s, images: (s.images || []).map((f) => ({ file: f, url: `/api/postsets/images/${f}` })) }
}

export function listSets() {
  return read().map(toPublic)
}

export function getSet(id) {
  const s = read().find((x) => x.id === id)
  return s ? toPublic(s) : null
}

export function normalizeSourceUrl(value = '') {
  try {
    const url = new URL(String(value).trim())
    url.hash = ''
    return url.href.replace(/\/$/, '')
  } catch { return String(value).trim() }
}

export function findSetBySourceUrl(sourceUrl) {
  const normalized = normalizeSourceUrl(sourceUrl)
  return normalized ? read().find((set) => normalizeSourceUrl(set.sourceUrl) === normalized) || null : null
}

export function postSetDeal(set = {}) {
  const explicit = String(set.deal || '').trim().toLowerCase()
  if (explicit === 'rent' || explicit === 'sale') return explicit
  const content = `${set.name || ''}\n${set.text || ''}`
  if (/ราคาขาย|(^|\s)ขาย(?:\s|$)/u.test(content)) return 'sale'
  if (/ราคาเช่า|ให้เช่า|(^|\s)เช่า(?:\s|$)/u.test(content)) return 'rent'
  return 'unknown'
}

export function isRentalPostSet(set) {
  return postSetDeal(set) === 'rent'
}

export function postSetReference(set = {}) {
  return `${set.name || ''}\n${set.text || ''}`.match(/\b[A-Z]{1,8}-\d{3,12}\b/i)?.[0]?.toUpperCase() || null
}

export function isPublishableRentalPostSet(set) {
  return isRentalPostSet(set) && Boolean(postSetReference(set))
}

export function createSet({ name, text, images, sourceUrl, deal, kind, propertyType }) {
  const id = 'ps_' + Date.now()
  const set = {
    id,
    name: name?.trim() || 'ชุดโพสต์ใหม่',
    text: text || '',
    images: saveImages(id, images),
    sourceUrl: normalizeSourceUrl(sourceUrl) || undefined,
    deal: postSetDeal({ deal, name, text }),
    kind: propertyType || kind || undefined,
    createdAt: new Date().toISOString(),
  }
  const list = read()
  list.unshift(set)
  write(list)
  return toPublic(set)
}

export function refreshImportedSet(id, { name, text, images, sourceUrl, deal, propertyType, kind }) {
  const list = read()
  const index = list.findIndex((set) => set.id === id)
  if (index < 0) return null
  const current = list[index]
  removeImages(current.images)
  list[index] = {
    ...current,
    name: name?.trim() || current.name,
    text: text || current.text,
    images: saveImages(`${id}_${Date.now()}`, images),
    sourceUrl: normalizeSourceUrl(sourceUrl) || current.sourceUrl,
    deal: postSetDeal({ deal: deal || current.deal, name: name || current.name, text: text || current.text }),
    kind: propertyType || kind || current.kind,
    updatedAt: new Date().toISOString(),
  }
  write(list)
  return toPublic(list[index])
}

// keepImages: existing filenames to keep. newImages: base64 data-URLs (or {id,url}) to add.
// imageOrder can interleave both types: [{type:'existing', file}, {type:'new', id}].
export function updateSet(id, { name, text, keepImages, newImages, imageOrder, deal, propertyType, kind }) {
  const list = read()
  const i = list.findIndex((s) => s.id === id)
  if (i < 0) return null
  const cur = list[i]
  const kept = Array.isArray(keepImages)
    ? cur.images.filter((f) => keepImages.includes(f))
    : cur.images
  removeImages(cur.images.filter((f) => !kept.includes(f)))
  const newItems = Array.isArray(newImages) ? newImages : []
  const added = saveImages(id + '_' + Date.now(), newItems.map((image) => image?.url || image))
  const newById = new Map(
    newItems.map((image, index) => [image?.id, added[index]]),
  )
  const ordered = Array.isArray(imageOrder)
    ? imageOrder.map((image) => {
        if (image?.type === 'existing') return kept.includes(image.file) ? image.file : null
        if (image?.type === 'new') return newById.get(image.id) || null
        return null
      }).filter(Boolean)
    : [...kept, ...added]
  list[i] = {
    ...cur,
    name: name != null ? name.trim() || cur.name : cur.name,
    text: text != null ? text : cur.text,
    deal: deal || cur.deal || postSetDeal({ name, text }),
    kind: propertyType || kind || cur.kind,
    images: ordered,
    updatedAt: new Date().toISOString(),
  }
  write(list)
  return toPublic(list[i])
}

export function deleteSet(id) {
  const list = read()
  const s = list.find((x) => x.id === id)
  if (s) removeImages(s.images)
  write(list.filter((x) => x.id !== id))
  return true
}

export function deleteSets(ids) {
  const targets = new Set((ids || []).filter(Boolean))
  if (!targets.size) return []
  const list = read()
  const removed = list.filter((set) => targets.has(set.id))
  removed.forEach((set) => removeImages(set.images))
  write(list.filter((set) => !targets.has(set.id)))
  return removed.map((set) => set.id)
}

export function reorderSets(ids) {
  const list = read()
  const byId = new Map(list.map((set) => [set.id, set]))
  const ordered = []
  for (const id of ids || []) {
    const set = byId.get(id)
    if (!set) continue
    ordered.push(set)
    byId.delete(id)
  }
  ordered.push(...list.filter((set) => byId.has(set.id)))
  write(ordered)
  return ordered.map(toPublic)
}
