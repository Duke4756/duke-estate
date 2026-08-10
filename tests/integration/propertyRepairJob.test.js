import { afterEach, describe, expect, it } from 'vitest'
import { openDatabase } from '../../server/db/index.js'
import { createPropertyDataService } from '../../server/db/service.js'
import { PropertyRepairJob } from '../../server/services/propertyRepairJob.js'

describe('AI property repair job', () => {
  const services = []
  afterEach(() => services.splice(0).forEach((service) => service.close()))

  it('fills only evidenced missing fields and is idempotent', async () => {
    const service = createPropertyDataService(openDatabase(':memory:'))
    services.push(service)
    const saved = await service.ingest({ source_adapter: 'facebook_group', source_post_id: 'repair-1', source_url: 'https://facebook.com/groups/1/posts/repair-1', raw_text: 'Owner post ให้เช่า The Test 25,000 บาท/เดือน 2 ห้องนอน', collector_version: 'test' })
    const propertyId = saved.propertyIds[0]
    service.db.prepare('UPDATE properties SET bedrooms=NULL,source_role=NULL WHERE id=?').run(propertyId)
    let calls = 0
    const extract = async () => {
      calls++
      return { result: { properties: [{ bedrooms: 2, source_role: 'owner', project_verified: false, transit_matches: [], evidence: [{ field: 'bedrooms', quote: '2 ห้องนอน', confidence: 0.98 }, { field: 'source_role', quote: 'Owner post', confidence: 1 }] }] } }
    }
    const job = new PropertyRepairJob({ service, extract })
    job.start()
    await completed(job)
    expect(service.db.prepare('SELECT bedrooms,source_role FROM properties WHERE id=?').get(propertyId)).toEqual({ bedrooms: 2, source_role: 'owner' })
    expect(service.db.prepare("SELECT COUNT(*) count FROM audit_events WHERE entity_id=? AND actor='system:ai_repair'").get(String(propertyId)).count).toBe(1)
    expect(service.db.prepare('SELECT COUNT(DISTINCT field_name) count FROM field_evidence WHERE property_id=? AND field_name IN (\'bedrooms\',\'source_role\')').get(propertyId).count).toBe(2)
    job.start()
    await completed(job)
    expect(calls).toBe(1)
  })

  it('never overwrites a human-edited property', async () => {
    const service = createPropertyDataService(openDatabase(':memory:'))
    services.push(service)
    const saved = await service.ingest({ source_adapter: 'facebook_group', source_post_id: 'repair-human', raw_text: 'ให้เช่า 20,000 บาท/เดือน', collector_version: 'test' })
    const id = saved.propertyIds[0]
    service.update(id, { rent_price_monthly: 19000 }, 'human')
    let calls = 0
    const job = new PropertyRepairJob({ service, extract: async () => { calls++; return null } })
    job.start(); await completed(job)
    expect(calls).toBe(0)
    expect(service.db.prepare('SELECT rent_price_monthly FROM properties WHERE id=?').get(id).rent_price_monthly).toBe(19000)
  })
})

async function completed(job) {
  for (let index = 0; index < 100; index++) {
    if (job.status().status !== 'running') return job.status()
    await new Promise((resolve) => setTimeout(resolve, 2))
  }
  throw new Error('repair job did not complete')
}
