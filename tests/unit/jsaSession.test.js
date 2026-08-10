import { describe, expect, it } from 'vitest'
import { isJsaPropertyUrl } from '../../server/jsaSession.js'

describe('JSA admin property URL contract', () => {
  it('keeps authenticated importer links scoped to the JSA property detail route', () => {
    expect(isJsaPropertyUrl('https://www.jsa.co.th/admin/property/view/155080')).toBe(true)
    expect(isJsaPropertyUrl('https://www.jsa.co.th/admin/users')).toBe(false)
    expect(isJsaPropertyUrl('https://evil.example/admin/property/view/155080')).toBe(false)
  })
})
