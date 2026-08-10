import { afterEach, describe, expect, it } from 'vitest'
import { openDatabase } from '../../server/db/index.js'
import { createPropertyDataService } from '../../server/db/service.js'
import { enrichMissingProperties } from '../../server/services/enrichProperties.js'

describe('one-click missing property enrichment', () => {
  const services = []
  afterEach(() => services.splice(0).forEach((service) => service.close()))

  it('fills evidenced price and project without inferring a station from the project name', async () => {
    const service = createPropertyDataService(openDatabase(':memory:'))
    services.push(service)
    const saved = await service.ingest({
      source_adapter: 'facebook_group',
      source_post_id: 'enrich-1',
      source_url: 'https://www.facebook.com/groups/1/posts/enrich-1/',
      raw_text: 'For Rent | Aspire Onnut Station | ค่าเช่า 18,000 บาท/เดือน',
      collector_version: 'test',
    })
    const id = saved.propertyIds[0]
    service.db.prepare(`
      UPDATE properties
      SET project_name_raw = NULL, rent_price_monthly = NULL, currency = NULL
      WHERE id = ?
    `).run(id)

    const stats = enrichMissingProperties(service)
    const result = service.query({})
    expect(stats).toMatchObject({ prices: 1, projects: 1 })
    expect(result.posts[0]).toMatchObject({
      project_name_raw: 'Aspire Onnut Station',
      rent_price_monthly: 18000,
    })
    expect(result.posts[0].transitStations).toEqual([])
  })
})
