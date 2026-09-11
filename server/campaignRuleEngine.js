// Campaign planning layer. It only decides placements and queue times; the
// existing poster remains responsible for browser automation and delivery.
import { listSchedules, createSchedule, updateSchedule, isVerifiedPostResult } from './schedules.js'
import { findEligibleGroups } from './groupClassification.js'
import { groupMembershipFor } from './groupMembershipStore.js'

export const CAMPAIGN_PLANS = Object.freeze({ ONE_PROPERTY_MULTI_GROUP: 'ONE_PROPERTY_MULTI_GROUP', MULTI_PROPERTY_ONE_GROUP: 'MULTI_PROPERTY_ONE_GROUP' })
export const POSTING_MODES = Object.freeze({ ROTATE: 'ROTATE', PRIME: 'PRIME', LIGHT: 'LIGHT' })
export const DEFAULT_ACCOUNT_GAP_MINUTES = 65

export function campaignPlacementKey({ campaignId, cd, group, cycle = 1 }) { return `${campaignId}:${String(cd).toUpperCase()}:${group}:${cycle}` }

export function nextAllowedWindowStart(now, window = {}) {
  const [startHour, startMinute] = String(window.start || '08:00').split(':').map(Number)
  const [endHour, endMinute] = String(window.end || '22:00').split(':').map(Number)
  const bangkok = new Date(now + 7 * 60 * 60_000)
  const asUtc = (dayOffset, hour, minute) => Date.UTC(bangkok.getUTCFullYear(), bangkok.getUTCMonth(), bangkok.getUTCDate() + dayOffset, hour, minute) - 7 * 60 * 60_000
  const start = asUtc(0, startHour, startMinute)
  const end = asUtc(0, endHour, endMinute)
  if (now < start) return start
  if (now > end) return asUtc(1, startHour, startMinute)
  return now
}

function postingWindowEnd(at, window = {}) {
  const [endHour, endMinute] = String(window.end || '22:00').split(':').map(Number)
  const bangkok = new Date(at + 7 * 60 * 60_000)
  return Date.UTC(bangkok.getUTCFullYear(), bangkok.getUTCMonth(), bangkok.getUTCDate(), endHour, endMinute) - 7 * 60 * 60_000
}

export function distributedPostingTimes(count, firstAllowedAt, window = {}, gapMinutes = DEFAULT_ACCOUNT_GAP_MINUTES) {
  const total = Math.max(1, Number(count) || 1)
  const gap = Math.max(61, Number(gapMinutes) || DEFAULT_ACCOUNT_GAP_MINUTES) * 60_000
  let start = nextAllowedWindowStart(firstAllowedAt, window)
  let end = postingWindowEnd(start, window)
  // If the remaining time today cannot meet the account safety gap, use the
  // next full window rather than bunching posts together near closing time.
  if (total > 1 && end - start < (total - 1) * gap) {
    start = nextAllowedWindowStart(end + 1, window)
    end = postingWindowEnd(start, window)
  }
  const spacing = total > 1 ? (end - start) / total : 0
  return Array.from({ length: total }, (_, index) => new Date(start + Math.round(index * spacing)))
}

export function nextSafeAccountSlot(accountId, requestedAt, { schedules = [], gapMinutes = DEFAULT_ACCOUNT_GAP_MINUTES } = {}) {
  const gap = Math.max(61, Number(gapMinutes) || DEFAULT_ACCOUNT_GAP_MINUTES) * 60_000
  let slot = new Date(requestedAt).getTime()
  if (!Number.isFinite(slot)) slot = Date.now()
  const occupied = []
  for (const schedule of schedules) {
    if ((schedule.accountId || 'primary') !== (accountId || 'primary')) continue
    const scheduled = new Date(schedule.runAt || 0).getTime()
    if (Number.isFinite(scheduled) && ['pending', 'scheduled', 'posting'].includes(schedule.status)) occupied.push(scheduled)
    for (const result of schedule.results || []) if (isVerifiedPostResult(result)) {
      const at = new Date(result.at || 0).getTime(); if (Number.isFinite(at)) occupied.push(at)
    }
  }
  let changed = true
  while (changed) { changed = false; for (const at of occupied) if (Math.abs(slot - at) < gap) { slot = at + gap; changed = true } }
  return new Date(slot)
}

