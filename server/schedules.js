// Auto-post schedules — "post this set to these groups at this time".
// Stored locally under server/autopost/schedules.json (gitignored). The actual
// posting executor is a later feature; for now this just persists the plan and
// the frontend renders a realtime countdown. Editable anytime.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DIR = path.join(__dirname, 'autopost')
const FILE = path.join(DIR, 'schedules.json')

function read() {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'))
  } catch {
    return []
  }
}
function write(list) {
  fs.mkdirSync(DIR, { recursive: true })
  fs.writeFileSync(FILE, JSON.stringify(list, null, 2))
}

export function listSchedules() {
  return read()
}

export function createSchedule({ name, postSetId, groups, runAt }) {
  const id = 'sch_' + Date.now()
  const s = {
    id,
    name: name?.trim() || 'ตั้งเวลาโพสต์',
    postSetId: postSetId || null,
    groups: (groups || []).map((g) => String(g).trim()).filter(Boolean),
    runAt: runAt || new Date().toISOString(),
    status: 'pending', // pending | posting | done | failed | canceled
    results: [], // [{ group, ok, error, at }] filled by the poster as it runs
    createdAt: new Date().toISOString(),
  }
  const list = read()
  list.unshift(s)
  write(list)
  return s
}

export function updateSchedule(id, patch = {}) {
  const list = read()
  const i = list.findIndex((s) => s.id === id)
  if (i < 0) return null
  for (const k of ['name', 'postSetId', 'groups', 'runAt', 'status', 'results', 'lastRunAt', 'finishedAt']) {
    if (k in patch) list[i][k] = k === 'groups' ? (patch[k] || []).filter(Boolean) : patch[k]
  }
  list[i].updatedAt = new Date().toISOString()
  write(list)
  return list[i]
}

export function deleteSchedule(id) {
  write(read().filter((s) => s.id !== id))
  return true
}
