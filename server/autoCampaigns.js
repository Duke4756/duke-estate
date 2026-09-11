import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createSchedule, listSchedules, remainingAccountPostGap, updateSchedule } from './schedules.js'
import { isPublishableRentalPostSet } from './postsets.js'
import { validateAccountPlan, nextAccountOccurrence, accountPlanEntries } from './accountPostPlan.js'

const FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'autopost', 'auto-campaign.json')
const DEFAULTS = {
  enabled: false,
  accountIds: [],
  postSetMode: 'all',
  postSetIds: [],
  groups: [],
  groupMode: 'random',
  intervalMinutes: 30,
  burstSize: 2,
  accountRules: {},
  priorityNewHours: 72,
  accountState: {},
  rotationState: { cycle: 1, usedPostSetIds: [] },
  accountGapMinutes: 65,
  postingWindow: { start: '08:00', end: '22:00', daily: true },
}

export function randomizedCycleDelayMs(intervalMinutes = 30, random = Math.random) {
  // Pick a magnitude from 3-5 minutes, then independently choose before/after.
  // This deliberately never lands in the predictable -2..+2 minute band.
  const magnitudeMinutes = 3 + random() * 2
  const direction = random() < 0.5 ? -1 : 1
  return Math.max(1, Number(intervalMinutes) + direction * magnitudeMinutes) * 60_000
}

export function accountQueueRunTimes({ now = Date.now(), count = 1, intervalMinutes = 30, random = Math.random }) {
  const times = []
  let cursor = now
  for (let index = 0; index < count; index += 1) {
    times.push(cursor)
    cursor += randomizedCycleDelayMs(intervalMinutes, random)
  }
  return { times, nextRunAt: cursor }
}

export function getAutoCampaign() {
  try {
    const saved = JSON.parse(fs.readFileSync(FILE, 'utf8'))
    return {
      ...DEFAULTS,
      ...saved,
      accountState: saved.accountState || {},
      accountRules: saved.accountRules || {},
    rotationState: { ...DEFAULTS.rotationState, ...(saved.rotationState || {}) },
      postingWindow: { ...DEFAULTS.postingWindow, ...(saved.postingWindow || {}) },
    }
  } catch {
    return { ...DEFAULTS }
  }
}

export function includeAutoCampaignPostSet(id) {
  if (!id) return getAutoCampaign()
  const settings = getAutoCampaign()
  // An empty list means "all sets", so the imported room is already included.
  if (settings.postSetIds.length && !settings.postSetIds.includes(id)) settings.postSetIds.push(id)
  settings.rotationState = {
    ...settings.rotationState,
    usedPostSetIds: (settings.rotationState?.usedPostSetIds || []).filter((usedId) => usedId !== id),
  }
  write(settings)
  return settings
}

export function removeAutoCampaignPostSets(ids) {
  const removed = new Set(ids || [])
  const settings = getAutoCampaign()
  settings.postSetIds = settings.postSetIds.filter((id) => !removed.has(id))
  settings.rotationState = {
    ...settings.rotationState,
    usedPostSetIds: (settings.rotationState?.usedPostSetIds || []).filter((id) => !removed.has(id)),
  }
  write(settings)
  return settings
}

function write(settings) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true })
  fs.writeFileSync(FILE, JSON.stringify(settings, null, 2))
}

