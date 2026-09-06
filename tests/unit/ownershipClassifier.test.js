import { describe, expect, it } from 'vitest'
import { classifyOwnership } from '../../server/pipeline/ownershipClassifier.js'

describe('owner-only classifier', () => {
  it('accepts direct owner evidence even when the owner mentions agents', () => {
    expect(classifyOwnership('Owner Post ไม่รับ Agent ให้เช่า 20,000 บาท/เดือน').value).toBe('owner')
    expect(classifyOwnership('เจ้าของขายเอง ยินดีรับ agent ราคาขาย 3 ล้านบาท').value).toBe('owner')
  })

  it('rejects explicit agent and non-listing demand posts', () => {
    expect(classifyOwnership('Agent post ให้เช่า 20,000 บาท/เดือน').value).toBe('agent')
    expect(classifyOwnership('หาคอนโดเช่า งบ 20,000 บาท').value).toBe('not_owner_listing')
  })

  it('keeps an unattributed offer uncertain unless its profile is trusted', () => {
    const text = 'ให้เช่า Test Residence 20,000 บาท/เดือน'
    expect(classifyOwnership(text).value).toBe('uncertain')
    expect(classifyOwnership(text, { trustedOwnerProfile: true }).value).toBe('owner')
  })
})
