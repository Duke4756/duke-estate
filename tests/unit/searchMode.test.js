import { describe, expect, it } from 'vitest'
import { filterOwnerSearchResults, resolveSearchMode, searchClassificationCacheKey } from '../../server/services/searchMode.js'

describe('search modes', () => {
  it('keeps the existing lead mode as the default', () => {
    expect(resolveSearchMode()).toBe('lead')
    expect(resolveSearchMode('anything-else')).toBe('lead')
  })
  it('supports owner listing mode and defaults its filter to direct owners', () => {
    expect(resolveSearchMode('owner_listing')).toBe('owner_listing')
    const posts = ['owner_rent', 'owner_sale', 'agent_listing', 'irrelevant', 'unknown'].map((category) => ({ category }))
    expect(filterOwnerSearchResults(posts).map((post) => post.category)).toEqual(['owner_rent', 'owner_sale', 'agent_listing'])
    expect(filterOwnerSearchResults(posts, 'rejected')).toHaveLength(1)
    expect(filterOwnerSearchResults(posts, 'unknown')).toHaveLength(1)
  })
  it('separates classification cache namespaces by mode', () => {
    expect(searchClassificationCacheKey('lead', 'abc')).not.toBe(searchClassificationCacheKey('owner_listing', 'abc'))
  })
})
