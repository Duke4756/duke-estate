import { describe, expect, it } from 'vitest'
import { filterAndSortSchedules, paginateSchedules } from '../src/components/scheduleQueue.js'

const rows = [
  { id: 'done', name: 'สุขุมวิท', setName: 'ห้อง 27', accountId: 'primary', accountName: 'บัญชีหลัก', status: 'done', runAt: '2026-07-25T10:00:00Z', groups: ['group-a'] },
  { id: 'next', name: 'อโศก', setName: 'ห้อง 26', accountId: 'backup', accountName: 'โปรไฟล์สำรอง', status: 'pending', runAt: '2026-07-27T10:00:00Z', groups: ['group-b'] },
  { id: 'first', name: 'ทองหล่อ', setName: 'ห้อง 25', accountId: 'primary', accountName: 'บัญชีหลัก', status: 'pending', runAt: '2026-07-26T10:00:00Z', groups: ['group-c'] },
]

describe('schedule queue controls', () => {
  it('searches names, post sets, accounts and groups', () => {
    expect(filterAndSortSchedules(rows, { query: 'โปรไฟล์สำรอง' }).map((row) => row.id)).toEqual(['next'])
    expect(filterAndSortSchedules(rows, { query: 'group-a' }).map((row) => row.id)).toEqual(['done'])
  })

  it('combines account/status filters and prioritizes the next pending run', () => {
    expect(filterAndSortSchedules(rows, { status: 'pending', account: 'primary' }).map((row) => row.id)).toEqual(['first'])
    expect(filterAndSortSchedules(rows).map((row) => row.id)).toEqual(['first', 'next', 'done'])
  })

  it('paginates without producing an invalid page after filtering', () => {
    expect(paginateSchedules(rows, 9, 2)).toMatchObject({ page: 2, pages: 2, total: 3 })
    expect(paginateSchedules([], 3, 20)).toMatchObject({ page: 1, pages: 1, total: 0, items: [] })
  })
})
