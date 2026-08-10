import { describe, expect, it } from 'vitest'
import { openDatabase } from '../../server/db/index.js'
import { createPropertyDataService } from '../../server/db/service.js'

describe('automatic duplicate resolution', () => {
  it('keeps one record and soft-deletes the duplicate', async () => {
    const service = createPropertyDataService(openDatabase(':memory:'))
    const listing = {
      source_adapter: 'test',
      raw_text: 'โครงการ: Test Residence ปล่อยเช่า 1 ห้องนอน 35 ตร.ม. 18,000 บาท/เดือน',
      collector_version: 'test',
    }
    await service.ingest({ ...listing, source_post_id: 'one', source_url: 'https://example.com/post/one' })
    await service.ingest({ ...listing, source_post_id: 'two', source_url: 'https://example.com/post/two' })
    expect(service.query({}).total).toBe(1)
    const deleted = service.db.prepare(`SELECT COUNT(*) count FROM properties WHERE deleted_at IS NOT NULL`).get()
    expect(deleted.count).toBe(1)
    service.close()
  })
})
