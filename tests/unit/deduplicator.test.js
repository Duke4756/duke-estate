import { describe, expect, it } from 'vitest'
import { duplicateSignals } from '../../server/pipeline/deduplicator.js'

describe('deduplicator', () => {
  it('does not group sparse properties just because their transaction type matches', () => {
    const first = { transaction_type: 'rent' }
    const second = { transaction_type: 'rent' }
    expect(duplicateSignals(first, second).duplicate).toBe(false)
  })

  it('reports a useful fingerprint match without deleting either record', () => {
    const first = { project_id: 'p1', transaction_type: 'rent', area_sqm: 35, rent_price_monthly: 18000 }
    const second = { ...first }
    expect(duplicateSignals(first, second)).toMatchObject({
      duplicate: true,
      reasons: ['property_fingerprint'],
    })
  })
})
