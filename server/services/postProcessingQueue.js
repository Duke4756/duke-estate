import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import { createRawPostRepository } from '../db/repositories/rawPosts.js'
import { classifyIntent } from '../pipeline/intentClassifier.js'
import { splitPropertySegments } from '../pipeline/propertySegments.js'
import { explicitAgentPostRole } from '../pipeline/candidateExtractor.js'
import { classifyOwnership } from '../pipeline/ownershipClassifier.js'

export class PostProcessingQueue extends EventEmitter {
  constructor({ db, processor, staleMs = 10 * 60_000, workerId = `worker-${process.pid}-${randomUUID().slice(0, 8)}`, ownerOnly = false, rentOnly = false }) {
    super()
    this.db = db
    this.processor = processor
    this.staleMs = staleMs
    this.workerId = workerId
    this.ownerOnly = ownerOnly
    this.rentOnly = rentOnly
    this.rawPosts = createRawPostRepository(db)
    this.running = false
    this.timer = null
    this.retryTimer = null
  }

  captureAndEnqueue(input) {
    const excludedRole = explicitAgentPostRole(input.raw_text)
    if (excludedRole) {
      this.emit('event', { type: 'AGENT_POST_SKIPPED', sourceUrl: input.source_url, sourcePostId: input.source_post_id, sourceRole: excludedRole })
      return { rawPost: null, inserted: false, contentChanged: false, queued: false, excluded: true, excludedRole }
    }
    const capturedIntent = classifyIntent(input.raw_text).intent
    if (this.rentOnly && (capturedIntent === 'offer_sale' || capturedIntent === 'wanted_buy')) {
      this.emit('event', { type: 'NON_RENT_POST_SKIPPED', sourceUrl: input.source_url, sourcePostId: input.source_post_id, intent: capturedIntent })
      return { rawPost: null, inserted: false, contentChanged: false, queued: false, excluded: true, excludedIntent: capturedIntent }
    }
    const now = new Date().toISOString()
    const transaction = this.db.transaction(() => {
      const rawPost = this.rawPosts.upsert(input)
      let queued = false
      if (rawPost._created || rawPost._contentChanged) {
        const job = this.db.prepare(`
          INSERT OR IGNORE INTO post_processing_jobs(raw_post_id, job_type, status, created_at, updated_at)
          VALUES (?, 'PROCESS_RAW_POST', 'PENDING', ?, ?)
        `).run(rawPost.id, now, now)
        queued = job.changes > 0
      }
      this.db.prepare('UPDATE raw_posts SET ingestion_status=? WHERE id=?').run(queued ? 'QUEUED' : 'DUPLICATE', rawPost.id)
      return { rawPost: this.rawPosts.get(rawPost.id), inserted: rawPost._created, contentChanged: rawPost._contentChanged === true, queued }
    })
    const result = transaction()
    this.emit('event', { type: result.inserted ? 'RAW_POST_SAVED' : 'DUPLICATE_SKIPPED', rawPostId: result.rawPost.id, sourceUrl: result.rawPost.source_url })
    if (result.queued) this.emit('event', { type: 'JOB_QUEUED', rawPostId: result.rawPost.id })
    this.kick()
    return result
  }

  recoverStaleJobs(now = Date.now()) {
    const cutoff = new Date(now - this.staleMs).toISOString()
    const updated = this.db.prepare(`
      UPDATE post_processing_jobs SET status='RETRY', locked_at=NULL, locked_by=NULL,
        next_retry_at=?, last_error=COALESCE(last_error, 'worker lease expired'), updated_at=?
      WHERE status='RUNNING' AND locked_at < ?
    `).run(new Date(now).toISOString(), new Date(now).toISOString(), cutoff)
    return updated.changes
  }

  claim() {
    const now = new Date().toISOString()
    return this.db.transaction(() => {
      const job = this.db.prepare(`
        SELECT * FROM post_processing_jobs
        WHERE status IN ('PENDING','RETRY') AND (next_retry_at IS NULL OR next_retry_at <= ?)
        ORDER BY created_at, id LIMIT 1
      `).get(now)
      if (!job) return null
      const claimed = this.db.prepare(`
        UPDATE post_processing_jobs SET status='RUNNING', attempt_count=attempt_count+1,
          locked_at=?, locked_by=?, started_at=COALESCE(started_at, ?), updated_at=?
        WHERE id=? AND status IN ('PENDING','RETRY')
      `).run(now, this.workerId, now, now, job.id)
      return claimed.changes ? this.db.prepare('SELECT * FROM post_processing_jobs WHERE id=?').get(job.id) : null
    })()
  }

