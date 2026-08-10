import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { contentHash } from '../pipeline/hash.js'
import { ownerListingExtractionSchema, validateOwnerListingExtraction } from '../pipeline/ownerListingSchema.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const prompt = fs.readFileSync(path.join(__dirname, '..', 'prompts', 'owner-listing-extractor.v1.txt'), 'utf8')
const AUTO_TYPES = new Set(['owner_rent', 'owner_sale', 'agent_listing', 'co_agent_listing'])

export function createOwnerListingExtractionService({ extract = callGeminiOwnerExtractor, now = () => new Date().toISOString() } = {}) {
  const drafts = new Map()
  const cache = new Map()
  let sequence = 0

  return {
    async preview(post, { force = false } = {}) {
      const classification = post.classification?.value || post.category || 'unknown'
      if (!force && !AUTO_TYPES.has(classification)) {
        const error = new Error('โพสต์นี้ไม่ใช่ Owner/Agent listing; ต้องกด Extract เอง')
        error.code = 'EXTRACTION_NOT_ELIGIBLE'
        throw error
      }
      const hash = contentHash(post.text)
      const cached = cache.get(hash)
      if (cached) return this.createDraft(post, cached.result, { cacheHit: true, rawAiResponse: cached.rawAiResponse })
      let extracted
      try {
        extracted = await extract(post)
      } catch (error) {
        throw normalizeExtractionError(error)
      }
      if (!extracted?.result) throw extractionError('EMPTY_RESULT', 'Gemini returned an empty result')
      validateOwnerListingExtraction(post.text, extracted.result)
      const debugEnabled = ['1', 'true'].includes(String(process.env.DEBUG_OWNER_AI || '').toLowerCase())
      const safeRaw = debugEnabled ? redactRawResponse(extracted.rawResponse) : null
      cache.set(hash, { result: extracted.result, rawAiResponse: safeRaw })
      return this.createDraft(post, extracted.result, { cacheHit: false, rawAiResponse: safeRaw })
    },
    createDraft(post, result, metadata = {}) {
      const id = `old_${Date.now()}_${++sequence}`
      const draft = {
        id, status: 'pending_review', source: sourceOf(post), extraction: result,
        reviewed: structuredClone(result), attempts: 1, cacheHit: Boolean(metadata.cacheHit),
        rawAiResponse: metadata.rawAiResponse || null, createdAt: now(), updatedAt: now(), reviewLog: [],
      }
      drafts.set(id, draft)
      return structuredClone(draft)
    },
    list() { return [...drafts.values()].map((draft) => structuredClone(draft)) },
    get(id) { const draft = drafts.get(id); return draft ? structuredClone(draft) : null },
    update(id, reviewed) {
      const draft = drafts.get(id)
      if (!draft) return null
      validateOwnerListingExtraction(draft.source.text, reviewed)
      draft.reviewLog.push({ action: 'edit', before: draft.reviewed, after: reviewed, at: now() })
      draft.reviewed = structuredClone(reviewed)
      draft.updatedAt = now()
      return structuredClone(draft)
    },
    mark(id, action) {
      const allowed = new Set(['mark_not_owner', 'mark_multiple_listings', 'mark_duplicate', 'skip'])
      if (!allowed.has(action)) throw extractionError('INVALID_REVIEW_ACTION', 'invalid review action')
      const draft = drafts.get(id)
      if (!draft) return null
      draft.reviewLog.push({ action, before: draft.status, after: action, at: now() })
      draft.status = action
      draft.updatedAt = now()
      return structuredClone(draft)
    },
    markSaved(id, propertyId) {
      const draft = drafts.get(id)
      if (!draft) return null
      draft.reviewLog.push({ action: 'confirm_and_save', before: draft.status, after: { status: 'saved', propertyId }, at: now() })
      draft.status = 'saved'; draft.propertyId = propertyId; draft.updatedAt = now()
      return structuredClone(draft)
    },
  }
}

async function callGeminiOwnerExtractor(post, {
  apiKey = process.env.GEMINI_API_KEY,
  model = process.env.GEMINI_MODEL || 'gemini-2.5-flash',
  timeoutMs = 30_000,
  fetchImpl = fetch,
} = {}) {
  if (!apiKey) throw extractionError('CONFIGURATION', 'GEMINI_API_KEY is not configured')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  let response
  try {
    response = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
      method: 'POST', signal: controller.signal, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: prompt }] },
        contents: [{ role: 'user', parts: [{ text: JSON.stringify({ SOURCE_TEXT: post.text }) }] }],
        generationConfig: { responseMimeType: 'application/json', responseSchema: toGeminiSchema(ownerListingExtractionSchema), temperature: 0, maxOutputTokens: 8192 },
      }),
    })
  } catch (error) {
    if (error.name === 'AbortError') throw extractionError('TIMEOUT', 'Gemini request timed out')
    throw error
  } finally { clearTimeout(timer) }
  if (response.status === 429) throw extractionError('RATE_LIMIT', 'Gemini rate limit exceeded')
  if (!response.ok) throw extractionError('AI_REQUEST_FAILED', `Gemini ${response.status}: ${(await response.text()).slice(0, 200)}`)
  const body = await response.json()
  const rawResponse = body.candidates?.[0]?.content?.parts?.[0]?.text
  if (!rawResponse) throw extractionError('EMPTY_RESULT', 'Gemini returned no content')
  try { return { result: JSON.parse(rawResponse), rawResponse } }
  catch { throw extractionError('INVALID_JSON', 'Gemini returned invalid JSON') }
}

function sourceOf(post) {
  return {
    postId: post.sourcePostId || String(post.permalink || '').match(/\/(?:posts|permalink)\/([^/?#]+)/i)?.[1] || post.id,
    url: post.permalink || null, group: post.group || null, text: post.text || '',
    capturedAt: new Date().toISOString(), postedAt: post.createdAt || null,
    images: Array.isArray(post.images) ? post.images.filter((value) => typeof value === 'string').slice(0, 10) : [],
  }
}

function normalizeExtractionError(error) {
  if (error?.code) return error
  if (error?.name === 'AbortError') return extractionError('TIMEOUT', 'Gemini request timed out')
  return extractionError('AI_REQUEST_FAILED', error?.message || 'AI extraction failed')
}

function extractionError(code, message) { const error = new Error(message); error.code = code; return error }
function redactRawResponse(value) { return value == null ? null : String(value).replace(/(?:\+66|0)\d[\d -]{7,12}\d/g, '[PHONE]').slice(0, 20_000) }
function toGeminiSchema(value) {
  if (Array.isArray(value)) return value.map(toGeminiSchema)
  if (!value || typeof value !== 'object') return value
  // Gemini structured output supports only a subset of JSON Schema. AJV still
  // enforces additionalProperties=false after the response returns.
  const converted = Object.fromEntries(Object.entries(value).filter(([key]) => !['$id', 'additionalProperties'].includes(key)).map(([key, item]) => [key, toGeminiSchema(item)]))
  if (typeof converted.type === 'string') converted.type = converted.type.toUpperCase()
  return converted
}
