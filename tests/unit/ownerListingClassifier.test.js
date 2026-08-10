import { beforeEach, describe, expect, it } from 'vitest'
import { classifyOwnerListingPost, clearOwnerClassificationCache } from '../../server/pipeline/ownerListingClassifier.js'

beforeEach(clearOwnerClassificationCache)

describe('owner listing classifier', () => {
  it('keeps owner rental evidence and confidence', () => {
    const result = classifyOwnerListingPost({ id: '1', text: 'เจ้าของปล่อยเอง ให้เช่าคอนโด 18,000 บาท' })
    expect(result.category).toBe('owner_rent')
    expect(result.acceptedOwner).toBe(true)
    expect(result.classification.evidence.length).toBeGreaterThan(0)
  })

  it('separates agent and rejected results from direct owners', () => {
    const result = classifyOwnerListingPost({ id: '2', text: 'Agent Post For Rent condo' })
    expect(result.category).toBe('agent_listing')
    expect(result.acceptedOwner).toBe(true)
  })

  it('uses a mode-specific content cache', () => {
    const post = { id: '3', text: 'Owner Post For Sale house' }
    expect(classifyOwnerListingPost(post).classificationCached).toBe(false)
    expect(classifyOwnerListingPost(post).classificationCached).toBe(true)
  })
})
