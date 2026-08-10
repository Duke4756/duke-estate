import { describe, expect, it } from 'vitest'
import { facebookLeadToRawPost } from '../../server/adapters/facebookGroupAdapter.js'
import { openDatabase } from '../../server/db/index.js'
import { createPropertyDataService } from '../../server/db/service.js'

describe('shared Facebook post extraction', () => {
  it('extracts price from the original shared listing and retains caption provenance', async () => {
    const service = createPropertyDataService(openDatabase(':memory:'))
    const rawPost = facebookLeadToRawPost({
      id: 'shared-1', permalink: 'https://facebook.com/groups/1/posts/shared-1',
      text: 'ฝากห้องนี้ด้วยค่ะ',
      sharedText: 'Owner post ให้เช่า The Test Residence 2 ห้องนอน 60 ตร.ม. ราคา 35,000 บาท/เดือน',
      sharedPermalink: 'https://facebook.com/original/posts/99',
    })
    const saved = await service.ingest(rawPost)
    const property = service.db.prepare('SELECT * FROM properties WHERE id=?').get(saved.propertyIds[0])
    expect(property.rent_price_monthly).toBe(35000)
    const evidence = service.db.prepare("SELECT quote FROM field_evidence WHERE property_id=? AND field_name='rent_price_monthly'").get(property.id)
    expect(evidence.quote).toContain('35,000')
    const raw = service.db.prepare('SELECT raw_text,raw_snippet FROM raw_posts WHERE id=?').get(saved.rawPost.id)
    expect(raw.raw_text).toContain('[โพสต์ต้นฉบับที่แชร์]')
    expect(JSON.parse(raw.raw_snippet).shareCaption).toBe('ฝากห้องนี้ด้วยค่ะ')
    service.close()
  })
})
