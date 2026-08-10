import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'autopost', 'group-memberships.json')

const keyOf = (url = '') => String(url).match(/facebook\.com\/groups\/([^/?#]+)/i)?.[1]?.toLowerCase() || String(url)

function read() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')) } catch { return {} }
}

export function groupMembershipFor(accountId, groupUrl) {
  return read()[accountId || 'primary']?.[keyOf(groupUrl)]?.status || 'unknown'
}

export function saveGroupMembership(accountId, groupUrl, status) {
  if (!['joined', 'requested', 'not_member', 'unknown'].includes(status)) return
  const data = read()
  const id = accountId || 'primary'
  data[id] ||= {}
  data[id][keyOf(groupUrl)] = { status, updatedAt: new Date().toISOString() }
  fs.mkdirSync(path.dirname(FILE), { recursive: true })
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2))
}

export function saveGroupMemberships(accountId, entries = []) {
  const valid = entries.filter((entry) => entry?.groupUrl && ['joined', 'requested', 'not_member'].includes(entry.status))
  if (!valid.length) return
  const data = read()
  const id = accountId || 'primary'
  data[id] ||= {}
  const updatedAt = new Date().toISOString()
  const seen = new Set()
  for (const entry of valid) {
    const key = keyOf(entry.groupUrl)
    if (seen.has(key)) continue
    seen.add(key)
    data[id][key] = { status: entry.status, updatedAt }
  }
  fs.mkdirSync(path.dirname(FILE), { recursive: true })
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2))
}

export function filterPostableGroups(accountId, groups) {
  return (groups || []).filter((group) => !['not_member', 'requested'].includes(groupMembershipFor(accountId, group)))
}