export function saveAutoCampaign(input = {}) {
  const intervalMinutes = Number(input.intervalMinutes)
  const priorityNewHours = Number(input.priorityNewHours)
  if (!Number.isFinite(intervalMinutes) || intervalMinutes < 30) {
    throw new Error('แต่ละบัญชีต้องเว้นอย่างน้อย 30 นาทีต่อโพสต์')
  }
  if (!Number.isFinite(priorityNewHours) || priorityNewHours < 0 || priorityNewHours > 720) {
    throw new Error('ช่วงให้ความสำคัญทรัพย์ใหม่ต้องอยู่ระหว่าง 0-720 ชั่วโมง')
  }
  if (!['all', 'random'].includes(input.postSetMode)) throw new Error('รูปแบบเลือกชุดโพสต์ไม่ถูกต้อง')
  if (!['selected', 'random'].includes(input.groupMode)) throw new Error('รูปแบบเลือกกลุ่มไม่ถูกต้อง')
  const previous = getAutoCampaign()
  const accountIds = [...new Set((input.accountIds || []).filter(Boolean))]
  const ruleIds = input.mode === 'account_schedule' ? [...new Set([...accountIds, ...Object.keys(input.accountRules || {})])] : accountIds
  const accountRules = Object.fromEntries(ruleIds.map((accountId) => {
    const source = input.accountRules?.[accountId] || previous.accountRules?.[accountId] || {}
    if (input.mode === 'account_schedule') return [accountId, validateAccountPlan(source, { allowIncomplete: !accountIds.includes(accountId) })]
    const burstSize = Number(source.burstSize ?? input.burstSize ?? previous.burstSize ?? 2)
    const accountInterval = Number(source.intervalMinutes ?? intervalMinutes)
    if (!Number.isInteger(burstSize) || burstSize < 1 || burstSize > 10) {
      throw new Error('จำนวนโพสต์ต่อรอบของแต่ละบัญชีต้องอยู่ระหว่าง 1-10 โพสต์')
    }
    if (!Number.isFinite(accountInterval) || accountInterval < 30 || accountInterval > 1440) {
      throw new Error('ระยะพักของแต่ละบัญชีต้องอยู่ระหว่าง 30-1,440 นาที')
    }
    return [accountId, { burstSize, intervalMinutes: accountInterval }]
  }))
  const settings = {
    ...previous,
    mode: input.mode === 'account_schedule' ? 'account_schedule' : previous.mode,
    enabled: input.enabled === true,
    accountIds: [...new Set((input.accountIds || []).filter(Boolean))],
    postSetMode: input.postSetMode,
    postSetIds: [...new Set((input.postSetIds || []).filter(Boolean))],
    groups: [...new Set((input.groups || []).map((value) => String(value).trim()).filter(Boolean))],
    groupMode: input.groupMode,
    intervalMinutes,
    burstSize: Math.max(1, Math.min(10, Number(input.burstSize) || previous.burstSize || 2)),
    accountRules,
    priorityNewHours,
    accountGapMinutes: Math.max(61, Number(input.accountGapMinutes ?? previous.accountGapMinutes ?? 65)),
    postingWindow: { ...previous.postingWindow, ...(input.postingWindow || {}) },
    updatedAt: new Date().toISOString(),
  }
  if (settings.enabled && !settings.accountIds.length) throw new Error('เลือกบัญชีอย่างน้อยหนึ่งบัญชี')
  if (settings.mode !== 'account_schedule' && settings.enabled && !settings.groups.length) throw new Error('เลือกกลุ่มเป้าหมายอย่างน้อยหนึ่งกลุ่ม')
  if (settings.mode !== 'account_schedule' && settings.groupMode === 'selected' && settings.groups.length > 3) {
    throw new Error('โหมดเลือกกลุ่มเองเลือกได้สูงสุด 3 กลุ่ม')
  }
  // Turning the system on is an explicit manual resume action. Discard stale
  // future timestamps so every selected account can create its next queue on
  // the scheduler's very next check.
  if (settings.enabled && (!previous.enabled || input.restartNow === true)) {
    const resumedAt = new Date().toISOString()
    settings.accountState = Object.fromEntries(settings.accountIds.map((accountId) => [
      accountId,
      {
        ...(previous.accountState?.[accountId] || {}),
        nextRunAt: resumedAt,
        resumedAt,
      },
    ]))
  }
  // Starting a new round must reset the central room allocation as well as
  // the generated schedules. Otherwise every room remains marked as used and
  // all accounts stay at “waiting to choose a post”.
  if (input.restartNow === true) {
    settings.rotationState = resetPostSetRotation(previous.rotationState)
  }
  if (settings.mode === 'account_schedule') {
    settings.accountState = { ...previous.accountState }
    for (const accountId of previous.accountIds) {
      if (!settings.accountIds.includes(accountId)) settings.accountState[accountId] = {}
    }
    for (const accountId of settings.accountIds) {
      if (JSON.stringify(previous.accountRules?.[accountId]) !== JSON.stringify(settings.accountRules[accountId])) {
        settings.accountState[accountId] = {}
      }
    }
  }
  write(settings)
  return settings
}

export function accountPostingRule(settings = {}, accountId) {
  const rule = settings.accountRules?.[accountId] || {}
  return {
    burstSize: Math.max(1, Math.min(10, Number(rule.burstSize) || Number(settings.burstSize) || 2)),
    intervalMinutes: Math.max(30, Math.min(1440, Number(rule.intervalMinutes) || Number(settings.intervalMinutes) || 30)),
  }
}

export function resetPostSetRotation(rotationState = {}) {
  return {
    cycle: (Number(rotationState.cycle) || 1) + 1,
    usedPostSetIds: [],
    lastPostSetId: null,
  }
}

