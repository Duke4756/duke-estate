import { describe, expect, it } from 'vitest'
import { rotateGroupsForAccount } from '../../server/schedules.js'

describe('posting group rotation', () => {
  const schedules = [
    {
      accountId: 'duke',
      results: [
        { group: 'group-a', at: '2026-08-10T10:00:00Z' },
        { group: 'group-b', at: '2026-08-09T10:00:00Z' },
      ],
    },
    {
      accountId: 'other',
      results: [{ group: 'group-c', at: '2026-08-11T10:00:00Z' }],
    },
  ]

  it('uses never-attempted groups before groups recently used by the same account', () => {
    expect(rotateGroupsForAccount(['group-a', 'group-b', 'group-c'], 'duke', schedules, () => 0.5))
      .toEqual(['group-c', 'group-b', 'group-a'])
  })

  it('keeps rotation history isolated per account', () => {
    expect(rotateGroupsForAccount(['group-a', 'group-c'], 'other', schedules, () => 0.5))
      .toEqual(['group-a', 'group-c'])
  })
})
