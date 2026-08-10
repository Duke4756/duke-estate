import { describe, expect, it } from 'vitest'
import { duplicateGroups, groupKey } from '../../server/groups.js'

describe('Facebook group duplicate detection', () => {
  it('treats hostname, case, trailing slash, and query variants as one group', () => {
    expect(groupKey('https://www.facebook.com/groups/MyGroup/')).toBe('mygroup')
    expect(groupKey('https://web.facebook.com/groups/mygroup?ref=share')).toBe('mygroup')
    expect(duplicateGroups([
      { url: 'https://www.facebook.com/groups/MyGroup/' },
      { url: 'https://m.facebook.com/groups/mygroup?ref=share' },
    ])).toEqual(['https://m.facebook.com/groups/mygroup?ref=share'])
  })

  it('does not mark different groups as duplicates', () => {
    expect(duplicateGroups([
      'https://www.facebook.com/groups/111',
      'https://www.facebook.com/groups/222',
    ])).toEqual([])
  })
})
