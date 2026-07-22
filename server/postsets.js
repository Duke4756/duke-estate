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

export function createSet({ name, text, images }) {
  const id = 'ps_' + Date.now()
  const set = {
    id,
    name: name?.trim() || 'ชุดโพสต์ใหม่',
    text: text || '',
    images: saveImages(id, images),
    createdAt: new Date().toISOString(),
  }
  const list = read()
  list.unshift(set)
  write(list)
  return toPublic(set)
}

// keepImages: existing filenames to keep. newImages: base64 data-URLs to add.
export function updateSet(id, { name, text, keepImages, newImages }) {
  const list = read()
  const i = list.findIndex((s) => s.id === id)
  if (i < 0) return null
  const cur = list[i]
  const kept = Array.isArray(keepImages)
    ? cur.images.filter((f) => keepImages.includes(f))
    : cur.images
  removeImages(cur.images.filter((f) => !kept.includes(f)))
  const added = saveImages(id + '_' + Date.now(), newImages)
  list[i] = {
    ...cur,
    name: name != null ? name.trim() || cur.name : cur.name,
    text: text != null ? text : cur.text,
    images: [...kept, ...added],
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