export function reconcilePostSetRotation(rotationState = {}, reservedIds = []) {
  const reserved = new Set(reservedIds || [])
  const usedPostSetIds = [...new Set(rotationState.usedPostSetIds || [])]
    .filter((id) => reserved.has(id))
  return {
    ...rotationState,
    usedPostSetIds,
    lastPostSetId: reserved.has(rotationState.lastPostSetId) ? rotationState.lastPostSetId : null,
  }
}

export function consumedAutoPostSetIds(schedules = []) {
  const active = new Set((schedules || [])
    .filter((schedule) => ['pending', 'posting'].includes(schedule.status))
    .map((schedule) => schedule.postSetId).filter(Boolean))
  return [...new Set((schedules || [])
    .filter((schedule) => schedule.source === 'auto' && !active.has(schedule.postSetId))
    .filter((schedule) => (schedule.results || []).some((result) => result.ok === true
      && ['permalink', 'facebook_api'].includes(result.verified)))
    .map((schedule) => schedule.postSetId).filter(Boolean))]
}

export function chooseAutoPostSet({ settings, sets, accountId, alreadyPostedIds = [], now = Date.now(), random = Math.random }) {
  const allowed = settings.postSetIds.length
    ? sets.filter((set) => settings.postSetIds.includes(set.id))
    : sets
  if (!allowed.length) return null
  const alreadyPosted = new Set(alreadyPostedIds)
  const priorityCutoff = now - settings.priorityNewHours * 60 * 60_000
  const priority = allowed.filter((set) =>
    new Date(set.createdAt).getTime() >= priorityCutoff && !alreadyPosted.has(set.id))
  const pool = priority.length ? priority : allowed
  if (settings.postSetMode === 'random') {
    return pool[Math.floor(random() * pool.length)]
  }
  const state = settings.accountState?.[accountId] || {}
  const previousIndex = Number(state.cursor) || 0
  return pool[previousIndex % pool.length]
}

export function takeNextDiversePostSet({ settings, sets, reservedIds = [], random = Math.random }) {
  const allowed = settings.postSetIds.length
    ? sets.filter((set) => settings.postSetIds.includes(set.id))
    : sets
  if (!allowed.length) return null
  const allowedIds = new Set(allowed.map((set) => set.id))
  const reserved = new Set(reservedIds)
  let used = new Set((settings.rotationState?.usedPostSetIds || []).filter((id) => allowedIds.has(id)))
  let candidates = allowed.filter((set) => !used.has(set.id) && !reserved.has(set.id))
  const cycle = Number(settings.rotationState?.cycle) || 1
  // Rooms are consumable one-shot inventory. Exhausting the pool must wait for
  // newly imported rooms; silently starting a new cycle reposted identical
  // text and photos and made daily statistics misleading.
  if (!candidates.length) {
    return null
  }
  if (!candidates.length) return null
  const set = settings.postSetMode === 'random'
    ? candidates[Math.floor(random() * candidates.length)]
    : candidates[0]
  used.add(set.id)
  settings.rotationState = { cycle, usedPostSetIds: [...used], lastPostSetId: set.id }
  return set
}