export function planCampaign({ campaignId, planType, properties = [], groups = [], accounts = [], mode = POSTING_MODES.ROTATE, selectedZone = 'AUTO', rounds = 1, gapMinutes = DEFAULT_ACCOUNT_GAP_MINUTES, postingWindow = {}, schedules = listSchedules(), now = Date.now() }) {
  const placements = []; const rejected = []; let alreadyQueued = 0
  const candidates = selectedZone === 'AUTO' ? properties.flatMap((property) => findEligibleGroups(property, groups).map((group) => ({ property, group }))) : properties.flatMap((property) => groups.filter((group) => (group.zone_tags || []).includes(selectedZone) || selectedZone === 'PROJECT_GROUP').map((group) => ({ property, group })))
  const roundsPerProperty = Math.max(1, Number(rounds) || 1)
  // Queue count is per selected property. Rotate each property's eligible
  // groups; offsetting by property index spreads a shared group pool before
  // reuse (four properties with ten groups therefore use four groups).
  const candidatesByProperty = properties.map((property) => candidates.filter((pair) => pair.property === property))
  const rotationOffset = groups.length > 1 ? Math.floor(Math.random() * groups.length) : 0
  const ordered = []
  for (let round = 0; round < roundsPerProperty; round += 1) {
    for (const [propertyIndex, property] of properties.entries()) {
      const choices = candidatesByProperty[propertyIndex] || []
      const pair = choices[(rotationOffset + propertyIndex + round) % Math.max(1, choices.length)]
      if (pair) ordered.push({ ...pair, cycle: round + 1 })
      else rejected.push({ property, group: null, reason: 'NO_ELIGIBLE_GROUP' })
    }
  }
  let cursor = 0
  const reservedSchedules = [...schedules]
  const firstAllowedAt = nextAllowedWindowStart(now, postingWindow)
  const preferredTimes = distributedPostingTimes(ordered.length, firstAllowedAt, postingWindow, gapMinutes)
  const horizonEnd = firstAllowedAt + (24 * 60 * 60 * 1000)
  for (const [placementIndex, { property, group, cycle: requestedCycle }] of ordered.entries()) {
    const category = String(property.category || property.kind || '').toUpperCase()
    const groupCategory = String(group.category || '').toUpperCase()
    if (group.active === false || group.needsReview || (category === 'HOUSE' && !['HOUSE', 'MIXED'].includes(groupCategory)) || (category === 'CONDO' && !['CONDO', 'MIXED'].includes(groupCategory))) { rejected.push({ property, group, reason: 'CATEGORY_OR_REVIEW_MISMATCH' }); continue }
    const eligible = accounts.filter((account) => (category === 'HOUSE' ? /duke property/i.test(account.name || '') : true) && groupMembershipFor(account.id, group.url) === 'MEMBER')
    if (!eligible.length) { rejected.push({ property, group, reason: 'NO_MEMBER_ACCOUNT' }); continue }
    const account = eligible[cursor++ % eligible.length]
    const cycle = requestedCycle || 1
    const key = campaignPlacementKey({ campaignId, cd: property.cd || property.id, group: group.url, cycle })
    if (schedules.some((schedule) => schedule.campaignPlacementKey === key)) { alreadyQueued += 1; continue }
    let runAt = nextSafeAccountSlot(account.id, preferredTimes[placementIndex], { schedules: reservedSchedules, gapMinutes })
    // A safety collision may push a job past today's posting window. Move it
    // to the next permitted window and validate its account timeline again.
    for (let attempts = 0; attempts < 4; attempts += 1) {
      const permittedAt = nextAllowedWindowStart(runAt.getTime(), postingWindow)
      if (permittedAt === runAt.getTime()) break
      runAt = nextSafeAccountSlot(account.id, permittedAt, { schedules: reservedSchedules, gapMinutes })
    }
    if (runAt.getTime() >= horizonEnd) {
      rejected.push({ property, group, reason: 'OUTSIDE_24H_HORIZON' })
      continue
    }
    placements.push({ key, cd: property.cd || property.id, postSetId: property.postSetId || property.id, group: group.url, accountId: account.id, cycle, runAt: runAt.toISOString() })
    reservedSchedules.push({ accountId: account.id, runAt: runAt.toISOString(), status: 'pending', results: [] })
  }
  return { campaignId, placements, rejected, alreadyQueued }
}

export function materializeCampaignPlan(plan, { name = 'Campaign' } = {}) { return (plan.placements || []).map((placement) => { const schedule = createSchedule({ name, postSetId: placement.postSetId, groups: [placement.group], accountId: placement.accountId, runAt: placement.runAt }); return updateSchedule(schedule.id, { source: 'campaign', campaignId: plan.campaignId, campaignPlacementKey: placement.key, cycle: placement.cycle }) }) }

export function repairCampaignQueue({ schedules = listSchedules(), gapMinutes = DEFAULT_ACCOUNT_GAP_MINUTES, postingWindow = {}, now = Date.now() } = {}) {
  const pending = schedules.filter((schedule) => schedule.source === 'campaign' && ['pending', 'posting'].includes(schedule.status))
    .sort((a, b) => new Date(a.runAt).getTime() - new Date(b.runAt).getTime())
  const reserved = schedules.filter((schedule) => schedule.source !== 'campaign' || !['pending', 'posting'].includes(schedule.status))
  const earliest = nextAllowedWindowStart(now, postingWindow)
  const repaired = []
  for (const schedule of pending) {
    const wanted = Math.max(earliest, new Date(schedule.runAt).getTime() || earliest)
    const runAt = nextSafeAccountSlot(schedule.accountId, wanted, { schedules: reserved, gapMinutes })
    reserved.push({ accountId: schedule.accountId, runAt: runAt.toISOString(), status: 'pending', results: [] })
    if (runAt.toISOString() !== schedule.runAt) repaired.push(updateSchedule(schedule.id, { runAt: runAt.toISOString() }))
  }
  return repaired
}
