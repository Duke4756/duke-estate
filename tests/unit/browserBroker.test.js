import { describe, expect, it } from 'vitest'
import { accountBrowserState, acquireAccount, tryAcquireAccount } from '../../server/browserBroker.js'

describe('browser broker', () => {
  it('locks one account without globally locking another account', () => {
    const first = tryAcquireAccount('FB01', 'POSTING')
    const other = tryAcquireAccount('FB02', 'CHAT_CHECK')
    expect(first).toBeTruthy()
    expect(other).toBeTruthy()
    expect(tryAcquireAccount('FB01', 'CHAT_CHECK')).toBeNull()
    expect(accountBrowserState('FB01').state).toBe('POSTING')
    first.release()
    other.release()
  })

  it('waits for the same account and grants it after release', async () => {
    const first = tryAcquireAccount('FB03', 'POSTING')
    const waiting = acquireAccount('FB03', 'CHAT_CHECK')
    first.release()
    const second = await waiting
    expect(accountBrowserState('FB03').state).toBe('CHAT_CHECK')
    second.release()
    expect(accountBrowserState('FB03').state).toBe('IDLE')
  })
})
