import { describe, expect, it } from 'vitest'
import { mergeAutoCampaignRuntime } from '../../src/autoCampaignState.js'

describe('auto campaign status polling', () => {
  it('keeps unsaved form selections while refreshing scheduler state', () => {
    const current = {
      groups: ['group-b'],
      accountIds: ['secondary'],
      intervalMinutes: 45,
      accountState: { secondary: { nextRunAt: 'old' } },
      rotationState: { cycle: 1 },
    }
    const server = {
      groups: ['group-a', 'group-b'],
      accountIds: ['primary'],
      intervalMinutes: 30,
      accountState: { primary: { nextRunAt: 'new' } },
      rotationState: { cycle: 2 },
    }

    expect(mergeAutoCampaignRuntime(current, server)).toEqual({
      groups: ['group-b'],
      accountIds: ['secondary'],
      intervalMinutes: 45,
      accountState: { primary: { nextRunAt: 'new' } },
      rotationState: { cycle: 2 },
    })
  })

  it('uses the server campaign for the first status response', () => {
    const server = { groups: ['group-a'], accountState: {} }
    expect(mergeAutoCampaignRuntime(null, server)).toBe(server)
  })
})
