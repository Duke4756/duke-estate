import { describe, expect, it } from 'vitest'
import { filterPostableGroups } from '../../server/groupMembershipStore.js'

describe('postable group membership filter', () => {
  it('keeps groups with no negative membership record', () => {
    const groups = [
      'https://www.facebook.com/groups/new-group/',
      'https://www.facebook.com/groups/another-new-group/',
    ]
    expect(filterPostableGroups('unseen-account', groups)).toEqual(groups)
  })
})
