import { describe, expect, it } from 'vitest'
import { openDatabase } from '../../server/db/index.js'
import { createPropertyDataService } from '../../server/db/service.js'
import { backfillTransitStations } from '../../server/migrations/backfill-transit-stations.js'

describe('transit backfill', () => {
  it('is idempotent and preserves legacy free text', async () => {
    const db = openDatabase(':memory:')
    const service = createPropertyDataService(db)
    const saved = await service.ingest({ source_adapter: 'facebook_group', source_post_id: 'backfill-transit', source_url: 'https://facebook.com/groups/1/posts/backfill-transit', raw_text: 'ให้เช่า 20,000 บาท/เดือน ใกล้ BTS อ่อนนุช 250 เมตร', collector_version: 'test' })
    db.prepare('DELETE FROM property_transit_stations WHERE property_id=?').run(saved.propertyIds[0])
    db.prepare("UPDATE properties SET nearby_transit='BTS อ่อนนุช' WHERE id=?").run(saved.propertyIds[0])
    backfillTransitStations({ db })
    backfillTransitStations({ db })
    expect(db.prepare('SELECT COUNT(*) count FROM property_transit_stations WHERE property_id=?').get(saved.propertyIds[0]).count).toBe(1)
    expect(db.prepare('SELECT nearby_transit FROM properties WHERE id=?').get(saved.propertyIds[0]).nearby_transit).toBe('BTS อ่อนนุช')
    expect(db.prepare("SELECT COUNT(*) count FROM audit_events WHERE action='transit_backfill'").get().count).toBe(1)
    service.close()
  })
})
