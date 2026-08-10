export function selectConcurrentDueSchedules({
  schedules,
  now = Date.now(),
  inflightIds = [],
  runningAccountIds = [],
  readyAccountIds = [],
  remainingGapByAccount = {},
}) {
  const inflight = new Set(inflightIds)
  const claimedAccounts = new Set(runningAccountIds)
  const ready = new Set(readyAccountIds)
  return [...(schedules || [])]
    .sort((a, b) => new Date(a.runAt).getTime() - new Date(b.runAt).getTime())
    .filter((schedule) => {
      if (schedule.status !== 'pending' || inflight.has(schedule.id)) return false
      const accountId = schedule.accountId || 'primary'
      if (claimedAccounts.has(accountId) || !ready.has(accountId)) return false
      // Automatic campaigns own their cadence via accountState.nextRunAt and
      // may intentionally contain the second item of a two-post burst.
      if (schedule.source !== 'auto' && Number(remainingGapByAccount[accountId]) > 0) return false
      const dueAt = new Date(schedule.runAt).getTime()
      if (!Number.isFinite(dueAt) || dueAt > now) return false
      claimedAccounts.add(accountId)
      return true
    })
}
