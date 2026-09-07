// Run against the existing API or Vite proxy; never applies a valid plan.
import assert from 'node:assert/strict'
import { previewMarketingPlan, applyMarketingPlan } from '../src/api.js'

const base = process.env.MARKETING_SMOKE_BASE_URL || `http://127.0.0.1:${process.env.PORT || 8787}`
const nativeFetch = globalThis.fetch
const requests = []
globalThis.fetch = async (url, options) => {
  const response = await nativeFetch(new URL(url, base), options)
  requests.push({ path: url, method: options?.method, status: response.status })
  return response
}
try {
  // Use the same helper and JSON-string input as the UI Preview button.
  const preview = await previewMarketingPlan(JSON.stringify({
    version: 1, properties: [{ cd: ' cd-069308 ', groupTags: ['expat', 'EXPAT'] }],
  }))
  assert.equal(preview.version, 1)
  assert.equal(preview.properties[0].cd, 'CD-069308')
  assert.deepEqual(preview.properties[0].groupTags, ['EXPAT'])
  assert.deepEqual(requests[0], { path: '/api/marketing-plan/preview', method: 'POST', status: 200 })
  // Invalid version is rejected by parseMarketingPlan before imports, writes,
  // scheduling or any Facebook operations in the real Apply handler.
  await assert.rejects(() => applyMarketingPlan({ version: 0 }), /version 1/)
  assert.deepEqual(requests[1], { path: '/api/marketing-plan/apply', method: 'POST', status: 400 })
  console.log('PASS: UI helpers → POST preview → parsed response (200); POST apply → validation (400), no Apply side effects.')
} finally {
  globalThis.fetch = nativeFetch
}
