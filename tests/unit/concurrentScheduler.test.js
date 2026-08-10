import { describe, expect, it } from 'vitest'
import { selectConcurrentDueSchedules } from '../../server/concurrentScheduler.js'

describe('concurrent account scheduler', () => {
  const now = new Date('2026-08-01T12:00:00Z').getTime()
  const schedule = (id, accountId, minutes = 0) => ({
    id, accountId, status: 'pending', runAt: new Date(now + minutes * 60_000).toISOString(),
  })

  it('starts one due job for each different ready account at the same time', () => {
    const selected = selectConcurrentDueSchedules({
      schedules: [schedule('a1', 'a'), schedule('b1', 'b'), schedule('c1', 'c')],
      now,
      readyAccountIds: ['a', 'b', 'c'],
    })
    expect(selected.map((item) => item.id)).toEqual(['a1', 'b1', 'c1'])
  })

  it('keeps the earliest job only when one account has several due jobs', () => {
    const selected = selectConcurrentDueSchedules({
      schedules: [schedule('a-later', 'a'), schedule('a-first', 'a', -10), schedule('b', 'b')],
      now,
      readyAccountIds: ['a', 'b'],
    })
    expect(selected.map((item) => item.id)).toEqual(['a-first', 'b'])
  })

  it('respects per-account cooldown without blocking other accounts', () => {
    const selected = selectConcurrentDueSchedules({
      schedules: [schedule('a', 'a'), schedule('b', 'b')],
      now,
      readyAccountIds: ['a', 'b'],
      remainingGapByAccount: { a: 15 * 60_000, b: 0 },
    })
    expect(selected.map((item) => item.id)).toEqual(['b'])
  })
})
