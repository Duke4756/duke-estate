import { describe, expect, it } from 'vitest'
import { openDatabase } from '../../server/db/index.js'
import { createPropertyDataService } from '../../server/db/service.js'
import { rollbackOwnerPipeline } from '../../server/migrations/rollback-owner-pipeline.js'

describe('owner migration rollback', () => {
  it('removes only pipeline-imported rows and leaves other adapters intact', async () => {
    const db = openDatabase(':memory:')
    const service = createPropertyDataService(db)
    await service.ingest({
      source_adapter: 'legacy_owner_pipeline',
      source_post_id: 'legacy-1',
      raw_text: 'ปล่อยเช่า โครงการ: Test 35 ตร.ม. ค่าเช่า 18,000 บาท/เดือน',
    })
    await service.ingest({
      source_adapter: 'authorized_api',
      source_post_id: 'api-1',
      raw_text: 'ปล่อยเช่า โครงการ: Keep 40 ตร.ม. ค่าเช่า 20,000 บาท/เดือน',
    })

    expect(rollbackOwnerPipeline(db)).toMatchObject({ rawPosts: 1, processingRuns: 1, properties: 1 })
    expect(db.prepare('SELECT source_adapter FROM raw_posts').all()).toEqual([
      { source_adapter: 'authorized_api' },
    ])
    service.close()
  })
})