  async runAvailable() {
    if (this.running) return
    this.running = true
    try {
      this.recoverStaleJobs()
      let job
      while ((job = this.claim())) await this.#process(job)
    } finally {
      this.running = false
    }
  }

  kick() {
    if (this.timer) return
    this.timer = setTimeout(() => {
      this.timer = null
      this.runAvailable().catch((error) => console.error('post worker failed:', error))
    }, 0)
  }

  stats() {
    return this.db.prepare(`SELECT status, COUNT(*) count FROM post_processing_jobs GROUP BY status`).all()
      .reduce((out, row) => ({ ...out, [row.status]: row.count }), {})
  }

  async #process(job) {
    const raw = this.rawPosts.get(job.raw_post_id)
    if (!raw) return this.#finish(job, 'FAILED', null, 'raw post missing')
    this.db.prepare("UPDATE raw_posts SET ingestion_status='PROCESSING' WHERE id=?").run(raw.id)
    const classification = classifyIntent(raw.raw_text)
    const publicClassification = classificationName(classification.intent, raw.raw_text)
    this.db.prepare(`INSERT INTO raw_post_classifications(raw_post_id,classification,confidence,matched_patterns_json,evidence_json,classifier_version,created_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(raw_post_id,classifier_version) DO UPDATE SET classification=excluded.classification,confidence=excluded.confidence,matched_patterns_json=excluded.matched_patterns_json,evidence_json=excluded.evidence_json,created_at=excluded.created_at`).run(raw.id, publicClassification, classification.confidence, JSON.stringify(classification.evidence.map((item) => item.quote)), JSON.stringify(classification.evidence), classification.version, new Date().toISOString())
    const segments = splitPropertySegments(raw.raw_text)
    const saveSegment = this.db.prepare(`INSERT INTO listing_segments(raw_post_id,segment_index,source_text,evidence_start,evidence_end,warning,segmenter_version,created_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(raw_post_id,segment_index,segmenter_version) DO UPDATE SET source_text=excluded.source_text,evidence_start=excluded.evidence_start,evidence_end=excluded.evidence_end,warning=excluded.warning,created_at=excluded.created_at`)
    let cursor = 0
    const possibleMulti = segments.length === 1 && /(?:ห้อง|unit|รายการ)\s*(?:ที่\s*)?\d+/giu.test(raw.raw_text)
    for (const [index, segment] of segments.entries()) {
      const start = Math.max(0, raw.raw_text.indexOf(segment, cursor)); const end = start + segment.length; cursor = end
      saveSegment.run(raw.id, index + 1, segment, start, end, possibleMulti ? 'POSSIBLE_MULTI_LISTING' : null, 'segments-v1', new Date().toISOString())
    }
    this.emit('event', { type: 'CLASSIFIED', rawPostId: raw.id, classification: publicClassification, confidence: classification.confidence, evidence: classification.evidence })
    this.emit('event', { type: 'SEGMENTED', rawPostId: raw.id, listingCount: segments.length })
    const ownership = classifyOwnership(raw.raw_text, { trustedOwnerProfile: isTrustedOwnerProfile(this.db, raw) })
    const nonRental = this.rentOnly && !['offer_rent', 'offer_rent_and_sale'].includes(classification.intent)
    if (this.ownerOnly && (ownership.value !== 'owner' || nonRental)) {
      const status = nonRental ? 'NOT_RENT' : ownership.value === 'uncertain' ? 'OWNER_UNCERTAIN' : 'NOT_OWNER'
      const summary = { classification, ownership, listingCount: segments.length, propertyIds: [] }
      this.#finish(job, 'COMPLETED', summary)
      this.db.prepare('UPDATE raw_posts SET ingestion_status=? WHERE id=?').run(status, raw.id)
      this.emit('event', { type: status, rawPostId: raw.id, ownership })
      return
    }
    try {
      const result = await this.processor(raw)
      const status = 'COMPLETED'
      if (result?.propertyIds?.length) {
        const placeholders = result.propertyIds.map(() => '?').join(',')
        this.db.prepare(`UPDATE properties SET source_role='owner',updated_at=? WHERE id IN (${placeholders})`).run(new Date().toISOString(), ...result.propertyIds)
      }
      const summary = { classification, listingCount: segments.length, propertyIds: result?.propertyIds || [], duplicate: result?.duplicate === true, preservedUserReview: result?.preservedUserReview === true }
      this.#finish(job, status, summary)
      this.db.prepare('UPDATE raw_posts SET ingestion_status=? WHERE id=?').run(status, raw.id)
      this.emit('event', { type: status, rawPostId: raw.id, ...summary })
    } catch (error) {
      const transient = isTransient(error)
      if (transient && job.attempt_count < job.max_attempts) {
        const delay = Math.min(15 * 60_000, 5_000 * 2 ** Math.max(0, job.attempt_count - 1))
        const next = new Date(Date.now() + delay).toISOString()
        this.db.prepare(`UPDATE post_processing_jobs SET status='RETRY', next_retry_at=?, locked_at=NULL, locked_by=NULL, last_error=?, updated_at=? WHERE id=?`).run(next, String(error.message || error), new Date().toISOString(), job.id)
        this.db.prepare("UPDATE raw_posts SET ingestion_status='RETRY' WHERE id=?").run(raw.id)
        this.emit('event', { type: 'RETRY_SCHEDULED', rawPostId: raw.id, nextRetryAt: next, error: String(error.message || error) })
        if (!this.retryTimer) this.retryTimer = setTimeout(() => { this.retryTimer = null; this.kick() }, delay)
      } else {
        const status = transient ? 'FAILED' : 'NEEDS_REVIEW'
        this.#finish(job, status, null, String(error.message || error))
        this.db.prepare('UPDATE raw_posts SET ingestion_status=? WHERE id=?').run(status, raw.id)
        ensureReview(this.db, raw.id, status === 'FAILED' ? 'PROCESSING_FAILED' : 'PROCESSING_VALIDATION_ERROR')
        this.emit('event', { type: status, rawPostId: raw.id, error: String(error.message || error) })
      }
    }
  }

  #finish(job, status, summary = null, error = null) {
    const now = new Date().toISOString()
    this.db.prepare(`UPDATE post_processing_jobs SET status=?, completed_at=?, locked_at=NULL, locked_by=NULL, next_retry_at=NULL, last_error=?, result_summary=?, updated_at=? WHERE id=?`).run(status, now, error, summary ? JSON.stringify(summary) : null, now, job.id)
  }
}

