import { describe, expect, it } from 'vitest'
import { nextSafeAccountSlot, campaignPlacementKey, distributedPostingTimes, nextAllowedWindowStart, DEFAULT_ACCOUNT_GAP_MINUTES } from '../../server/campaignRuleEngine.js'

const at = '2026-09-08T12:00:00.000Z'
describe('campaign rule engine safety', () => {
  it('uses a 65 minute default gap and reschedules pending jobs', () => {
    const next = nextSafeAccountSlot('a', at, { schedules: [{ accountId: 'a', runAt: at, status: 'pending' }] })
    expect(new Date(next).getTime() - new Date(at).getTime()).toBe(DEFAULT_ACCOUNT_GAP_MINUTES * 60000)
  })
  it('allows different accounts at the same time', () => {
    const next = nextSafeAccountSlot('b', at, { schedules: [{ accountId: 'a', runAt: at, status: 'pending' }] })
    expect(next.toISOString()).toBe(at)
  })
  it('checks verified history and keeps duplicate keys deterministic', () => {
    const next = nextSafeAccountSlot('a', at, { schedules: [{ accountId: 'a', results: [{ ok: true, verified: 'permalink', postUrl: 'x', at }], status: 'done' }] })
    expect(new Date(next).getTime()).toBe(new Date(at).getTime() + 65 * 60000)
    expect(campaignPlacementKey({ campaignId: 'c', cd: 'CD-1', group: 'g', cycle: 2 })).toBe('c:CD-1:g:2')
  })
  it('moves a queue that misses posting hours to the next allowed day', () => {
    const afterHours = Date.parse('2026-09-08T16:30:00.000Z') // 23:30 Bangkok
    expect(new Date(nextAllowedWindowStart(afterHours, { start: '08:00', end: '22:00' })).toISOString()).toBe('2026-09-09T01:00:00.000Z')
  })
  it('spreads multiple posts across the allowed window', () => {
    const times = distributedPostingTimes(3, Date.parse('2026-09-08T01:00:00.000Z'), { start: '08:00', end: '22:00' })
    expect(times.map((time) => time.toISOString())).toEqual([
      '2026-09-08T01:00:00.000Z',
      '2026-09-08T05:40:00.000Z',
      '2026-09-08T10:20:00.000Z',
    ])
  })
})
