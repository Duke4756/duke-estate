import { describe, expect, it } from 'vitest'
import { parseFacebookDate } from '../server/scraper.js'

describe('fast Facebook timestamp parsing', () => {
  const now = new Date('2026-08-02T10:00:00.000Z')

  it.each([
    ['30 นาที', '2026-08-02T09:30:00.000Z'],
    ['2 ชม.', '2026-08-02T08:00:00.000Z'],
    ['3 hours', '2026-08-02T07:00:00.000Z'],
    ['1 วัน', '2026-08-01T10:00:00.000Z'],
    ['15 minutes', '2026-08-02T09:45:00.000Z'],
  ])('parses %s without hovering', (text, expected) => {
    expect(parseFacebookDate(text, now)?.toISOString()).toBe(expected)
  })

  it('returns null for an unreadable scrambled value', () => {
    expect(parseFacebookDate('abc')).toBeNull()
  })
})
