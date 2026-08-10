import { describe, expect, it } from 'vitest'
import { normalizeFacebookGroupUrl } from '../../server/groupMembership.js'

describe('normalizeFacebookGroupUrl', () => {
  it('keeps only the canonical Facebook group address', () => {
    expect(normalizeFacebookGroupUrl('https://web.facebook.com/groups/12345/posts/999/?ref=share'))
      .toBe('https://www.facebook.com/groups/12345/')
  })

  it('rejects non-Facebook and non-group links', () => {
    expect(() => normalizeFacebookGroupUrl('https://example.com/groups/123')).toThrow()
    expect(() => normalizeFacebookGroupUrl('https://www.facebook.com/profile.php')).toThrow()
  })
})
