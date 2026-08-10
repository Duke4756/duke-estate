import express from 'express'

export function createOwnerListingsRouter({ extractionService, repository }) {
  const router = express.Router()
  router.get('/reviews', (_req, res) => res.json({ drafts: extractionService.list() }))
  router.post('/extract', async (req, res) => {
    try {
      const draft = await extractionService.preview(req.body?.post || {}, { force: req.body?.force === true })
      res.json({ draft })
    } catch (error) {
      sendError(res, error)
    }
  })
  router.put('/reviews/:id', async (req, res) => {
    try {
      const draft = extractionService.update(req.params.id, req.body?.reviewed)
      if (!draft) return res.status(404).json({ error: 'review draft not found' })
      res.json({ draft })
    } catch (error) { sendError(res, error) }
  })
  router.post('/reviews/:id/action', async (req, res) => {
    try {
      const draft = extractionService.get(req.params.id)
      if (!draft) return res.status(404).json({ error: 'review draft not found' })
      const action = req.body?.action
      if (action === 'confirm_and_save') {
        const saved = repository.confirmAndSave(draft, draft.reviewed, 'user')
        extractionService.markSaved(draft.id, `property_${saved.propertyId}`)
        return res.json({ saved, draft: extractionService.get(draft.id) })
      }
      const updated = extractionService.mark(draft.id, action)
      res.json({ draft: updated })
    } catch (error) { sendError(res, error) }
  })
  return router
}

function sendError(res, error) {
  const status = error?.code === 'RATE_LIMIT' ? 429
    : error?.code === 'TIMEOUT' ? 504
      : error?.code === 'POSSIBLE_DUPLICATE' ? 409
        : error?.code === 'SCHEMA_VALIDATION_FAILED' || error?.code === 'VALIDATION_FAILED' || error?.code === 'EXTRACTION_NOT_ELIGIBLE' ? 400
          : 500
  res.status(status).json({ error: error?.message || String(error), code: error?.code || 'UNKNOWN', details: error?.details })
}
