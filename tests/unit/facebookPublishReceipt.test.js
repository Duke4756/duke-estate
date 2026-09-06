import { describe, expect, it } from 'vitest'
import { facebookCreatePostMutation, parseFacebookPublishReceipt } from '../../server/facebookPublishReceipt.js'

describe('Facebook publish receipts', () => {
  it('recognizes create-story mutations but ignores comment mutations', () => {
    expect(facebookCreatePostMutation('https://www.facebook.com/api/graphql/', 'fb_api_req_friendly_name=ComposerStoryCreateMutation')).toBe('ComposerStoryCreateMutation')
    expect(facebookCreatePostMutation('https://www.facebook.com/api/graphql/', 'fb_api_req_friendly_name=useCometUFICreateCommentMutation')).toBeNull()
  })

  it('extracts the post id and builds a group permalink', () => {
    expect(parseFacebookPublishReceipt(JSON.stringify({ data: { story_create: { story: { id: '1065357139828212' } } } }), 'https://facebook.com/groups/389993647364568', 'ComposerStoryCreateMutation')).toMatchObject({
      accepted: true,
      postId: '1065357139828212',
      postUrl: 'https://www.facebook.com/groups/389993647364568/posts/1065357139828212/',
    })
  })

  it('rejects GraphQL errors', () => {
    expect(parseFacebookPublishReceipt(JSON.stringify({ errors: [{ message: 'permission denied' }] }), 'https://facebook.com/groups/1')).toBeNull()
  })

  it('recognizes a create payload even when an account gets an unknown mutation name', () => {
    expect(parseFacebookPublishReceipt(JSON.stringify({ data: { story_create: { story: { id: '998877665544' } } } }), 'https://facebook.com/groups/123', 'CometExperimentMutation')).toMatchObject({
      accepted: true,
      postId: '998877665544',
    })
  })
})
