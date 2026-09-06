import express from 'express'
import { splitListingCluster } from '../db/repositories/listingClusters.js'
import { SCHEDULER_POLICY } from '../config/sourceIntelligence.js'

export function createSourcesRouter({ db, registry, scheduler, coverage, runJobs = async (_options = {}) => {} }) {
  const router = express.Router()
  const state = () => db.prepare('SELECT * FROM source_autopilot_state WHERE id=1').get() || { id: 1, autopilot_enabled: 0, backfill_enabled: 0 }
  const setState = (field, enabled) => {
    const now = new Date().toISOString()
    db.prepare(`INSERT INTO source_autopilot_state(id,${field},updated_at) VALUES (1,?,?) ON CONFLICT(id) DO UPDATE SET ${field}=excluded.${field},updated_at=excluded.updated_at`).run(enabled ? 1 : 0, now)
    return state()
  }
  router.get('/', (req, res) => {
    try { res.json({ sources: registry.list({ status: req.query.status || '', authorization: req.query.authorization || '' }), state: state(), jobs: scheduler.status() }) }
    catch (error) { res.status(500).json({ error: message(error) }) }
  })
  router.post('/candidates', (req, res) => {
    try { res.status(201).json({ source: registry.addCandidate(req.body || {}) }) }
    catch (error) { res.status(400).json({ error: message(error) }) }
  })
  router.post('/import', (req, res) => {
    const candidates = Array.isArray(req.body?.candidates) ? req.body.candidates : parseDelimited(req.body?.text || '')
    const sources = []; const errors = []
    for (const [index, candidate] of candidates.entries()) {
      try {
        if (candidate._parseError) throw new Error(candidate._parseError)
        sources.push(registry.addCandidate({ ...candidate, discoveredVia: candidate.discoveredVia || 'user_import' }))
      }
      catch (error) { errors.push({ line: index + 1, input: candidate.url || '', error: message(error) }) }
    }
    const added = sources.filter((item) => item._created).length
    res.json({ received: candidates.length, added, duplicates: sources.length - added, invalid: errors.length, sources, errors })
  })
  router.post('/discover-visible', (req, res) => {
    try {
      const cards = Array.isArray(req.body?.groups) ? req.body.groups : []
      const sources = cards.map((card) => registry.addCandidate({ ...card, discoveredVia: 'visible_dom', evidenceText: card.evidenceText || card.name || '', evidenceUrl: card.evidenceUrl || card.url }))
      res.json({ discovered: cards.length, unique: new Set(sources.map((item) => item.id)).size, sources })
    } catch (error) { res.status(400).json({ error: message(error) }) }
  })
  router.put('/:id/authorization', (req, res) => {
    try { res.json({ source: registry.authorize(Number(req.params.id), { authorized: req.body?.authorized === true, accessible: req.body?.accessible !== false, reference: req.body?.reference || 'user_confirmation' }) }) }
    catch (error) { res.status(400).json({ error: message(error) }) }
  })
  router.put('/:id/status', (req, res) => {
    const allowed = ['ACTIVE','PAUSED','INACCESSIBLE','ERROR','ARCHIVED','PENDING_ACCESS','DISCOVERED']
    if (!allowed.includes(req.body?.status)) return res.status(400).json({ error: 'invalid source status' })
    try { res.json({ source: registry.setStatus(Number(req.params.id), req.body.status) }) }
    catch (error) { res.status(400).json({ error: message(error) }) }
  })
  router.get('/coverage', (_req, res) => { try { res.json(coverage.estimate()) } catch (error) { res.status(500).json({ error: message(error) }) } })
  router.get('/problems', (_req, res) => {
    const sources = registry.list().filter((item) => ['PAUSED','INACCESSIBLE','ERROR'].includes(item.status) || Number(item.failure_rate) > 0.25)
    res.json({ sources })
  })
  router.post('/autopilot/start', (_req, res) => {
    const result = { state: setState('autopilot_enabled', true), planned: scheduler.plan({ lane: 'FRESHNESS' }) }
    queueMicrotask(() => runJobs().catch((error) => console.error('Source Autopilot failed:', message(error))))
    res.status(202).json(result)
  })
  router.post('/autopilot/stop', (_req, res) => { db.prepare("UPDATE source_crawl_jobs SET status='CANCELLED',updated_at=? WHERE lane='FRESHNESS' AND status IN ('PENDING','RETRY')").run(new Date().toISOString()); res.json({ state: setState('autopilot_enabled', false) }) })
  router.post('/backfill/start', (_req, res) => {
    const result = { state: setState('backfill_enabled', true), planned: scheduler.plan({ lane: 'BACKFILL' }) }
    queueMicrotask(() => runJobs().catch((error) => console.error('Source Backfill failed:', message(error))))
    res.status(202).json(result)
  })
  router.post('/backfill/stop', (_req, res) => { db.prepare("UPDATE source_crawl_jobs SET status='CANCELLED',updated_at=? WHERE lane='BACKFILL' AND status IN ('PENDING','RETRY')").run(new Date().toISOString()); res.json({ state: setState('backfill_enabled', false) }) })
  router.post('/scheduler/plan', (req, res) => { try { res.json({ jobs: scheduler.plan(req.body || {}) }) } catch (error) { res.status(400).json({ error: message(error) }) } })
  router.post('/refresh-now', (_req, res) => {
    try {
      // A manual refresh is a small, prioritized delta capture—not an
      // unbounded drain of every historical pending job. This keeps one click
      // responsive on the same machine that serves the UI and database.
      const now = new Date().toISOString()
      db.prepare("UPDATE source_crawl_jobs SET status='CANCELLED',completed_at=?,updated_at=? WHERE status IN ('PENDING','RETRY')").run(now, now)
      const limit = SCHEDULER_POLICY.manualRefreshSourceBudget
      const planned = scheduler.plan({ lane: 'FRESHNESS', force: true, limit })
      queueMicrotask(() => runJobs({ manual: true, maxJobs: planned.length }).catch((error) => console.error('Manual source refresh failed:', message(error))))
      res.status(202).json({ status: 'running', planned })
    } catch (error) { res.status(500).json({ error: message(error) }) }
  })
  router.get('/scheduler/status', (_req, res) => res.json({ state: state(), jobs: scheduler.status() }))
  router.post('/clusters/:propertyId/split', (req, res) => {
    try { const result = splitListingCluster(db, Number(req.params.propertyId), 'user'); if (!result) return res.status(404).json({ error: 'cluster member not found' }); res.json(result) }
    catch (error) { res.status(400).json({ error: message(error) }) }
  })
  return router
}

function parseDelimited(text) {
  return String(text).split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
    if (line.startsWith('{')) {
      try { return JSON.parse(line) }
      catch { return { url: line, _parseError: 'JSON ไม่ถูกต้อง' } }
    }
    const [url, name = ''] = line.split(',').map((value) => value.trim())
    return { url, name }
  })
}
function message(error) { return error instanceof Error ? error.message : String(error) }
