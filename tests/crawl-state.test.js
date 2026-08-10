import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import { openDatabase } from '../server/db/index.js'
import { createCrawlStateRepository, normalizeGroupKey } from '../server/db/repositories/crawlState.js'

let db
afterEach(() => db?.close())

describe('persistent crawl state', () => {
  it('remembers every discovered post even before extraction', () => {
    db = openDatabase(':memory:')
    const state = createCrawlStateRepository(db)
    const post = {
      sourcePostId: '123456',
      groupUrl: 'https://www.facebook.com/groups/999/',
      sourceUrl: 'https://www.facebook.com/groups/999/posts/123456/',
      text: 'โพสต์ที่ไม่จำเป็นต้องผ่านตัวคัดกรอง',
    }

    expect(state.markSeen(post)).toBe(false)
    expect(state.markSeen(post)).toBe(true)
    expect(state.isKnown('123456')).toBe(true)
    expect(state.countSeen()).toBe(1)
    const row = db.prepare('SELECT seen_count FROM crawl_seen_posts').get()
    expect(row.seen_count).toBe(2)
  })

  it('increases historical depth after each completed run with a hard cap', () => {
    db = openDatabase(':memory:')
    const state = createCrawlStateRepository(db)
    const group = 'https://web.facebook.com/groups/CondoOwners/'

    expect(normalizeGroupKey(group)).toBe('condoowners')
    expect(state.recommendedDepth(group, 6)).toBe(6)
    state.start(group, '2026-07-26T00:00:00.000Z')
    state.complete(group, { depth: 6, seen: 20, fresh: 20 })
    expect(state.recommendedDepth(group, 6)).toBe(10)
    expect(state.get(group).last_depth).toBe(6)
    state.complete(group, { depth: 119, seen: 200, fresh: 5 })
    expect(state.recommendedDepth(group, 6)).toBe(120)
    expect(state.get(group).total_new_count).toBe(25)
    expect(state.list()).toEqual([
      expect.objectContaining({
        source_group_key: 'condoowners',
        completed_runs: 2,
        last_depth: 119,
        last_new_count: 5,
        total_new_count: 25,
      }),
    ])
  })

  it('creates the crawl tables through the normal schema bootstrap', () => {
    db = new Database(':memory:')
    expect(() => createCrawlStateRepository(db).countSeen()).toThrow()
    db.close()
    db = openDatabase(':memory:')
    expect(createCrawlStateRepository(db).countSeen()).toBe(0)
  })
})
