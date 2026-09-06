import { describe, expect, it } from 'vitest'
import { openDatabase } from '../../server/db/index.js'
import { PostProcessingQueue } from '../../server/services/postProcessingQueue.js'
import { createPropertyDataService } from '../../server/db/service.js'

const input = (id = 'post-1') => ({ source_adapter: 'facebook_group', source_post_id: id, source_url: `https://facebook.com/groups/1/posts/${id}`, raw_text: 'ให้เช่า 25,000 บาท/เดือน ใกล้ BTS อ่อนนุช', collector_version: 'test' })

describe('recoverable post processing queue', () => {
  it('does not persist explicit agent posts in owner-only mode', () => {
    const db = openDatabase(':memory:')
    const queue = new PostProcessingQueue({ db, processor: async () => ({ propertyIds: [] }) })
    queue.kick = () => {}
    const result = queue.captureAndEnqueue({ ...input('agent-only'), raw_text: 'Agent post ให้เช่า Test Residence 20,000 บาท/เดือน' })
    expect(result).toMatchObject({ excluded: true, excludedRole: 'agent', inserted: false })
    expect(db.prepare('SELECT COUNT(*) count FROM raw_posts').get().count).toBe(0)
    db.close()
  })

  it('commits raw post and job before invoking extraction', async () => {
    const db = openDatabase(':memory:')
    let observed = null
    const queue = new PostProcessingQueue({ db, processor: async (raw) => { observed = { raw: db.prepare('SELECT * FROM raw_posts WHERE id=?').get(raw.id), job: db.prepare("SELECT * FROM post_processing_jobs WHERE raw_post_id=? AND status='RUNNING'").get(raw.id) }; return { propertyIds: [], result: { warnings: [] } } } })
    queue.kick = () => {}
    const captured = queue.captureAndEnqueue(input())
    expect(captured).toMatchObject({ inserted: true, queued: true })
    expect(db.prepare('SELECT ingestion_status FROM raw_posts').get().ingestion_status).toBe('QUEUED')
    await queue.runAvailable()
    expect(observed.raw.raw_text).toContain('25,000')
    expect(observed.job.status).toBe('RUNNING')
    expect(db.prepare('SELECT status FROM post_processing_jobs').get().status).toBe('COMPLETED')
    db.close()
  })

  it('does not duplicate raw posts or active jobs on repeated crawl', () => {
    const db = openDatabase(':memory:')
    const queue = new PostProcessingQueue({ db, processor: async () => ({ propertyIds: [], result: { warnings: [] } }) })
    queue.kick = () => {}
    queue.captureAndEnqueue(input())
    queue.captureAndEnqueue(input())
    expect(db.prepare('SELECT COUNT(*) count FROM raw_posts').get().count).toBe(1)
    expect(db.prepare('SELECT COUNT(*) count FROM post_processing_jobs').get().count).toBe(1)
    db.close()
  })

  it('deduplicates by normalized URL and by content hash when post id is unavailable', () => {
    const db = openDatabase(':memory:')
    const queue = new PostProcessingQueue({ db, processor: async () => ({ propertyIds: [] }) })
    queue.kick = () => {}
    queue.captureAndEnqueue({ ...input('url-a'), source_post_id: null, source_url: 'https://web.facebook.com/groups/1/posts/900/?ref=share' })
    queue.captureAndEnqueue({ ...input('url-b'), source_post_id: null, source_url: 'https://www.facebook.com/groups/1/posts/900/' })
    queue.captureAndEnqueue({ ...input('hash-a'), source_post_id: null, source_url: null, raw_text: 'ประกาศเดียวกันแบบไม่มีรหัสโพสต์' })
    queue.captureAndEnqueue({ ...input('hash-b'), source_post_id: null, source_url: null, raw_text: 'ประกาศเดียวกันแบบไม่มีรหัสโพสต์' })
    expect(db.prepare('SELECT COUNT(*) count FROM raw_posts').get().count).toBe(2)
    expect(db.prepare('SELECT COUNT(*) count FROM post_processing_jobs').get().count).toBe(2)
    db.close()
  })

  it('recovers a stale running job after restart', () => {
    const db = openDatabase(':memory:')
    const queue = new PostProcessingQueue({ db, processor: async () => ({}), staleMs: 1000 })
    queue.kick = () => {}
    queue.captureAndEnqueue(input())
    db.prepare("UPDATE post_processing_jobs SET status='RUNNING', locked_at='2000-01-01T00:00:00.000Z'").run()
    expect(queue.recoverStaleJobs()).toBe(1)
    expect(db.prepare('SELECT status FROM post_processing_jobs').get().status).toBe('RETRY')
    db.close()
  })

  it('keeps raw post and schedules retry when AI/network fails', async () => {
    const db = openDatabase(':memory:')
    const queue = new PostProcessingQueue({ db, processor: async () => { throw new Error('network timeout') } })
    queue.kick = () => {}
    queue.captureAndEnqueue(input())
    await queue.runAvailable()
    expect(db.prepare('SELECT COUNT(*) count FROM raw_posts').get().count).toBe(1)
    expect(db.prepare('SELECT status FROM post_processing_jobs').get().status).toBe('RETRY')
    db.close()
  })

  it('segments one post into two property records', async () => {
    const db = openDatabase(':memory:')
    const service = createPropertyDataService(db)
    const queue = new PostProcessingQueue({ db, processor: (raw) => service.ingest(raw) })
    queue.kick = () => {}
    queue.captureAndEnqueue({ ...input('multi'), raw_text: 'ให้เช่า\nห้อง 1) 1 ห้องนอน 20,000 บาท/เดือน\nห้อง 2) 2 ห้องนอน 35,000 บาท/เดือน' })
    await queue.runAvailable()
    expect(db.prepare('SELECT COUNT(*) count FROM listing_segments').get().count).toBe(2)
    expect(db.prepare('SELECT COUNT(*) count FROM properties WHERE deleted_at IS NULL').get().count).toBe(2)
    service.close()
  })

  it('auto-saves conflicting fields as null while retaining warning evidence', async () => {
    const db = openDatabase(':memory:')
    const service = createPropertyDataService(db)
    const queue = new PostProcessingQueue({ db, processor: (raw) => service.ingest(raw) })
    queue.kick = () => {}
    queue.captureAndEnqueue({ ...input('conflict'), raw_text: 'ให้เช่า 25,000 บาท/เดือน 1 ห้องนอน และ 2 ห้องนอน' })
    await queue.runAvailable()
    expect(db.prepare('SELECT bedrooms FROM properties').get().bedrooms).toBeNull()
    expect(db.prepare("SELECT COUNT(*) count FROM review_queue WHERE status='open'").get().count).toBe(0)
    expect(db.prepare("SELECT status FROM properties").get().status).toBe('confirmed')
    service.close()
  })

  it('does not overwrite a human-reviewed property after source text changes', async () => {
    const db = openDatabase(':memory:')
    const service = createPropertyDataService(db)
    const first = await service.ingest(input('human'))
    service.update(first.propertyIds[0], { rent_price_monthly: 26000, status: 'confirmed' }, 'human')
    const queue = new PostProcessingQueue({ db, processor: (raw) => service.ingest(raw) })
    queue.kick = () => {}
    queue.captureAndEnqueue({ ...input('human'), raw_text: 'ให้เช่า 30,000 บาท/เดือน' })
    await queue.runAvailable()
    expect(db.prepare('SELECT rent_price_monthly FROM properties WHERE id=?').get(first.propertyIds[0]).rent_price_monthly).toBe(26000)
    expect(db.prepare('SELECT status FROM post_processing_jobs').get().status).toBe('COMPLETED')
    service.close()
  })
})
