import { describe, expect, it } from 'vitest'
import { validateOwnerListingExtraction } from '../../server/pipeline/ownerListingSchema.js'

const field = (value, evidence = [], confidence = 0.9, conflict = null) => ({ value, confidence, evidence, conflict })
const listing = (patch = {}) => ({
  property_type: field('condominium', ['คอนโด']),
  project_name_raw: field(null), bedroom_count: field(null), bathroom_count: field(null),
  room_variant: field('unknown'), layout_type: field('unknown'), area_sqm: field(null),
  rent_price_monthly: field(null), sale_price: field(null), nearby_transit: field(null),
  pet_status: field('unknown'), contact_name: field(null), contact_phone: field(null),
  ...patch,
})

describe('owner listing extraction schema', () => {
  it('accepts evidenced owner listing fields', () => {
    const text = 'เจ้าของปล่อยเช่า คอนโด 1 Bed Plus Duplex เลี้ยงแมวได้'
    const result = {
      post_type: field('owner_rent', ['เจ้าของปล่อยเช่า']),
      listing: listing({
        bedroom_count: field(1, ['1 Bed']), room_variant: field('plus', ['Plus']),
        layout_type: field('duplex', ['Duplex']),
        pet_status: field('owner_allowed_building_unknown', ['เลี้ยงแมวได้']),
      }), warnings: [],
    }
    expect(validateOwnerListingExtraction(text, result)).toBe(result)
    expect(result.listing.bedroom_count.value).toBe(1)
  })

  it('rejects evidence that is not in the source', () => {
    const result = { post_type: field('owner_rent', ['เจ้าของ']), listing: listing({ bedroom_count: field(2, ['2 Bedroom']) }), warnings: [] }
    expect(() => validateOwnerListingExtraction('เจ้าของปล่อยเช่า คอนโด 1 Bed Plus', result)).toThrow(/evidence/)
  })

  it('requires multiple listings to avoid inventing one combined unit', () => {
    const result = { post_type: field('multiple_listings', ['หลายห้อง']), listing: listing(), warnings: [] }
    expect(() => validateOwnerListingExtraction('มีหลายห้องให้เลือก', result)).toThrow(/multiple_listings/)
  })

  it('does not allow evidence on unknown values', () => {
    const result = { post_type: field('owner_rent', ['ปล่อยเช่า']), listing: listing({ pet_status: field('unknown', ['pet']) }), warnings: [] }
    expect(() => validateOwnerListingExtraction('ปล่อยเช่า คอนโด pet', result)).toThrow(/unknown/)
  })
})
