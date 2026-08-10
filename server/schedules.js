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
let idSequence = 0

// Conservative safeguards for automated posting. They are product limits, not
// a guarantee of Facebook policy compliance. Reposting to a group is allowed:
// the queue/account gap, not a 24-hour per-group ban, prevents rapid posting.
export const ACCOUNT_POST_GAP_MS = 30 * 60 * 1000

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

function successfulPosts() {
  return read().flatMap((schedule) =>
    (schedule.results || [])
      .filter((result) => isVerifiedPostResult(result) && result.group && !Number.isNaN(new Date(result.at).getTime()))
      .map((result) => ({
        ...result,
        accountId: schedule.accountId || 'primary',
        postSetId: schedule.postSetId || null,
        atMs: new Date(result.at).getTime(),
      })),
  )
}

export function isVerifiedPostResult(result = {}) {
  return result.ok === true && (
    result.verified === 'group_card'
    || (result.verified === 'permalink' && Boolean(result.postUrl))
  )
}

export function eligibleGroups(groups, now = Date.now()) {
  // `now` remains accepted for backwards-compatible callers. A group may be
  // used again even within 24 hours; schedules themselves enforce the
  // account-level posting interval and manual runs ask for confirmation.
  void now
  return [...new Set((groups || []).filter(Boolean))]
}

// Random posting should still cover the configured groups evenly. Put groups
// this account has never attempted first, followed by the least-recently used
// groups. Randomness is only used inside equal-history buckets, so a newly
// created queue cannot immediately drift back to the same few groups.
export function rotateGroupsForAccount(groups, accountId = 'primary', schedules = read(), random = Math.random) {
  const normalizedAccountId = accountId || 'primary'
  const lastAttemptByGroup = new Map()
  for (const schedule of schedules || []) {
    if ((schedule.accountId || 'primary') !== normalizedAccountId) continue
    for (const result of schedule.results || []) {
      if (!result.group) continue
      const attemptedAt = new Date(result.at || schedule.lastRunAt || schedule.runAt || 0).getTime()
      if (!Number.isFinite(attemptedAt)) continue
      lastAttemptByGroup.set(result.group, Math.max(lastAttemptByGroup.get(result.group) || 0, attemptedAt))
    }
  }

  return [...groups]
    .map((group) => ({ group, lastAttemptAt: lastAttemptByGroup.get(group) || 0, tieBreaker: random() }))
    .sort((a, b) => a.lastAttemptAt - b.lastAttemptAt || a.tieBreaker - b.tieBreaker)
    .map(({ group }) => group)
}

export function remainingAccountPostGap(accountId = 'primary', now = Date.now()) {
  return calculateRemainingAccountPostGap(successfulPosts(), accountId, now)
}

export function calculateRemainingAccountPostGap(posts, accountId = 'primary', now = Date.now()) {
  const latestPost = (posts || [])
    .filter((post) => post.accountId === (accountId || 'primary'))
    .reduce((latest, post) => Math.max(latest, post.atMs), 0)
  return Math.max(0, latestPost + ACCOUNT_POST_GAP_MS - now)
}

export function successfulPostSetIds(accountId = 'primary') {
  return [...new Set(successfulPosts()
    .filter((post) => post.accountId === (accountId || 'primary') && post.postSetId)
    .map((post) => post.postSetId))]
}

export function scheduleStatusForResults(results = []) {
  const delivered = isVerifiedPostResult
  const allOk = results.length > 0 && results.every(delivered)
  if (allOk) return 'done'
  if (results.some(delivered)) return 'done'
  if (results.some((result) => result.pending || ['accepted', 'unconfirmed'].includes(result.verified))) return 'unconfirmed'
  return 'failed'
}

export function isOneTimePostComplete(schedule, results = []) {
  void schedule
  const verified = isVerifiedPostResult
  // A post set is consumable content only after Facebook gives us a real
  // permalink. Failed/unconfirmed attempts remain available for retry.
  return results.some(verified)
}

export const UNCONFIRMED_REVIEW_MS = 10 * 60 * 1000

export function displayScheduleStatus(schedule, now = Date.now()) {
  if (schedule?.status !== 'unconfirmed') return schedule?.status
  const finishedAt = new Date(schedule.finishedAt || schedule.runAt || schedule.createdAt || 0).getTime()
  return Number.isFinite(finishedAt) && now - finishedAt >= UNCONFIRMED_REVIEW_MS
    ? 'skipped'
    : 'unconfirmed'
}

export function createSchedule({ name, postSetId, groups, runAt, groupMode, accountId = 'primary' }) {
  // Several schedules may be created in the same millisecond by the batch
  // planner. Keep ids unique without changing compatibility with existing ids.
  const id = `sch_${Date.now()}_${++idSequence}`
  const s = {
    id,
    name: name?.trim() || 'ตั้งเวลาโพสต์',
    postSetId: postSetId || null,
    groups: (groups || []).map((g) => String(g).trim()).filter(Boolean),
    groupMode: groupMode === 'random' ? 'random' : 'selected',
    accountId,
    source: 'manual',
    runAt: runAt || new Date().toISOString(),
    status: 'pending', // pending | posting | done | failed | canceled
    results: [], // [{ group, ok, error, postUrl, at }] filled by the poster as it runs
    createdAt: new Date().toISOString(),
  }
  const list = read()
  list.unshift(s)
  write(list)
  return s
}

