import { describe, expect, it, vi } from 'vitest'
vi.mock('node:fs', () => ({ default: { readFileSync: () => JSON.stringify({
  account: {
    joined: { status: 'MEMBER' },
    waiting: { status: 'REQUESTED' },
    outside: { status: 'NOT_MEMBER' },
    unavailable: { status: 'UNAVAILABLE' },
  },
}) } }))
import { filterPostableGroups } from '../../server/groupMembershipStore.js'

describe('postable group membership filter', () => {
  it('excludes groups whose membership has not been confirmed', () => {
    const groups = [
      'https://www.facebook.com/groups/new-group/',
      'https://www.facebook.com/groups/another-new-group/',
    ]
    expect(filterPostableGroups('unseen-account', groups)).toEqual([])
  })
  it('only allows confirmed members, including normalized URLs', () => {
    const groups = ['joined', 'waiting', 'outside', 'unavailable', 'unknown']
      .map((id) => `https://www.facebook.com/groups/${id}/?ref=share`)
    expect(filterPostableGroups('account', groups)).toEqual([groups[0]])
  })
})
