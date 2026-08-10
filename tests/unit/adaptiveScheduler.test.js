import { afterEach, describe, expect, it } from 'vitest'
import { openDatabase } from '../../server/db/index.js'
import { createAdaptiveScheduler, scoreSource } from '../../server/services/adaptiveScheduler.js'
import { createSourceRegistry } from '../../server/services/sourceRegistry.js'

const databases = []
afterEach(() => databases.splice(0).forEach((db) => db.close()))
function setup() { const db = openDatabase(':memory:'); databases.push(db); const registry = createSourceRegistry(db); return { db, registry, scheduler: createAdaptiveScheduler(db, registry) } }
function active(registry, id) { const source = registry.addCandidate({ url: `https://facebook.com/groups/${id}`, name: 'ขายคอนโด' }); return registry.authorize(source.id, { authorized: true, accessible: true }) }

describe('adaptive scheduler', () => {
  it('rewards yield, owner leads, coverage gaps and exploration; penalizes duplicates', () => {
    const base = { estimated_collection_cost: 1, last_success_at: new Date().toISOString() }
    expect(scoreSource({ ...base, unique_listing_yield: 3, owner_lead_yield: 2 })).toBeGreaterThan(scoreSource({ ...base, unique_listing_yield: 1 }))
    expect(scoreSource({ ...base, duplicate_rate: 0.9 })).toBeLessThan(scoreSource({ ...base, duplicate_rate: 0 }))
    expect(scoreSource({ ...base, posts_seen: 0 })).toBeGreaterThan(scoreSource({ ...base, posts_seen: 10 }))
    expect(scoreSource(base, { coverageGap: 1 })).toBeGreaterThan(scoreSource(base, { coverageGap: 0 }))
  })
  it('creates one idempotent job per source and lock claims it once', () => {
    const { db, registry, scheduler } = setup(); active(registry, 1)
    expect(scheduler.plan()).toHaveLength(1)
    expect(scheduler.plan()).toHaveLength(0)
    expect(scheduler.claim('worker-a')?.status).toBe('RUNNING')
    expect(scheduler.claim('worker-b')).toBeNull()
    expect(db.prepare('SELECT COUNT(*) count FROM source_crawl_jobs').get().count).toBe(1)
  })
  it('prioritizes freshness lane before backfill and resumes checkpoints', () => {
    const { db, registry, scheduler } = setup(); const source = active(registry, 1)
    db.prepare("UPDATE source_groups SET latest_checkpoint='post-20',oldest_backfill_checkpoint='post-5' WHERE id=?").run(source.id)
    const freshness = scheduler.plan({ lane: 'FRESHNESS' })[0]
    expect(freshness.checkpoint_before).toBe('post-20')
    expect(scheduler.plan({ lane: 'BACKFILL' })).toEqual([])
    scheduler.complete(freshness.id, { checkpoint: 'post-21' })
    expect(scheduler.plan({ lane: 'BACKFILL' })[0].checkpoint_before).toBe('post-5')
  })
})
