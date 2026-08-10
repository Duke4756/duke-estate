import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createSchedule, listSchedules, remainingAccountPostGap, updateSchedule } from './schedules.js'

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
}

export function randomizedCycleDelayMs(intervalMinutes = 30, random = Math.random) {
  // Pick a magnitude from 3-5 minutes, then independently choose before/after.
  // This deliberately never lands in the predictable -2..+2 minute band.
  const magnitudeMinutes = 3 + random() * 2
  const direction = random() < 0.5 ? -1 : 1
  return Math.max(1, Number(intervalMinutes) + direction * magnitudeMinutes) * 60_000
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
  const accountRules = Object.fromEntries([...new Set((input.accountIds || []).filter(Boolean))].map((accountId) => {
    const source = input.accountRules?.[accountId] || previous.accountRules?.[accountId] || {}
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
    updatedAt: new Date().toISOString(),
  }
  if (settings.enabled && !settings.accountIds.length) throw new Error('เลือกบัญชีอย่างน้อยหนึ่งบัญชี')
  if (settings.enabled && !settings.groups.length) throw new Error('เลือกกลุ่มเป้าหมายอย่างน้อยหนึ่งกลุ่ม')
  if (settings.groupMode === 'selected' && settings.groups.length > 3) {
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
  // A room is consumed when it is assigned to the automatic queue. Do not
  // silently reset the rotation after every room has been covered: that made
  // older rooms appear again (and could duplicate a post when Facebook had
  // accepted it but permalink verification timed out). New imports are
  // removed from `usedPostSetIds` by includeAutoCampaignPostSet(), so they
  // become eligible immediately. Once all rooms are used, wait for a new room.
  if (!candidates.length) return null
  const set = settings.postSetMode === 'random'
    ? candidates[Math.floor(random() * candidates.length)]
    : candidates[0]
  used.add(set.id)
  settings.rotationState = { cycle, usedPostSetIds: [...used], lastPostSetId: set.id }
  return set
}

export function materializeAutoCampaign({ sets, readyAccountIds, now = Date.now(), manualOverride = false }) {
  const settings = getAutoCampaign()
  if (!settings.enabled) return []
  const created = []
  const reservedIds = []
  for (const accountId of settings.accountIds) {
    if (!readyAccountIds.includes(accountId)) continue
    const hasPending = listSchedules().some((schedule) =>
      schedule.source === 'auto'
      && schedule.accountId === accountId
      && ['pending', 'posting'].includes(schedule.status))
    if (hasPending) continue
    const state = settings.accountState?.[accountId] || {}
    const nextRunAt = Math.max(
      Number(new Date(state.nextRunAt).getTime()) || now,
      now + remainingAccountPostGap(accountId, now),
    )
    if (nextRunAt > now) continue
    const burstId = `burst_${now}_${accountId}`
    const { burstSize, intervalMinutes } = accountPostingRule(settings, accountId)
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
        // Per-account locking keeps these sequential even though both are due.
        runAt: new Date(now + (burstIndex - 1) * 1000).toISOString(),
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
        nextRunAt: new Date(now + randomizedCycleDelayMs(intervalMinutes)).toISOString(),
      },
    }
  }
  if (created.length) write(settings)
  return created
}
