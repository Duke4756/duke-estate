import { describe, expect, it } from 'vitest'
import { openDatabase } from '../../server/db/index.js'
import { createPropertyDataService } from '../../server/db/service.js'
import { splitListingCluster } from '../../server/db/repositories/listingClusters.js'

describe('cross-group listing clusters', () => {
  it('keeps all raw evidence while grouping deterministic cross-posts and auditing split', async () => {
    const service = createPropertyDataService(openDatabase(':memory:'))
    const text = 'โครงการ: Test Residence ปล่อยเช่า 1 ห้องนอน 35 ตร.ม. ชั้น 8 ราคา 18,000 บาท/เดือน โทร 0812345678'
    await service.ingest({ source_adapter: 'facebook_group', source_group_id: 'g1', source_post_id: 'p1', source_url: 'https://facebook.com/groups/g1/posts/p1', raw_text: text, collector_version: 'test' })
    await service.ingest({ source_adapter: 'facebook_group', source_group_id: 'g2', source_post_id: 'p2', source_url: 'https://facebook.com/groups/g2/posts/p2', raw_text: text, collector_version: 'test' })
    expect(service.db.prepare('SELECT COUNT(*) count FROM raw_posts').get().count).toBe(2)
    expect(service.db.prepare('SELECT COUNT(DISTINCT cluster_id) count FROM listing_cluster_members').get().count).toBe(1)
    expect(service.db.prepare('SELECT COUNT(*) count FROM listing_cluster_members').get().count).toBe(2)
    const propertyId = service.db.prepare('SELECT property_id FROM listing_cluster_members ORDER BY property_id DESC LIMIT 1').get().property_id
    splitListingCluster(service.db, propertyId)
    expect(service.db.prepare("SELECT COUNT(*) count FROM cluster_merge_audits WHERE action='SPLIT'").get().count).toBe(1)
    service.close()
  })
})
