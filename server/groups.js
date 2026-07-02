// Persistent list of Facebook groups to monitor. Editable from the UI and
// saved to server/groups.json. Falls back to FB_GROUP_URLS in .env until the
// user saves a custom list.

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
}

export function loadGroups() {
  try {
    if (fs.existsSync(GROUPS_PATH)) {
      const arr = JSON.parse(fs.readFileSync(GROUPS_PATH, 'utf8'))
      if (Array.isArray(arr) && arr.length) return arr
    }
  } catch {
    /* fall through to env */
  }
  return envGroups()
}

export function saveGroups(urls) {
  const clean = [...new Set(urls.map((s) => String(s).trim()).filter(Boolean))]
  fs.writeFileSync(GROUPS_PATH, JSON.stringify(clean, null, 2))
  return clean
}

// Short readable label, e.g. ".../groups/renthub" -> "renthub".
export function groupLabel(url = '') {
  const m = url.match(/groups\/([^/?]+)/)
  return m ? m[1] : url
}
