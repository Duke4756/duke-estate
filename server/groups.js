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

export function groupKey(value = '') {
  const raw = String(value).trim()
  try {
    const url = new URL(raw)
    if (!/(^|\.)facebook\.com$/i.test(url.hostname)) return raw.toLowerCase()
    const match = url.pathname.match(/^\/groups\/([^/?#]+)/i)
    return match ? decodeURIComponent(match[1]).toLowerCase() : raw.toLowerCase()
  } catch {
    const match = raw.match(/facebook\.com\/groups\/([^/?#]+)/i)
    return match ? decodeURIComponent(match[1]).toLowerCase() : raw.toLowerCase()
  }
}

export function duplicateGroups(list) {
  const seen = new Set()
  const duplicates = []
  for (const group of list || []) {
    const url = (typeof group === 'string' ? group : group?.url || '').trim()
    if (!url) continue
    const key = groupKey(url)
    if (seen.has(key)) duplicates.push(url)
    else seen.add(key)
  }
  return duplicates
}

// Accepts either the new [{url, active}] shape or a legacy array of URL strings.
function normalize(list) {
  const seen = new Set()
  const out = []
  for (const g of list || []) {
    const url = (typeof g === 'string' ? g : g?.url || '').trim()
    const key = groupKey(url)
    if (!url || seen.has(key)) continue
    seen.add(key)
    const category = typeof g === 'object' && String(g.category || '').trim()
      ? String(g.category).trim()
      : 'general'
    const name = typeof g === 'object' ? String(g.name || '').trim() : ''
    const memberCount = typeof g === 'object' && Number.isFinite(Number(g.memberCount)) ? Number(g.memberCount) : null
    const marketingTags = typeof g === 'object' && Array.isArray(g.marketingTags) ? [...new Set(g.marketingTags.map((tag) => String(tag).trim().toUpperCase()).filter(Boolean))] : []
    const projectTags = typeof g === 'object' && Array.isArray(g.projectTags) ? [...new Set(g.projectTags.map((tag) => String(tag).trim()).filter(Boolean))] : []
    const projectIds = typeof g === 'object' && Array.isArray(g.projectIds) ? [...new Set(g.projectIds.map((tag) => String(tag).trim()).filter(Boolean))] : []
    out.push({ url, active: typeof g === 'object' ? g.active !== false : true, category, name, memberCount, marketingTags, projectTags, projectIds, notes: typeof g === 'object' ? String(g.notes || '') : '', zone_tags: typeof g === 'object' && Array.isArray(g.zone_tags) ? [...new Set(g.zone_tags.map((tag) => String(tag).trim().toUpperCase()).filter(Boolean))] : [], project_specific: typeof g === 'object' && g.project_specific === true, project_name: typeof g === 'object' ? (String(g.project_name || '').trim() || null) : null, project_aliases: typeof g === 'object' && Array.isArray(g.project_aliases) ? g.project_aliases.map((x) => String(x).trim()).filter(Boolean) : [], manual_tags: typeof g === 'object' && Array.isArray(g.manual_tags) ? g.manual_tags.map((x) => String(x).trim().toUpperCase()).filter(Boolean) : [] })
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

export function loadGroupsByCategory(category = 'all') {
  return loadGroupsFull()
    .filter((g) => g.active && (category === 'all' || g.category === category))
    .map((g) => g.url)
}

export function getGroups({ tags = [], project = '', projectId = '', accountId = '', memberOnly = false, enabledOnly = true } = {}, memberships = {}) {
  const wanted = tags.map((tag) => String(tag).toUpperCase())
  return loadGroupsFull().filter((group) => {
    if (enabledOnly && group.active === false) return false
    if (wanted.length && !wanted.every((tag) => (group.marketingTags || []).includes(tag))) return false
    if ((project && !(group.projectTags || []).includes(project)) || (projectId && !(group.projectIds || []).includes(projectId))) return false
    if (memberOnly && memberships?.[group.url]?.[accountId]?.status !== 'MEMBER') return false
    return true
  }).sort((a, b) => (((b.projectTags || []).includes(project) || (b.projectIds || []).includes(projectId)) ? 1 : 0) - (((a.projectTags || []).includes(project) || (a.projectIds || []).includes(projectId)) ? 1 : 0) || (b.marketingTags || []).filter((tag) => wanted.includes(tag)).length - (a.marketingTags || []).filter((tag) => wanted.includes(tag)).length)
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
