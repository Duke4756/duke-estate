import crypto from 'node:crypto'
import { SCHEDULER_POLICY } from '../config/sourceIntelligence.js'

export function scoreSource(source, { coverageGap = 0, now = Date.now(), policy = SCHEDULER_POLICY } = {}) {
  const ageHours = source.last_success_at ? Math.max(0, (now - Date.parse(source.last_success_at)) / 3_600_000) : 168
  const freshness = Math.min(2, 0.5 + ageHours / 48)
  const exploration = Number(sourceMetricsTotal(source) === 0) * policy.weights.exploration
  const reliability = Math.max(0.05, 1 - Number(source.failure_rate || 0))
  const benefit = Number(source.unique_listing_yield || 0) * policy.weights.uniqueYield
    + Number(source.owner_lead_yield || 0) * policy.weights.ownerYield
    + Number(source.activity_rate || 0) * policy.weights.changeRate
    + freshness * policy.weights.freshness
    + Number(coverageGap || 0) * policy.weights.coverageGap
    + reliability * policy.weights.reliability
    + exploration
  return benefit - Number(source.estimated_collection_cost || 1) * policy.weights.cost
    - Number(source.duplicate_rate || 0) * policy.weights.duplicate
    - Number(source.failure_rate || 0) * policy.weights.failure
}

