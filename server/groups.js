// Persistent list of Facebook groups to monitor. Editable from the UI and
// saved to server/groups.json. Each group has an `active` flag so it can be
// temporarily disabled without removing it. Falls back to FB_GROUP_URLS in
// .env until the user saves a custom list.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const GROUPS_PATH = process.env.FB_GROUPS_PATH || path.join(__dirname, 'groups.json')

function envGroups() {
  return (
    process.env.FB_GROUP_URLS ||
    process.env.FB_GROUP_URL ||
    'https://www.facebook.com/groups/condoowner'
  )
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((url) => ({ url, active: true }))
}

// Accepts either the new [{url, active}] shape or a legacy array of URL strings.
function normalize(list) {
  const seen = new Set()
  const out = []
  for (const g of list || []) {
    const url = (typeof g === 'string' ? g : g?.url || '').trim()
    if (!url || seen.has(url)) continue
    seen.add(url)
    out.push({ url, active: typeof g === 'object' ? g.active !== false : true })
  }
  return out
}

// Full list with active flags — for the settings UI.
export function loadGroupsFull() {
  try {
    if (fs.existsSync(GROUPS_PATH)) {
      const raw = JSON.parse(fs.readFileSync(GROUPS_PATH, 'utf8'))
      if (Array.isArray(raw) && raw.length) return normalize(raw)
    }
  } catch {
    /* fall through to env */
  }
  return envGroups()
}

// Only the ACTIVE group URLs — for the scraper.
export function loadGroups() {
  return loadGroupsFull()
    .filter((g) => g.active)
    .map((g) => g.url)
}

export function saveGroups(list) {
  const clean = normalize(list)
  fs.writeFileSync(GROUPS_PATH, JSON.stringify(clean, null, 2))
  return clean
}

// Short readable label, e.g. ".../groups/renthub" -> "renthub".
export function groupLabel(url = '') {
  const m = url.match(/groups\/([^/?]+)/)
  return m ? m[1] : url
}
