import { describe, expect, it } from 'vitest'
import { accountPostingRule, chooseAutoPostSet, randomizedCycleDelayMs, resetPostSetRotation, takeNextDiversePostSet } from '../../server/autoCampaigns.js'
import { ACCOUNT_POST_GAP_MS, calculateRemainingAccountPostGap } from '../../server/schedules.js'

describe('automatic posting campaigns', () => {
  const sets = [
    { id: 'old', name: 'เดิม', createdAt: '2026-07-01T00:00:00.000Z' },
    { id: 'new', name: 'ทรัพย์ใหม่', createdAt: '2026-07-30T00:00:00.000Z' },
  ]
  const settings = {
    postSetIds: [],
    postSetMode: 'all',
    priorityNewHours: 72,
    accountState: {},
  }

  it('prioritizes a recent set not yet posted by that account', () => {
    expect(chooseAutoPostSet({
      settings,
      sets,
      accountId: 'a',
      alreadyPostedIds: ['old'],
      now: new Date('2026-07-31T00:00:00.000Z').getTime(),
    }).id).toBe('new')
  })

  it('tracks the 30-minute gap independently for each account', () => {
    const now = Date.now()
    const posts = [{ accountId: 'a', atMs: now - 5 * 60_000 }]
    expect(calculateRemainingAccountPostGap(posts, 'a', now)).toBe(ACCOUNT_POST_GAP_MS - 5 * 60_000)
    expect(calculateRemainingAccountPostGap(posts, 'b', now)).toBe(0)
  })

  it('assigns every room only once and waits for a new room after all are covered', () => {
    const diverseSets = ['room-1', 'room-2', 'room-3', 'room-4'].map((id) => ({ id }))
    const diverseSettings = {
      postSetIds: [],
      postSetMode: 'all',
      rotationState: { cycle: 1, usedPostSetIds: [] },
    }
    const reserved = []
    for (let index = 0; index < 3; index += 1) {
      reserved.push(takeNextDiversePostSet({ settings: diverseSettings, sets: diverseSets, reservedIds: reserved }).id)
    }
    expect(reserved).toEqual(['room-1', 'room-2', 'room-3'])
    expect(takeNextDiversePostSet({ settings: diverseSettings, sets: diverseSets }).id).toBe('room-4')
    expect(takeNextDiversePostSet({ settings: diverseSettings, sets: diverseSets })).toBeNull()
    expect(diverseSettings.rotationState.cycle).toBe(1)
  })

  it('makes a newly imported room eligible even during an active cycle', () => {
    const diverseSettings = {
      postSetIds: [],
      postSetMode: 'all',
      rotationState: { cycle: 3, usedPostSetIds: ['old-1', 'old-2'] },
    }
    const picked = takeNextDiversePostSet({ settings: diverseSettings, sets: [{ id: 'new' }, { id: 'old-1' }, { id: 'old-2' }] })
    expect(picked.id).toBe('new')
  })

  it('jitters a 30-minute cycle by a full 3-5 minutes in either direction', () => {
    expect(randomizedCycleDelayMs(30, () => 0)).toBe(27 * 60_000)
    const values = [1, 1]
    expect(randomizedCycleDelayMs(30, () => values.shift())).toBe(35 * 60_000)
  })

  it('uses a separate burst size and interval for each account', () => {
    const configured = { burstSize: 2, intervalMinutes: 30, accountRules: { duke: { burstSize: 4, intervalMinutes: 75 } } }
    expect(accountPostingRule(configured, 'duke')).toEqual({ burstSize: 4, intervalMinutes: 75 })
    expect(accountPostingRule(configured, 'other')).toEqual({ burstSize: 2, intervalMinutes: 30 })
  })

  it('clears used rooms when the operator explicitly starts a new round', () => {
    expect(resetPostSetRotation({ cycle: 11, usedPostSetIds: ['room-1'], lastPostSetId: 'room-1' }))
      .toEqual({ cycle: 12, usedPostSetIds: [], lastPostSetId: null })
  })
})
