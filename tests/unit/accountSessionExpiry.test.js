import { describe, expect, it } from 'vitest'
import { sessionExpiryFromCookies } from '../../server/accounts.js'

describe('Facebook session cookie expiry', () => {
  it('uses the earliest persistent auth-cookie expiry', () => {
    expect(sessionExpiryFromCookies([
      { name: 'c_user', domain: '.facebook.com', expires: 2_000_000_000 },
      { name: 'xs', domain: '.facebook.com', expires: 1_900_000_000 },
      { name: 'other', domain: '.facebook.com', expires: 1_800_000_000 },
    ])).toBe(new Date(1_900_000_000 * 1000).toISOString())
  })

  it('returns null for browser-session cookies without an expiry', () => {
    expect(sessionExpiryFromCookies([{ name: 'c_user', domain: '.facebook.com', expires: -1 }])).toBeNull()
  })
})
