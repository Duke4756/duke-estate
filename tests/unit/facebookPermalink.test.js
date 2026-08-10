import { describe, expect, it } from 'vitest'
import { cleanPostUrl } from '../../server/scraper.js'

describe('Facebook source post permalink', () => {
  it('keeps only the canonical post identity', () => {
    expect(cleanPostUrl(
      'https://web.facebook.com/groups/123/posts/456/?__cft__=abc',
    )).toBe('https://www.facebook.com/groups/123/posts/456/')
  })

  it('converts story_fbid links to a group post permalink', () => {
    expect(cleanPostUrl(
      'https://www.facebook.com/permalink.php?story_fbid=456&id=123',
    )).toBe('https://www.facebook.com/groups/123/posts/456/')
  })

  it('never substitutes a group page for a source post', () => {
    expect(cleanPostUrl('https://www.facebook.com/groups/123/')).toBe('')
  })
})
