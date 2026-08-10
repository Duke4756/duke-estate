import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { deterministicExtract } from '../../server/pipeline/deterministicExtractor.js'
import { validateExtraction } from '../../server/pipeline/validator.js'

const dataset = JSON.parse(fs.readFileSync(new URL('../fixtures/golden-posts.json', import.meta.url), 'utf8'))

describe('golden dataset evaluation', () => {
  it('meets intent, schema and critical field gates', () => {
    let intentsCorrect = 0
    let schemaValid = 0
    for (const sample of dataset) {
      const result = deterministicExtract(sample.text)
      if (result.post_intent === sample.intent) intentsCorrect++
      if (validateExtraction(sample.text, result).valid) schemaValid++
      expect(result.properties).toHaveLength(sample.propertyCount)
      if (!result.properties.length) continue
      const property = result.properties[0]
      if ('area' in sample) expect(property.area_sqm).toBe(sample.area)
      if ('rent' in sample) expect(property.rent_price_monthly).toBe(sample.rent)
      if ('sale' in sample) expect(property.sale_price).toBe(sample.sale)
      if ('bedrooms' in sample) expect(property.bedrooms).toBe(sample.bedrooms)
      if ('project' in sample) expect(property.project_name_raw).toBe(sample.project)
    }
    expect(schemaValid / dataset.length).toBe(1)
    expect(intentsCorrect / dataset.length).toBeGreaterThanOrEqual(0.9)
  })
})
