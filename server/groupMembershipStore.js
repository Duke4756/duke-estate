import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'autopost', 'group-memberships.json')

const keyOf = (url = '') => String(url).match(/facebook\.com\/groups\/([^/?#]+)/i)?.[1]?.toLowerCase() || String(url)
export const MEMBERSHIP_STATUS = Object.freeze({ MEMBER: 'MEMBER', REQUESTED: 'REQUESTED', NOT_MEMBER: 'NOT_MEMBER', UNKNOWN: 'UNKNOWN', UNAVAILABLE: 'UNAVAILABLE' })
export function normalizeMembershipStatus(status) { return ({ joined: 'MEMBER', member: 'MEMBER', MEMBER: 'MEMBER', requested: 'REQUESTED', REQUESTED: 'REQUESTED', not_member: 'NOT_MEMBER', NOT_MEMBER: 'NOT_MEMBER', unknown: 'UNKNOWN', UNKNOWN: 'UNKNOWN', unavailable: 'UNAVAILABLE', BLOCKED_OR_UNAVAILABLE: 'UNAVAILABLE' }[String(status || '')] || 'UNKNOWN') }

function read() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')) } catch { return {} }
}

export function groupMembershipFor(accountId, groupUrl) {
  return normalizeMembershipStatus(read()[accountId || 'primary']?.[keyOf(groupUrl)]?.status)
}

export function saveGroupMembership(accountId, groupUrl, status) {
  status = normalizeMembershipStatus(status)
  const data = read()
  const id = accountId || 'primary'
  data[id] ||= {}
    data[id][keyOf(groupUrl)] = { status, checkedAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
  fs.mkdirSync(path.dirname(FILE), { recursive: true })
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2))
}

export function saveGroupMemberships(accountId, entries = []) {
  const valid = entries.filter((entry) => entry?.groupUrl && normalizeMembershipStatus(entry.status) !== 'UNKNOWN')
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
    data[id][key] = { status: normalizeMembershipStatus(entry.status), checkedAt: updatedAt, updatedAt }
  }
  fs.mkdirSync(path.dirname(FILE), { recursive: true })
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2))
}

export function filterPostableGroups(accountId, groups) {
  return (groups || []).filter((group) => groupMembershipFor(accountId, group) === 'MEMBER')
}

export function isGroupMember(accountId, groupUrl) { return groupMembershipFor(accountId, groupUrl) === 'MEMBER' }
