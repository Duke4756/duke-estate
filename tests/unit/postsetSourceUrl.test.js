import { describe, expect, it } from 'vitest'
import { normalizeSourceUrl } from '../../server/postsets.js'

describe('post-set source URL normalization', () => {
  it('ignores fragments and a trailing slash when detecting duplicate imports', () => {
    expect(normalizeSourceUrl('https://example.com/property/42/#gallery')).toBe('https://example.com/property/42')
  })

  it('preserves query parameters that may identify a listing', () => {
    expect(normalizeSourceUrl('https://example.com/property?id=42')).toBe('https://example.com/property?id=42')
  })
})
