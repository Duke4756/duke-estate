import { describe, expect, it } from 'vitest'
import { evaluateFacebookSession } from '../../server/accounts.js'

const userCookie = [{ name: 'c_user', domain: '.facebook.com', value: '123' }]

describe('Facebook posting account session verification', () => {
  it('only reports ready after an authenticated Facebook page loads', () => {
    expect(evaluateFacebookSession({
      cookies: userCookie,
      url: 'https://www.facebook.com/profile.php?id=123',
      responseStatus: 200,
    })).toMatchObject({ ready: true, sessionStatus: 'ready' })
  })

  it('rejects a stale cookie when Facebook redirects to login or checkpoint', () => {
    expect(evaluateFacebookSession({
      cookies: userCookie,
      url: 'https://www.facebook.com/login/?next=%2Fme',
    })).toMatchObject({ ready: false, sessionStatus: 'expired' })
    expect(evaluateFacebookSession({
      cookies: userCookie,
      url: 'https://www.facebook.com/checkpoint/123',
    })).toMatchObject({ ready: false, sessionStatus: 'expired' })
  })

  it('does not claim ready when Facebook itself is unavailable', () => {
    expect(evaluateFacebookSession({
      cookies: userCookie,
      url: 'https://www.facebook.com/me/',
      responseStatus: 503,
    })).toMatchObject({ ready: false, sessionStatus: 'unknown' })
  })

})