export function createAdaptiveScheduler(db, registry, policy = SCHEDULER_POLICY) {
  function ranked({ lane = 'FRESHNESS', coverageGaps = {}, now = Date.now(), force = false } = {}) {
    return registry.schedulable()
      .filter((source) => lane !== 'BACKFILL' || source.metadata?.backfillEnabled !== false)
      .filter((source) => force || lane === 'BACKFILL' || !source.next_capture_at || Date.parse(source.next_capture_at) <= now)
      .map((source) => ({ ...source, priority: scoreSource(source, { coverageGap: gapFor(source, coverageGaps), now, policy }) }))
      .sort((a, b) => b.priority - a.priority || a.id - b.id)
  }
  return {
    ranked,
    plan({ lane = 'FRESHNESS', limit = policy.concurrency, coverageGaps = {}, budget = {}, force = false } = {}) {
      const normalizedLane = lane === 'BACKFILL' ? 'BACKFILL' : 'FRESHNESS'
      const ceiling = force ? policy.globalSourceBudget : policy.concurrency
      const max = Math.max(0, Math.min(Number(limit) || ceiling, ceiling))
      const pendingFreshness = normalizedLane === 'BACKFILL'
        ? db.prepare("SELECT COUNT(*) count FROM source_crawl_jobs WHERE lane='FRESHNESS' AND status IN ('PENDING','RUNNING','RETRY')").get().count
        : 0
      if (pendingFreshness) return []
      const now = new Date().toISOString()
      const jobs = []
      for (const source of ranked({ lane: normalizedLane, coverageGaps, force }).slice(0, max)) {
        const checkpoint = normalizedLane === 'FRESHNESS' ? source.latest_checkpoint : source.oldest_backfill_checkpoint
        const idempotencyKey = `${source.id}:${normalizedLane}:${checkpoint || 'origin'}${force ? `:manual:${Date.now()}` : ''}`
        const id = `src_${crypto.randomUUID()}`
        const result = db.prepare(`INSERT OR IGNORE INTO source_crawl_jobs(id,source_group_id,lane,status,idempotency_key,budget_json,checkpoint_before,priority,created_at,updated_at) VALUES (?,?,?,'PENDING',?,?,?,?,?,?)`)
          .run(id, source.id, normalizedLane, idempotencyKey, JSON.stringify({ pages: policy.perSourcePageBudget, ...budget }), checkpoint || null, source.priority, now, now)
        if (result.changes) jobs.push(this.getJob(id))
      }
      return jobs
    },
    claim(workerId) {
      const now = new Date().toISOString()
      return db.transaction(() => {
        const job = db.prepare(`SELECT j.* FROM source_crawl_jobs j JOIN source_groups s ON s.id=j.source_group_id WHERE j.status IN ('PENDING','RETRY') AND (j.next_retry_at IS NULL OR j.next_retry_at<=?) AND s.status='ACTIVE' AND s.authorization_status='AUTHORIZED' AND s.access_status='ACCESSIBLE' ORDER BY CASE j.lane WHEN 'FRESHNESS' THEN 0 ELSE 1 END,j.priority DESC,j.created_at LIMIT 1`).get(now)
        if (!job) return null
        const changed = db.prepare("UPDATE source_crawl_jobs SET status='RUNNING',locked_at=?,locked_by=?,started_at=COALESCE(started_at,?),attempt_count=attempt_count+1,updated_at=? WHERE id=? AND status IN ('PENDING','RETRY')").run(now, workerId, now, now, job.id)
        return changed.changes ? this.getJob(job.id) : null
      })()
    },
    complete(id, { checkpoint = null, metrics = {} } = {}) {
      const job = this.getJob(id); if (!job) return null
      const now = new Date().toISOString()
      db.transaction(() => {
        db.prepare("UPDATE source_crawl_jobs SET status='COMPLETED',checkpoint_after=?,completed_at=?,locked_at=NULL,locked_by=NULL,updated_at=? WHERE id=?").run(checkpoint, now, now, id)
        const column = job.lane === 'BACKFILL' ? 'oldest_backfill_checkpoint' : 'latest_checkpoint'
        db.prepare(`UPDATE source_groups SET ${column}=COALESCE(?,${column}),next_capture_at=?,updated_at=? WHERE id=?`).run(checkpoint, new Date(Date.now() + policy.freshnessIntervalMinutes * 60_000).toISOString(), now, job.source_group_id)
        registry.recordCapture(job.source_group_id, metrics)
      })()
      return this.getJob(id)
    },
    fail(id, error) {
      const job = this.getJob(id); if (!job) return null
      const now = new Date().toISOString()
      const terminal = job.attempt_count >= policy.failurePauseThreshold
      const delay = Math.min(policy.maxBackoffMinutes * 60_000, policy.inactiveBackoffMinutes * 60_000 * 2 ** Math.max(0, job.attempt_count))
      db.transaction(() => {
        db.prepare("UPDATE source_crawl_jobs SET status=?,next_retry_at=?,last_error=?,locked_at=NULL,locked_by=NULL,updated_at=? WHERE id=?").run(terminal ? 'FAILED' : 'RETRY', terminal ? null : new Date(Date.now() + delay).toISOString(), String(error?.message || error), now, id)
        registry.recordCapture(job.source_group_id, { capture_failures: 1 })
        if (terminal) registry.setStatus(job.source_group_id, 'PAUSED')
      })()
      return this.getJob(id)
    },
    getJob(id) { const row = db.prepare('SELECT * FROM source_crawl_jobs WHERE id=?').get(id); return row ? { ...row, budget: JSON.parse(row.budget_json || '{}') } : null },
    status() {
      return db.prepare('SELECT lane,status,COUNT(*) count FROM source_crawl_jobs GROUP BY lane,status ORDER BY lane,status').all()
    },
    recoverStale(maxAgeMs = 30 * 60_000) {
      const now = new Date().toISOString()
      const cutoff = new Date(Date.now() - maxAgeMs).toISOString()
      return db.prepare("UPDATE source_crawl_jobs SET status='RETRY',locked_at=NULL,locked_by=NULL,next_retry_at=?,updated_at=? WHERE status='RUNNING' AND locked_at<?").run(now, now, cutoff).changes
    },
  }
}

function sourceMetricsTotal(source) { return Number(source.posts_seen || 0) + Number(source.raw_posts_created || 0) }
function gapFor(source, gaps) { return Object.values(source.tags || {}).flat().reduce((max, tag) => Math.max(max, Number(gaps[tag] || 0)), 0) }
