import { afterEach, describe, expect, it } from 'vitest'
import { openDatabase } from '../../server/db/index.js'
import { canonicalFacebookGroup, createSourceRegistry, normalizeGroupName } from '../../server/services/sourceRegistry.js'

const databases = []
afterEach(() => databases.splice(0).forEach((db) => db.close()))
function setup() { const db = openDatabase(':memory:'); databases.push(db); return { db, registry: createSourceRegistry(db) } }

describe('source registry', () => {
  it('normalizes URL variants and preserves Thai names', () => {
    expect(canonicalFacebookGroup('https://m.facebook.com/groups/123/?ref=share')).toEqual({ identity: '123', sourceGroupId: '123', canonicalUrl: 'https://www.facebook.com/groups/123' })
    expect(normalizeGroupName('ขาย คอนโด กรุงเทพฯ')).toBe('ขาย คอนโด กรุงเทพฯ')
  })
  it('deduplicates by group id and a rename does not create a source', () => {
    const { registry } = setup()
    const first = registry.addCandidate({ url: 'https://facebook.com/groups/123', name: 'ชื่อเดิม' })
    const renamed = registry.addCandidate({ url: 'https://web.facebook.com/groups/123/?x=1', name: 'ชื่อใหม่' })
    expect(renamed.id).toBe(first.id)
    expect(registry.list()).toHaveLength(1)
    expect(renamed.group_name).toBe('ชื่อใหม่')
    expect(first._created).toBe(true)
    expect(renamed._created).toBe(false)
  })
  it('never schedules discovered, paused or inaccessible sources', () => {
    const { registry } = setup()
    const discovered = registry.addCandidate({ url: 'https://facebook.com/groups/1' })
    const active = registry.addCandidate({ url: 'https://facebook.com/groups/2' })
    registry.authorize(active.id, { authorized: true, accessible: true })
    const inaccessible = registry.addCandidate({ url: 'https://facebook.com/groups/3' })
    registry.authorize(inaccessible.id, { authorized: true, accessible: false })
    registry.setStatus(active.id, 'PAUSED')
    expect(registry.schedulable()).toEqual([])
    expect(registry.get(discovered.id).authorization_status).toBe('DISCOVERED')
  })
})
