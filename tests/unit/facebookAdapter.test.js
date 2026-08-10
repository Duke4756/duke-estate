import { describe, expect, it } from 'vitest'
import { composeFacebookPostText, facebookLeadToRawPost, facebookPostIdentity } from '../../server/adapters/facebookGroupAdapter.js'

describe('Facebook source adapter', () => {
  it('uses a stable post id when checking incremental search history', () => {
    expect(facebookPostIdentity(
      'https://web.facebook.com/groups/1/posts/987/?comment_id=2',
      'fallback',
    )).toBe('987')
  })

  it('preserves shared listing text so price extraction can read the original post', () => {
    const text = composeFacebookPostText({
      text: 'ห้องนี้น่าสนใจ ฝากแชร์ค่ะ',
      sharedText: 'ให้เช่า The Test Residence 2 ห้องนอน ราคา 35,000 บาท/เดือน',
    })
    expect(text).toContain('[โพสต์ต้นฉบับที่แชร์]')
    expect(text).toContain('35,000 บาท/เดือน')
    expect(text).toContain('[ข้อความผู้แชร์]')
    const record = facebookLeadToRawPost({ text: 'ฝากแชร์ค่ะ', sharedText: 'ให้เช่า 35,000 บาท/เดือน' })
    expect(record.raw_text).toContain('35,000')
    expect(JSON.parse(record.raw_snippet).sharedPostText).toContain('35,000')
  })

  it('keeps UI/group metadata out of raw text', () => {
    const record = facebookLeadToRawPost({
      id: 'fallback',
      author: 'Owner Name',
      group: 'กลุ่มคอนโด',
      text: 'ปล่อยเช่า 20,000 บาท/เดือน',
      permalink: 'https://www.facebook.com/groups/1/posts/123/',
    })
    expect(record.raw_text).toBe('ปล่อยเช่า 20,000 บาท/เดือน')
    expect(record.raw_text).not.toContain('Owner Name')
    expect(record.raw_text).not.toContain('กลุ่มคอนโด')
    expect(record.source_post_id).toBe('123')
  })
})
