import { describe, expect, it } from 'vitest'
import { openDatabase } from '../../server/db/index.js'
import { createCacheRepository, pruneExtractionCache } from '../../server/db/repositories/cache.js'

describe('versioned extraction cache', () => {
  it('does not reuse results across pipeline versions', () => {
    const db = openDatabase(':memory:')
    const cache = createCacheRepository(db)
    cache.set('hash', 'v1', 'dict1', { ok: 1 })
    expect(cache.get('hash', 'v1', 'dict1')).toEqual({ ok: 1 })
    expect(cache.get('hash', 'v2', 'dict1')).toBeNull()
    expect(cache.get('hash', 'v1', 'dict2')).toBeNull()
    db.close()
  })

  it('removes obsolete versions and caps the current LRU cache', () => {
    const db = openDatabase(':memory:')
    const cache = createCacheRepository(db)
    cache.set('old', 'v1', 'dict', { old: true })
    cache.set('new-1', 'v2', 'dict', { value: 1 })
    cache.set('new-2', 'v2', 'dict', { value: 2 })
    const result = pruneExtractionCache(db, { pipelineVersion: 'v2', maxEntries: 1 })
    expect(result).toMatchObject({ obsolete: 1, lru: 1, remaining: 1 })
    db.close()
  })
})
