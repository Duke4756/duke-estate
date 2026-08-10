import { afterEach, describe, expect, it } from 'vitest'
import { openDatabase } from '../../server/db/index.js'
import { createPropertyDataService } from '../../server/db/service.js'

describe('canonical transit station directory', () => {
  const services = []
  afterEach(() => services.splice(0).forEach((service) => service.close()))

  it('persists only a station mentioned in the source and supports canonical filtering', async () => {
    const service = createPropertyDataService(openDatabase(':memory:'))
    services.push(service)
    await service.ingest({
      source_adapter: 'facebook_group',
      source_post_id: 'station-test-1',
      source_url: 'https://www.facebook.com/groups/1/posts/station-test-1/',
      raw_text: 'For Rent | Aspire Onnut Station | ใกล้ BTS อ่อนนุช 200 เมตร | 18,000 บาท/เดือน',
      collector_version: 'test',
    })
    const result = service.query({ transit: 'On Nut' })
    expect(result.total).toBe(1)
    expect(result.posts[0].transitStations[0]).toMatchObject({
      stationId: 'BTS-ON_NUT', canonicalNameEn: 'On Nut', systemCode: 'BTS',
      distanceValue: 200, distanceUnit: 'm', originalMention: expect.stringContaining('BTS อ่อนนุช'),
    })
    expect(result.posts[0].transitStations[0].evidenceText).toContain('BTS อ่อนนุช')
  })
})
