import { describe, expect, it } from 'vitest'
import { accountPostingRule, accountQueueRunTimes, chooseAutoPostSet, consumedAutoPostSetIds, randomizedCycleDelayMs, reconcilePostSetRotation, resetPostSetRotation, takeNextDiversePostSet } from '../../server/autoCampaigns.js'
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

  it('releases failed rooms while preserving active and unconfirmed reservations', () => {
    expect(reconcilePostSetRotation({
      cycle: 4,
      usedPostSetIds: ['failed-room', 'pending-room', 'unconfirmed-room'],
      lastPostSetId: 'failed-room',
    }, ['pending-room', 'unconfirmed-room'])).toEqual({
      cycle: 4,
      usedPostSetIds: ['pending-room', 'unconfirmed-room'],
      lastPostSetId: null,
    })
  })

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

  it('stops after every room is covered instead of recycling old rooms and photos', () => {
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

  it('does not recycle a room that is still reserved by a pending verification', () => {
    const diverseSettings = {
      postSetIds: [],
      postSetMode: 'all',
      rotationState: { cycle: 2, usedPostSetIds: ['room-1', 'room-2'], lastPostSetId: 'room-2' },
    }
    const picked = takeNextDiversePostSet({
      settings: diverseSettings,
      sets: [{ id: 'room-1' }, { id: 'room-2' }, { id: 'room-3' }],
      reservedIds: ['room-3'],
    })
    expect(picked).toBeNull()
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

  it('spaces posts inside each account queue instead of spacing accounts', () => {
    const accountA = accountQueueRunTimes({ now: 0, count: 3, intervalMinutes: 30, random: () => 0 })
    const accountB = accountQueueRunTimes({ now: 0, count: 2, intervalMinutes: 60, random: () => 0 })
    expect(accountA.times).toEqual([0, 27 * 60_000, 54 * 60_000])
    expect(accountA.nextRunAt).toBe(81 * 60_000)
    expect(accountB.times).toEqual([0, 57 * 60_000])
    expect(accountB.nextRunAt).toBe(114 * 60_000)
    expect(accountA.times[0]).toBe(accountB.times[0])
  })

  it('clears used rooms when the operator explicitly starts a new round', () => {
    expect(resetPostSetRotation({ cycle: 11, usedPostSetIds: ['room-1'], lastPostSetId: 'room-1' }))
      .toEqual({ cycle: 12, usedPostSetIds: [], lastPostSetId: null })
  })

  it('selects verified auto rooms for deletion but preserves active and failed rooms', () => {
    expect(consumedAutoPostSetIds([
      { source: 'auto', postSetId: 'done', status: 'done', results: [{ ok: true, verified: 'facebook_api' }] },
      { source: 'auto', postSetId: 'active', status: 'posting', results: [{ ok: true, verified: 'facebook_api' }] },
      { source: 'auto', postSetId: 'failed', status: 'failed', results: [{ ok: false }] },
      { source: 'manual', postSetId: 'manual', status: 'done', results: [{ ok: true, verified: 'permalink' }] },
    ])).toEqual(['done'])
  })
})
