import { describe, expect, it } from 'vitest'
import { isWithinPostingWindow, nextPostingWindowStart } from '../server/postingSettings.js'

const settings = {
  enabled: true,
  startTime: '08:00',
  endTime: '22:00',
  timezone: 'Asia/Bangkok',
}

describe('posting working hours', () => {
  it('allows posting only inside the configured Bangkok window', () => {
    expect(isWithinPostingWindow(new Date('2026-07-26T01:00:00.000Z'), settings)).toBe(true)
    expect(isWithinPostingWindow(new Date('2026-07-26T14:59:00.000Z'), settings)).toBe(true)
    expect(isWithinPostingWindow(new Date('2026-07-26T15:00:00.000Z'), settings)).toBe(false)
    expect(isWithinPostingWindow(new Date('2026-07-25T23:59:00.000Z'), settings)).toBe(false)
  })

  it('moves an after-hours run to 08:00 Bangkok on the next day', () => {
    expect(nextPostingWindowStart(new Date('2026-07-26T16:00:00.000Z'), settings).toISOString())
      .toBe('2026-07-27T01:00:00.000Z')
  })

  it('moves a before-hours run to 08:00 Bangkok on the same day', () => {
    expect(nextPostingWindowStart(new Date('2026-07-26T00:30:00.000Z'), settings).toISOString())
      .toBe('2026-07-26T01:00:00.000Z')
  })

  it('supports a window that crosses midnight', () => {
    const overnight = { ...settings, startTime: '20:00', endTime: '02:00' }
    expect(isWithinPostingWindow(new Date('2026-07-26T16:00:00.000Z'), overnight)).toBe(true)
    expect(isWithinPostingWindow(new Date('2026-07-26T00:00:00.000Z'), overnight)).toBe(false)
  })
})
