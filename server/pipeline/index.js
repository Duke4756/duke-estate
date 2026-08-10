import { contentHash } from './hash.js'
import { normalizeText } from './normalizer.js'
import { extractCandidates } from './candidateExtractor.js'
import { deterministicExtract } from './deterministicExtractor.js'
import { extractWithAI } from './aiExtractor.js'
import { assertValidExtraction } from './validator.js'
import { resolveProject } from './projectResolver.js'
import { PIPELINE_VERSION, CANDIDATE_VERSION, PROMPT_VERSION } from './versions.js'

/** @param {any} options */
export async function processPost({
  rawPost,
  projects = [],
  transitDictionary = [],
  useAI = false,
  aiOptions = {},
  cache = null,
  dictionaryVersion = 'empty-v1',
}) {
  const started = Date.now()
  const normalized = normalizeText(rawPost.raw_text)
  const hash = contentHash(normalized.text)
  const cached = cache?.get(hash, PIPELINE_VERSION, dictionaryVersion)
  if (cached) return { ...cached, metadata: { ...cached.metadata, cacheHit: true } }
  const candidates = extractCandidates(normalized.raw)
  let result
  let rawAiResponse = null
  /** @type {string | null} */
  let model = null
  if (useAI) {
    try {
      const ai = await extractWithAI({
        rawPost: normalized.raw,
        candidates,
        projectCandidates: projects,
        transitDictionary,
        ...aiOptions,
      })
      result = ai.result
      rawAiResponse = ai.rawResponse
      model = ai.model
      assertValidExtraction(normalized.raw, result)
    } catch {
      // Collection must remain available when the AI provider is rate-limited,
      // offline, or returns malformed output. The deterministic extractor is
      // auditable and gives us a useful record that can be enriched later.
      result = deterministicExtract(normalized.raw)
      result = {
        ...result,
        warnings: [...new Set([...(result.warnings || []), 'AI_FALLBACK'])],
        properties: result.properties.map((property) => ({
          ...property,
          warnings: [...new Set([...(property.warnings || []), 'AI_FALLBACK'])],
        })),
      }
      model = 'deterministic-fallback'
    }
  } else {
    result = deterministicExtract(normalized.raw)
  }
  result = resolveProjects(result, projects)
  assertValidExtraction(normalized.raw, result)
  result = attachCanonicalTransit(result, normalized.raw, aiOptions.transitMatcher)
  const output = {
    result,
    normalized,
    candidates,
    metadata: {
      pipelineVersion: PIPELINE_VERSION,
      parserVersion: CANDIDATE_VERSION,
      promptVersion: useAI ? PROMPT_VERSION : null,
      model,
      dictionaryVersion,
      durationMs: Date.now() - started,
      cacheHit: false,
      rawAiResponse,
    },
  }
  cache?.set(hash, PIPELINE_VERSION, dictionaryVersion, output)
  return output
}

function attachCanonicalTransit(result, rawText, matcher) {
  const matches = matcher?.extract?.(rawText) || []
  return {
    ...result,
    properties: result.properties.map((property) => ({
      ...property,
      // Legacy AI/rule free text is never authoritative. The relation rows
      // persisted from transit_matches are the only supported station source.
      nearby_transit: null,
      transit_distance_m: null,
      evidence: (property.evidence || []).filter((item) => !['nearby_transit', 'transit_distance_m'].includes(item.field)),
      field_confidence: Object.fromEntries(Object.entries(property.field_confidence || {}).filter(([field]) => !['nearby_transit', 'transit_distance_m'].includes(field))),
      transit_matches: matches,
      warnings: [...new Set([
        ...(property.warnings || []),
        ...matches.filter((item) => item.status === 'ambiguous').map(() => 'TRANSIT_STATION_AMBIGUOUS'),
        ...matches.filter((item) => item.status === 'not_found').map(() => 'TRANSIT_STATION_NOT_FOUND'),
      ])],
    })),
  }
}

function resolveProjects(result, projects) {
  return {
    ...result,
    properties: result.properties.map((property) => {
      if (!property.project_name_raw) return property
      const resolution = resolveProject(property.project_name_raw, projects)
      if (!resolution.project_verified) return { ...property, ...resolution }
      const quote = property.evidence.find((item) => item.field === 'project_name_raw')?.quote
      const evidence = [...property.evidence]
      const fieldConfidence = { ...property.field_confidence }
      for (const field of ['project_id', 'project_name_canonical']) {
        evidence.push({ field, quote, confidence: resolution.project_match_score })
        fieldConfidence[field] = resolution.project_match_score
      }
      return { ...property, ...resolution, evidence, field_confidence: fieldConfidence }
    }),
  }
}
