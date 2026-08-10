import { describe, expect, it } from 'vitest'
import { openDatabase } from '../../server/db/index.js'
import { createPropertyDataService } from '../../server/db/service.js'

describe('post-to-database pipeline', () => {
  it('persists low-confidence offer properties automatically with audit signals', async () => {
    const service = createPropertyDataService(openDatabase(':memory:'))
    const output = await service.ingest({
      source_adapter: 'test',
      source_post_id: 'post-1',
      source_url: 'https://facebook.com/groups/1/posts/1',
      raw_text: 'ปล่อยเช่า คอนโดเลี้ยงสัตว์ได้ 3 ห้องนอน 180 ตร.ม.',
      collector_version: 'test',
    })
    expect(output.propertyIds).toHaveLength(1)
    expect(service.query({ review: '1' }).total).toBe(0)
    const query = service.query({})
    expect(query.total).toBe(1)
    expect(query.posts[0]).toMatchObject({
      area_sqm: 180,
      bedrooms: 3,
      rent_price_monthly: null,
      project_name_raw: null,
      pet_policy: 'allowed',
      status: 'confirmed',
    })
    service.close()
  })

  it('does not persist wanted posts as available properties', async () => {
    const service = createPropertyDataService(openDatabase(':memory:'))
    await service.ingest({
      source_adapter: 'test',
      source_post_id: 'wanted-1',
      raw_text: 'หาคอนโดเช่า งบ 25,000 บาท',
      collector_version: 'test',
    })
    expect(service.query({}).total).toBe(0)
    service.close()
  })

  it('keeps rent and sale inventory and filters by raw project name and price', async () => {
    const service = createPropertyDataService(openDatabase(':memory:'))
    await service.ingest({
      source_adapter: 'test',
      source_post_id: 'rent-filter-1',
      raw_text: 'XT Ekkamai - For rent\n1 bedroom 30 sqm\n18,500 baht/month',
      collector_version: 'test',
    })
    await service.ingest({
      source_adapter: 'test',
      source_post_id: 'sale-only-1',
      raw_text: 'XT Ekkamai - For sale\n1 bedroom 30 sqm\nSale price 4,500,000 baht',
      collector_version: 'test',
    })
    expect(service.query({}).total).toBe(2)
    expect(service.query({ project: 'Ekkamai' }).total).toBe(2)
    expect(service.query({ minPrice: 18000, maxPrice: 19000 }).total).toBe(1)
    expect(service.query({ minPrice: 19001 }).total).toBe(0)
    service.close()
  })

  it('sorts rental prices in both directions with missing prices last', async () => {
    const service = createPropertyDataService(openDatabase(':memory:'))
    for (const [id, price] of [['a', '12,000'], ['b', '25,000']]) {
      await service.ingest({
        source_adapter: 'test',
        source_post_id: `sort-${id}`,
        raw_text: `For Rent Condo ${id.toUpperCase()}\nRent ${price} THB/month`,
        collector_version: 'test',
      })
    }
    const asc = service.query({ sort: 'price_asc' }).posts.map((post) => post.rent_price_monthly)
    const desc = service.query({ sort: 'price_desc' }).posts.map((post) => post.rent_price_monthly)
    expect(asc).toEqual([12000, 25000])
    expect(desc).toEqual([25000, 12000])
    service.close()
  })

  it('persists multiple properties from one post', async () => {
    const service = createPropertyDataService(openDatabase(':memory:'))
    await service.ingest({
      source_adapter: 'test',
      source_post_id: 'multi-1',
      raw_text: 'ปล่อยเช่า 2 ห้อง\nห้อง 1) 1 ห้องนอน 35 ตร.ม. ค่าเช่า 18,000 บาท/เดือน\nห้อง 2) 2 ห้องนอน 60 ตร.ม. ค่าเช่า 30,000 บาท/เดือน',
      collector_version: 'test',
    })
    expect(service.query({}).total).toBe(2)
    service.close()
  })

  it('reprocesses expanded source text without overwriting user-confirmed records', async () => {
    const service = createPropertyDataService(openDatabase(':memory:'))
    const base = {
      source_adapter: 'facebook_group',
      source_post_id: 'expanded-1',
      raw_text: 'The Strand Thonglor - For rent ... ดูเพิ่มเติม',
      collector_version: 'test',
    }
    await service.ingest(base)
    await service.ingest({
      ...base,
      raw_text: 'The Strand Thonglor - For rent\n2 bedrooms 70 sqm\nRent 80,000 THB/month',
    })
    const active = service.query({})
    expect(active.total).toBe(1)
    expect(active.posts[0]).toMatchObject({
      project_name_raw: 'The Strand Thonglor',
      rent_price_monthly: 80000,
      area_sqm: 70,
    })
    service.close()
  })

  it('preserves a confirmed record when the same source text changes', async () => {
    const service = createPropertyDataService(openDatabase(':memory:'))
    const base = {
      source_adapter: 'facebook_group',
      source_post_id: 'reviewed-1',
      raw_text: 'The Strand Thonglor - For rent\nRent 80,000 THB/month',
      collector_version: 'test',
    }
    const first = await service.ingest(base)
    service.update(first.propertyIds[0], { status: 'confirmed' }, 'user')
    const second = await service.ingest({ ...base, raw_text: `${base.raw_text}\n70 sqm` })
    expect(second).toMatchObject({ duplicate: true, preservedUserReview: true })
    expect(service.query({}).total).toBe(1)
    service.close()
  })

  it('supports edit, soft delete and undo with audit events', async () => {
    const service = createPropertyDataService(openDatabase(':memory:'))
    const result = await service.ingest({
      source_adapter: 'test', source_post_id: 'edit-1',
      raw_text: 'ปล่อยเช่า 1 ห้องนอน 35 ตร.ม. ค่าเช่า 18,000 บาท/เดือน',
      collector_version: 'test',
    })
    const id = result.propertyIds[0]
    expect(service.update(id, { status: 'confirmed' }).property.status).toBe('confirmed')
    const deletion = service.remove(id)
    expect(service.query({}).total).toBe(0)
    service.undo(deletion.auditEventId)
    expect(service.query({}).total).toBe(1)
    service.close()
  })
})
