import { describe, expect, it } from 'vitest'
import { deterministicExtract } from '../../server/pipeline/deterministicExtractor.js'
import { validateExtraction } from '../../server/pipeline/validator.js'

describe('extraction contract', () => {
  it('accepts deterministic results with evidence', () => {
    const raw = 'ปล่อยเช่า ห้องสตูดิโอ 28 ตร.ม. ค่าเช่า 18,000 บาท/เดือน เลี้ยงสัตว์ได้'
    const result = deterministicExtract(raw)
    expect(validateExtraction(raw, result)).toEqual({ valid: true, errors: [] })
  })

  it('rejects evidence not present in the raw post', () => {
    const raw = 'ปล่อยเช่า 20,000 บาท/เดือน'
    const result = deterministicExtract(raw)
    result.properties[0].evidence[0].quote = 'ข้อความที่ไม่มีจริง'
    const validation = validateExtraction(raw, result)
    expect(validation.valid).toBe(false)
    expect(validation.errors.join(' ')).toContain('quote not found')
  })
})