export function materializeAutoCampaign({ sets, readyAccountIds, now = Date.now(), manualOverride = false, random = Math.random }) {
  const settings = getAutoCampaign()
  if (!settings.enabled) return []
  if (settings.mode === 'account_schedule') return materializeAccountPlans({ settings, sets, readyAccountIds, now })
  // Owner-exclusive stock has its own repeatable campaign and must never be
  // consumed by the ordinary one-shot JSA inventory rotation.
  sets = (sets || []).filter(isPublishableRentalPostSet)
  const created = []
  let stateChanged = false
  // Never recycle a room while Facebook may already have accepted it but its
  // permalink is still being indexed. This reservation survives restarts.
  const reservedIds = [...new Set(listSchedules()
    .filter((schedule) => ['pending', 'posting', 'unconfirmed'].includes(schedule.status))
    .map((schedule) => schedule.postSetId)
    .filter(Boolean))]
  // Successful one-shot rooms have already been deleted. A remaining room
  // whose schedule failed before Facebook accepted the submission must be
  // released back to the allocator; otherwise every remaining room eventually
  // stays marked as used and the live scheduler silently starves.
  settings.rotationState = reconcilePostSetRotation(settings.rotationState, reservedIds)
  for (const accountId of settings.accountIds) {
    if (!readyAccountIds.includes(accountId)) continue
    const hasPending = listSchedules().some((schedule) =>
      schedule.source === 'auto'
      && schedule.accountId === accountId
      && ['pending', 'posting'].includes(schedule.status))
    if (hasPending) continue
    const state = settings.accountState?.[accountId] || {}
    const savedNextRunAt = Number(new Date(state.nextRunAt).getTime()) || now
    const nextRunAt = Math.max(savedNextRunAt, now + remainingAccountPostGap(accountId, now))
    if (nextRunAt > now) {
      // Persist the effective time, not merely the old campaign clock. Without
      // this, the UI can keep showing a time in the past while the account is
      // correctly waiting for its post-gap, which looks exactly like a stuck
      // queue and also hides scheduler progress from the operator.
      if (nextRunAt !== savedNextRunAt) {
        settings.accountState = {
          ...settings.accountState,
          [accountId]: { ...state, nextRunAt: new Date(nextRunAt).toISOString() },
        }
        stateChanged = true
      }
      continue
    }
    const burstId = `burst_${now}_${accountId}`
    const { burstSize, intervalMinutes } = accountPostingRule(settings, accountId)
    const timeline = accountQueueRunTimes({ now, count: burstSize, intervalMinutes, random })
    let lastSet = null
    let queuedCount = 0
    for (let burstIndex = 1; burstIndex <= burstSize; burstIndex += 1) {
      const set = takeNextDiversePostSet({ settings, sets, reservedIds })
      if (!set) break
      lastSet = set
      queuedCount += 1
      reservedIds.push(set.id)
      const schedule = createSchedule({
        name: `อัตโนมัติ ${burstIndex}/${burstSize} · ${set.name}`,
        postSetId: set.id,
        groups: settings.groups,
        groupMode: settings.groupMode,
        accountId,
        // Cadence belongs to this account. Other accounts build their own
        // independent timeline and may run concurrently at the same time.
        runAt: new Date(timeline.times[burstIndex - 1]).toISOString(),
      })
      updateSchedule(schedule.id, {
        source: 'auto',
        autoCampaignId: 'default',
        burstId,
        burstIndex,
        burstSize,
        manualOverride,
      })
      created.push(schedule)
    }
    if (!lastSet) continue
    const cursor = (Number(state.cursor) || 0) + queuedCount
    settings.accountState = {
      ...settings.accountState,
      [accountId]: {
        cursor,
        lastPostSetId: lastSet.id,
        lastQueuedAt: new Date(now).toISOString(),
        // The next batch starts one account-specific interval after the last
        // queued post, never immediately after it and never after another
        // account's clock.
        nextRunAt: new Date(timeline.nextRunAt).toISOString(),
      },
    }
  }
  if (created.length || stateChanged) write(settings)
  return created
}

function materializeAccountPlans({ settings, sets, readyAccountIds, now }) {
  const created = []
  for (const accountId of settings.accountIds) {
    if (!readyAccountIds.includes(accountId)) continue
    const existing = listSchedules()
    if (existing.some((run) => run.source === 'auto' && run.accountId === accountId && ['pending', 'posting'].includes(run.status))) continue
    const rule = settings.accountRules[accountId]
    const state = settings.accountState?.[accountId] || {}
    const occurrence = nextAccountOccurrence(rule, state.lastOccurrence, now)
    if (occurrence === null) continue
    const available = new Map(sets.filter(isPublishableRentalPostSet).map((set) => [set.id, set]))
    if (rule.slots?.some((slot) => !available.has(slot.postSetId))) continue
    const entries = accountPlanEntries(rule, occurrence)
    for (const entry of entries) {
      // Persisted keys prevent duplicate work if the process exits midway through a batch.
      const planKey = JSON.stringify([accountId, occurrence, entry.postSetId, entry.group])
      if (existing.some((run) => run.planKey === planKey && run.status !== 'canceled')) continue
      const schedule = createSchedule({ name: `ตั้งเวลา · ${available.get(entry.postSetId).name}`, postSetId: entry.postSetId,
        groups: [entry.group], groupMode: 'selected', accountId, runAt: entry.runAt })
      updateSchedule(schedule.id, { source: 'auto', autoCampaignId: 'default', reusable: true, planKey })
      created.push(schedule)
    }
    settings.accountState[accountId] = { ...state, lastOccurrence: new Date(occurrence).toISOString(),
      nextRunAt: rule.repeatDaily ? new Date(occurrence + 86_400_000).toISOString() : null }
    write(settings)
  }
  return created
}