// Creates an ordered queue of schedules from selected post sets. Jitter is
// only added forward, so the requested interval is always a minimum gap.
export function createScheduleBatch({ postSetIds, groups, groupMode, startAt, intervalMinutes, jitterMinutes, name, accountId = 'primary' }) {
  const ids = [...new Set((postSetIds || []).filter(Boolean))]
  const intervalMs = Number(intervalMinutes) * 60_000
  const jitterMs = Number(jitterMinutes) * 60_000
  if (!ids.length) throw new Error('กรุณาเลือกชุดโพสต์อย่างน้อยหนึ่งชุด')
  if (!Number.isFinite(intervalMs) || intervalMs < ACCOUNT_POST_GAP_MS) {
    throw new Error('ช่วงห่างระหว่างโพสต์ต้องไม่น้อยกว่า 30 นาที')
  }
  if (!Number.isFinite(jitterMs) || jitterMs < 0 || jitterMs > 30 * 60_000) {
    throw new Error('เวลาสุ่มต้องอยู่ระหว่าง 0-30 นาที')
  }
  const startMs = new Date(startAt).getTime()
  if (Number.isNaN(startMs)) throw new Error('วันและเวลาเริ่มต้นไม่ถูกต้อง')

  const batchId = `batch_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
  let runMs = startMs + (jitterMs ? Math.floor(Math.random() * (jitterMs + 1)) : 0)
  return ids.map((postSetId, index) => {
    if (index > 0) runMs += intervalMs + (jitterMs ? Math.floor(Math.random() * (jitterMs + 1)) : 0)
    const schedule = createSchedule({
      name: name ? `${name.trim()} ${index + 1}/${ids.length}` : `คิวโพสต์ ${index + 1}/${ids.length}`,
      postSetId,
      groups,
      groupMode,
      runAt: new Date(runMs).toISOString(),
      accountId,
    })
    // Metadata is useful for the UI/history and harmless for old readers.
    return updateSchedule(schedule.id, { batchId, batchIndex: index + 1, batchSize: ids.length })
  })
}

export function updateSchedule(id, patch = {}) {
  const list = read()
  const i = list.findIndex((s) => s.id === id)
  if (i < 0) return null
  for (const k of ['name', 'postSetId', 'groups', 'groupMode', 'accountId', 'runAt', 'status', 'results', 'lastRunAt', 'finishedAt', 'batchId', 'batchIndex', 'batchSize', 'source', 'autoCampaignId', 'burstId', 'burstIndex', 'burstSize', 'manualOverride']) {
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

export function clearAutoCampaignSchedules() {
  const schedules = read()
  // Never remove a job while its browser is actively publishing. Everything
  // else owned by Full Autopilot is disposable when the operator starts over.
  const kept = schedules.filter((schedule) => schedule.source !== 'auto' || schedule.status === 'posting')
  const removed = schedules.length - kept.length
  if (removed) write(kept)
  return removed
}

// A process/OS crash cannot reach poster.js's finally block. Do not leave a
// schedule permanently "posting", because it would block both the UI and all
// later automatic runs after the server comes back.
export function recoverInterruptedSchedules() {
  const list = read()
  let recovered = 0
  for (const schedule of list) {
    if (schedule.status !== 'posting') continue
    schedule.status = 'failed'
    schedule.results = schedule.results?.length
      ? schedule.results
      : (schedule.groups || []).map((group) => ({
          group,
          ok: false,
          error: 'การโพสต์ถูกขัดจังหวะก่อนยืนยันผล — ยังไม่ได้ถือว่าโพสต์สำเร็จ',
          at: new Date().toISOString(),
        }))
    schedule.finishedAt = new Date().toISOString()
    schedule.updatedAt = new Date().toISOString()
    recovered++
  }
  if (recovered) write(list)
  return recovered
}

export function reclassifyUnverifiedAcceptedSchedules() {
  const list = read()
  let changed = false
  for (const schedule of list) {
    let scheduleChanged = false
    const results = (schedule.results || []).map((result) => {
      if (!['accepted', 'submitted'].includes(result.verified)) return result
      changed = true
      scheduleChanged = true
      return {
        ...result,
        ok: false,
        pending: true,
        postUrl: null,
        verified: 'unconfirmed',
        error: result.error || 'ผลเดิมไม่มี permalink ยืนยัน จึงปรับเป็นรอตรวจสอบ',
      }
    })
    if (!scheduleChanged) continue
    schedule.results = results
    if (results.some((result) => result.ok)) schedule.status = 'done'
    else if (results.some((result) => result.pending)) schedule.status = 'unconfirmed'
  }
  if (changed) write(list)
  return changed
}