function isTransient(error) { return /timeout|timed out|429|rate limit|network|fetch failed|ECONN|5\d\d/iu.test(String(error?.message || error)) }
function classificationName(intent, text = '') { const role = explicitAgentPostRole(text); if (role === 'co_agent' || intent === 'co_agent_request') return 'CO_AGENT_LISTING'; if (role === 'agent' && /^offer_/u.test(intent)) return 'AGENT_LISTING'; return ({ offer_rent: 'OWNER_LISTING', offer_sale: 'OWNER_LISTING', offer_rent_and_sale: 'OWNER_LISTING', wanted_rent: 'TENANT_REQUIREMENT', wanted_buy: 'BUYER_REQUIREMENT', service_or_spam: 'NOT_PROPERTY', other: 'UNCERTAIN' })[intent] || 'UNCERTAIN' }
function ensureReview(db, rawPostId, reason) {
  const now = new Date().toISOString()
  db.prepare(`INSERT INTO review_queue(raw_post_id, property_id, reason_code, priority, created_at) SELECT ?, NULL, ?, 90, ? WHERE NOT EXISTS (SELECT 1 FROM review_queue WHERE raw_post_id=? AND property_id IS NULL AND reason_code=? AND status='open')`).run(rawPostId, reason, now, rawPostId, reason)
}

function isTrustedOwnerProfile(db, raw) {
  if (!raw.author_profile_url) return false
  const history = db.prepare('SELECT raw_text FROM raw_posts WHERE author_profile_url=? AND id<>? LIMIT 50').all(raw.author_profile_url, raw.id)
  return history.some((item) => classifyOwnership(item.raw_text).value === 'owner')
}
