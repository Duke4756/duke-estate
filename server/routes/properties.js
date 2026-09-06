import express from 'express'
import { enrichMissingProperties } from '../services/enrichProperties.js'

/** @param {any} service @param {any} [processingQueue] @param {any} [repairJob] */
export function createPropertiesRouter(service, processingQueue = null, repairJob = null) {
  const router = express.Router()
  router.get('/', (req, res) => {
    try {
      res.json(service.query({ ...req.query, ownerOnly: true, rentOnly: true }))
    } catch (error) {
      res.status(500).json({ error: errorMessage(error) })
    }
  })
  router.get('/projects', (_req, res) => {
    try {
      res.json({ projects: service.listProjects() })
    } catch (error) {
      res.status(500).json({ error: errorMessage(error) })
    }
  })
  router.get('/transit-stations', (req, res) => {
    try {
      res.json({ stations: service.listTransitStations(req.query) })
    } catch (error) {
      res.status(500).json({ error: errorMessage(error) })
    }
  })
  router.get('/review-queue', (req, res) => {
    try {
      const page = Math.max(1, Number(req.query.page) || 1)
      const pageSize = Math.min(25, Math.max(5, Number(req.query.pageSize) || 8))
      const total = service.db.prepare("SELECT COUNT(*) count FROM review_queue WHERE status='open'").get().count
      const items = service.db.prepare(`
        SELECT q.*, r.source_url, r.raw_text, r.ingestion_status, p.warnings_json,
          (SELECT json_group_array(json_object('field',e.field_name,'quote',e.quote,'confidence',e.confidence,'status',e.validation_status,'warning',e.warning)) FROM field_evidence e WHERE e.property_id=p.id) evidence_json,
          (SELECT json_group_array(json_object('status',pts.match_status,'stationId',pts.station_id,'originalMention',pts.original_mention,'evidenceText',pts.evidence_text,'confidence',pts.confidence,'matchMethod',pts.match_method,'candidates',json(pts.candidates_json))) FROM property_transit_stations pts WHERE pts.property_id=p.id) transit_json
        FROM review_queue q JOIN raw_posts r ON r.id=q.raw_post_id
        LEFT JOIN properties p ON p.id=q.property_id
        WHERE q.status='open' ORDER BY q.priority DESC, q.created_at
        LIMIT ? OFFSET ?
      `).all(pageSize, (page - 1) * pageSize).map((row) => ({ ...row, warnings: JSON.parse(row.warnings_json || '[]'), evidence: JSON.parse(row.evidence_json || '[]'), transitStations: JSON.parse(row.transit_json || '[]') }))
      res.json({ items, total, page, pageSize, pages: Math.max(1, Math.ceil(total / pageSize)) })
    } catch (error) { res.status(500).json({ error: errorMessage(error) }) }
  })
  router.post('/review-queue/:id/action', (req, res) => {
    try {
      const item = service.db.prepare('SELECT * FROM review_queue WHERE id=? AND status=\'open\'').get(Number(req.params.id))
      if (!item) return res.status(404).json({ error: 'review item not found' })
      const action = req.body?.action
      const now = new Date().toISOString()
      if (action === 'approve' && item.property_id) {
        const before = service.db.prepare('SELECT * FROM properties WHERE id=?').get(item.property_id)
        service.db.prepare("UPDATE properties SET status='confirmed', updated_at=? WHERE id=?").run(now, item.property_id)
        service.db.prepare("UPDATE review_queue SET status='resolved', resolved_at=? WHERE id=?").run(now, item.id)
        const after = service.db.prepare('SELECT * FROM properties WHERE id=?').get(item.property_id)
        service.db.prepare(`INSERT INTO audit_events(entity_type,entity_id,action,before_json,after_json,actor,created_at) VALUES ('property',?,'human_approve',?,?,'user',?)`).run(String(item.property_id), JSON.stringify(before), JSON.stringify(after), now)
      } else if (action === 'reject') {
        if (item.property_id) service.remove(item.property_id, 'human_review_reject')
        service.db.prepare("UPDATE review_queue SET status='rejected', resolved_at=? WHERE id=?").run(now, item.id)
      } else if (action === 'reprocess' && processingQueue) {
        service.db.prepare(`INSERT OR IGNORE INTO post_processing_jobs(raw_post_id,job_type,status,created_at,updated_at) VALUES (?,'PROCESS_RAW_POST','PENDING',?,?)`).run(item.raw_post_id, now, now)
        processingQueue.kick()
      } else return res.status(400).json({ error: 'unsupported action' })
      res.json({ ok: true })
    } catch (error) { res.status(400).json({ error: errorMessage(error) }) }
  })
  router.post('/projects', (req, res) => {
    try {
      if (!req.body?.id || !req.body?.canonicalName) return res.status(400).json({ error: 'id and canonicalName are required' })
      res.json({ project: service.addProject(req.body) })
    } catch (error) {
      res.status(400).json({ error: errorMessage(error) })
    }
  })
  router.post('/enrich-missing', (_req, res) => {
    try {
      res.json({ ok: true, ...enrichMissingProperties(service) })
    } catch (error) {
      res.status(500).json({ error: errorMessage(error) })
    }
  })
  router.post('/ai-update-all', (req, res) => {
    if (!repairJob) return res.status(503).json({ error: 'AI update service is unavailable' })
    try { res.status(202).json(repairJob.start({ force: req.body?.force === true })) }
    catch (error) { res.status(500).json({ error: errorMessage(error) }) }
  })
  router.get('/ai-update-all/status', (_req, res) => {
    if (!repairJob) return res.status(503).json({ error: 'AI update service is unavailable' })
    res.json(repairJob.status())
  })
  router.put('/:id', (req, res) => {
    try {
      const result = service.update(Number(req.params.id), req.body || {}, 'user')
      if (!result) return res.status(404).json({ error: 'not found or no editable fields' })
      res.json(result)
    } catch (error) {
      res.status(400).json({ error: errorMessage(error) })
    }
  })
  router.delete('/:id', (req, res) => {
    try {
      const result = service.remove(Number(req.params.id), 'user')
      if (!result) return res.status(404).json({ error: 'not found' })
      res.json(result)
    } catch (error) {
      res.status(400).json({ error: errorMessage(error) })
    }
  })
  router.post('/undo/:eventId', (req, res) => {
    try {
      const property = service.undo(Number(req.params.eventId), 'user')
      if (!property) return res.status(404).json({ error: 'undo event not found' })
      res.json({ property })
    } catch (error) {
      res.status(400).json({ error: errorMessage(error) })
    }
  })
  return router
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}
