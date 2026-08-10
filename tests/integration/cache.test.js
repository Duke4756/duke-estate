import { describe, expect, it } from 'vitest'
import { openDatabase } from '../../server/db/index.js'
import { createCacheRepository } from '../../server/db/repositories/cache.js'

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
})
