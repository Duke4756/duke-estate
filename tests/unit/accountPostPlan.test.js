import { describe, expect, it, vi, beforeEach } from 'vitest'
import { accountPlanEntries, nextAccountOccurrence, validateAccountPlan } from '../../server/accountPostPlan.js'

const memory = vi.hoisted(() => ({ settings: {}, schedules: [] }))
vi.mock('node:fs', () => ({ default: {
  readFileSync: () => JSON.stringify(memory.settings), mkdirSync: () => {},
  writeFileSync: (_file, value) => { memory.settings = JSON.parse(value) },
} }))
vi.mock('../../server/schedules.js', () => ({
  listSchedules: () => memory.schedules, remainingAccountPostGap: () => 0,
  createSchedule: (input) => { const run = { ...input, id: String(memory.schedules.length + 1), status: 'pending' }; memory.schedules.push(run); return run },
  updateSchedule: (id, patch) => Object.assign(memory.schedules.find((run) => run.id === id), patch),
}))
vi.mock('../../server/postsets.js', () => ({ isPublishableRentalPostSet: () => true }))
import { materializeAutoCampaign, saveAutoCampaign } from '../../server/autoCampaigns.js'

const rule = { postSetIds: ['a', 'b'], groups: ['group-1', 'group-2'], startDate: '2026-09-08', time: '09:00', intervalMinutes: 30, repeatDaily: false }
const now = Date.parse('2026-09-07T10:00:00+07:00')
const sets = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }]
const input = () => ({ mode: 'account_schedule', enabled: true, accountIds: ['first', 'second'], accountRules: { first: rule, second: { ...rule, postSetIds: ['c'], groups: ['group-3'], time: '14:00' } }, intervalMinutes: 30, priorityNewHours: 72, postSetMode: 'all', groupMode: 'selected', groups: [] })
beforeEach(() => { memory.settings = {}; memory.schedules = [] })

describe('account posting plans', () => {
  it('expands selected properties and groups in order at Bangkok times', () => {
    const entries = accountPlanEntries(rule, nextAccountOccurrence(rule, null, now))
    expect(entries).toEqual([
      { postSetId: 'a', group: 'group-1', runAt: '2026-09-08T02:00:00.000Z' },
      { postSetId: 'a', group: 'group-2', runAt: '2026-09-08T02:30:00.000Z' },
      { postSetId: 'b', group: 'group-1', runAt: '2026-09-08T03:00:00.000Z' },
      { postSetId: 'b', group: 'group-2', runAt: '2026-09-08T03:30:00.000Z' },
    ])
  })
  it('starts a new daily plan tomorrow when today’s time has passed', () => {
    expect(nextAccountOccurrence({ ...rule, repeatDaily: true }, null, Date.parse('2026-09-08T10:00:00+07:00'))).toBe(Date.parse('2026-09-09T09:00:00+07:00'))
  })
  it('retains disabled account settings without requiring stock selection', () => {
    const config = input(); config.accountIds = ['first']; config.accountRules.second = { ...rule, postSetIds: [], groups: [] }
    expect(saveAutoCampaign(config).accountRules.second.postSetIds).toEqual([])
  })
  it('rejects empty selections, invalid dates and daily plans longer than a day', () => {
    expect(() => validateAccountPlan({ ...rule, postSetIds: [] })).toThrow()
    expect(() => validateAccountPlan({ ...rule, groups: [] })).toThrow()
    expect(() => validateAccountPlan({ ...rule, startDate: '2026-02-30' })).toThrow()
    expect(() => validateAccountPlan({ ...rule, repeatDaily: true, intervalMinutes: 500 })).toThrow()
  })
  it('persists independent selections and schedules with no random groups or times', () => {
    saveAutoCampaign(input())
    expect(memory.settings).toMatchObject({ enabled: true, mode: 'account_schedule' })
    const runs = materializeAutoCampaign({ sets, readyAccountIds: ['first', 'second'], now })
    expect(runs).toHaveLength(5)
    expect(runs.filter((run) => run.accountId === 'first').map((run) => run.postSetId)).toEqual(['a', 'a', 'b', 'b'])
    expect(runs.find((run) => run.accountId === 'second')).toMatchObject({ postSetId: 'c', groups: ['group-3'], runAt: '2026-09-08T07:00:00.000Z' })
    expect(materializeAutoCampaign({ sets, readyAccountIds: ['first', 'second'], now })).toEqual([])
    memory.schedules.forEach((run) => { run.status = 'done' })
    expect(materializeAutoCampaign({ sets, readyAccountIds: ['first', 'second'], now: now + 86400000 })).toEqual([])
  })
  it('repeats the same stock next day and does not repeat on a settings save', () => {
    const config = input(); config.accountRules.first = { ...rule, repeatDaily: true }
    saveAutoCampaign(config)
    materializeAutoCampaign({ sets, readyAccountIds: ['first'], now })
    memory.schedules.forEach((run) => { run.status = 'done' })
    saveAutoCampaign(config)
    const runs = materializeAutoCampaign({ sets, readyAccountIds: ['first'], now: now + 86400000 })
    expect(runs).toHaveLength(4)
    expect(runs[0].runAt).toBe('2026-09-09T02:00:00.000Z')
  })
  it('deduplicates a partially persisted batch after restart', () => {
    saveAutoCampaign(input())
    materializeAutoCampaign({ sets, readyAccountIds: ['first'], now })
    memory.schedules = memory.schedules.slice(0, 1)
    memory.schedules[0].status = 'done'
    memory.settings.accountState = {}
    expect(materializeAutoCampaign({ sets, readyAccountIds: ['first'], now })).toHaveLength(3)
    expect(memory.schedules).toHaveLength(4)
  })
  it('allows accounts to choose the same stock independently', () => {
    const config = input(); config.accountRules.second = { ...rule }
    saveAutoCampaign(config)
    expect(materializeAutoCampaign({ sets, readyAccountIds: ['first', 'second'], now })).toHaveLength(8)
  })
})
