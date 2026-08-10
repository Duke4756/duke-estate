import Database from 'better-sqlite3'
import fs from 'node:fs'
import { beforeEach, describe, expect, it } from 'vitest'
import { createOwnerListingRepository } from '../../server/db/repositories/ownerListings.js'

const schema = fs.readFileSync(new URL('../../server/db/schema.sql', import.meta.url), 'utf8')
const field = (value, evidence = []) => ({ value, confidence: value == null || value === 'unknown' ? 0 : 0.9, evidence, conflict: null })
const reviewed = {
  post_type: field('owner_rent', ['เจ้าของปล่อยเช่า']), warnings: [],
  listing: {
    property_type: field('condominium', ['คอนโด']), project_name_raw: field('Test Condo', ['Test Condo']),
    bedroom_count: field(1, ['1 ห้องนอน']), bathroom_count: field(null), room_variant: field('standard', ['1 ห้องนอน']),
    layout_type: field('standard', ['1 ห้องนอน']), area_sqm: field(null), rent_price_monthly: field(18000, ['18,000 บาท']),
    sale_price: field(null), nearby_transit: field(null), pet_status: field('unknown'), contact_name: field(null), contact_phone: field(null),
  },
}
const sourceText = 'เจ้าของปล่อยเช่า คอนโด Test Condo 1 ห้องนอน 18,000 บาท'
const draft = (id = '100') => ({ id: `d-${id}`, source: { postId: id, url: `https://www.facebook.com/groups/1/posts/${id}/`, group: 'group-1', text: sourceText, capturedAt: '2026-08-02T01:00:00.000Z', postedAt: '2026-08-01T01:00:00.000Z' }, extraction: reviewed, reviewed, reviewLog: [] })

describe('owner listing repository', () => {
  let db
  beforeEach(() => { db = new Database(':memory:'); db.pragma('foreign_keys = ON'); db.exec(schema) })

  it('creates reviewed source, property, evidence and audit atomically', () => {
    const saved = createOwnerListingRepository(db).confirmAndSave(draft(), reviewed)
    expect(saved.duplicate).toBe(false)
    expect(db.prepare('SELECT COUNT(*) n FROM properties').get().n).toBe(1)
    expect(db.prepare('SELECT COUNT(*) n FROM audit_events').get().n).toBe(1)
  })

  it('does not create a duplicate post and updates last seen', () => {
    const repo = createOwnerListingRepository(db)
    repo.confirmAndSave(draft(), reviewed)
    const next = draft(); next.source.capturedAt = '2026-08-03T01:00:00.000Z'
    expect(repo.confirmAndSave(next, reviewed)).toMatchObject({ duplicate: true, lastSeenAt: next.source.capturedAt })
    expect(db.prepare('SELECT collected_at FROM raw_posts').get().collected_at).toBe(next.source.capturedAt)
  })

  it('rejects invalid reviewed evidence before persisting', () => {
    const bad = structuredClone(reviewed); bad.listing.project_name_raw.evidence = ['Not in source']
    expect(() => createOwnerListingRepository(db).confirmAndSave(draft(), bad)).toThrow(/evidence/)
    expect(db.prepare('SELECT COUNT(*) n FROM raw_posts').get().n).toBe(0)
  })

  it('rolls back every table when a transaction step fails', () => {
    const repo = createOwnerListingRepository(db, { afterRawInsert: () => { throw new Error('forced') } })
    try { repo.confirmAndSave(draft(), reviewed); throw new Error('expected failure') }
    catch (error) { expect(error.code).toBe('TRANSACTION_FAILED') }
    expect(db.prepare('SELECT COUNT(*) n FROM raw_posts').get().n).toBe(0)
  })

  it('persists the user-corrected value', () => {
    const corrected = structuredClone(reviewed)
    corrected.listing.rent_price_monthly = field(17000, ['18,000 บาท'], 0.8, 'ผู้ใช้แก้ราคา')
    const saved = createOwnerListingRepository(db).confirmAndSave(draft('101'), corrected)
    expect(db.prepare('SELECT rent_price_monthly FROM properties WHERE id = ?').get(saved.propertyId).rent_price_monthly).toBe(17000)
  })
})
