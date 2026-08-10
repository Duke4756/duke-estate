import { describe, expect, it, vi } from 'vitest'
import { createOwnerListingExtractionService } from '../../server/services/ownerListingExtractionService.js'

const field = (value, evidence = []) => ({ value, confidence: value == null || value === 'unknown' ? 0 : 0.9, evidence, conflict: null })
const result = {
  post_type: field('owner_rent', ['เจ้าของปล่อยเช่า']), warnings: [],
  listing: {
    property_type: field('condominium', ['คอนโด']), project_name_raw: field(null),
    bedroom_count: field(1, ['1 Bed']), bathroom_count: field(null), room_variant: field('plus', ['Plus']),
    layout_type: field('duplex', ['Duplex']), area_sqm: field(null), rent_price_monthly: field(null),
    sale_price: field(null), nearby_transit: field(null), pet_status: field('unknown'),
    contact_name: field(null), contact_phone: field(null),
  },
}
const post = { id: 'p1', category: 'owner_rent', text: 'เจ้าของปล่อยเช่า คอนโด 1 Bed Plus Duplex' }

describe('owner listing extraction service', () => {
  it('caches unchanged Thai/English content and does not call AI twice', async () => {
    const extract = vi.fn().mockResolvedValue({ result, rawResponse: JSON.stringify(result) })
    const service = createOwnerListingExtractionService({ extract })
    expect((await service.preview(post)).cacheHit).toBe(false)
    expect((await service.preview(post)).cacheHit).toBe(true)
    expect(extract).toHaveBeenCalledTimes(1)
  })

  it('requires explicit force for rejected or unknown posts', async () => {
    const extract = vi.fn().mockResolvedValue({ result, rawResponse: '{}' })
    const service = createOwnerListingExtractionService({ extract })
    await expect(service.preview({ ...post, category: 'unknown' })).rejects.toMatchObject({ code: 'EXTRACTION_NOT_ELIGIBLE' })
    await expect(service.preview({ ...post, category: 'unknown' }, { force: true })).resolves.toMatchObject({ status: 'pending_review' })
  })

  it('surfaces invalid JSON, timeout, rate limit and empty results by code', async () => {
    for (const code of ['INVALID_JSON', 'TIMEOUT', 'RATE_LIMIT']) {
      const extract = vi.fn().mockRejectedValue(Object.assign(new Error(code), { code }))
      await expect(createOwnerListingExtractionService({ extract }).preview(post)).rejects.toMatchObject({ code })
    }
    await expect(createOwnerListingExtractionService({ extract: vi.fn().mockResolvedValue(null) }).preview(post)).rejects.toMatchObject({ code: 'EMPTY_RESULT' })
  })
})
