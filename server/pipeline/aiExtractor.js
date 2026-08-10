import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { extractionSchema } from './extractionSchema.js'
import { assertValidExtraction } from './validator.js'
import { PROMPT_VERSION } from './versions.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const prompt = fs.readFileSync(path.join(__dirname, '..', 'prompts', 'property-extractor.v1.txt'), 'utf8')

export async function extractWithAI({
  rawPost,
  candidates,
  projectCandidates = [],
  transitDictionary = [],
  apiKey = process.env.GEMINI_API_KEY,
  model = process.env.GEMINI_MODEL || 'gemini-2.5-flash',
  fetchImpl = fetch,
}) {
  if (!apiKey) throw new Error('GEMINI_API_KEY is not configured')
  const response = await fetchImpl(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: prompt }] },
        contents: [{
          role: 'user',
          parts: [{
            text: JSON.stringify({
              RAW_POST: rawPost,
              CANDIDATES: candidates,
              PROJECT_CANDIDATES: projectCandidates,
              TRANSIT_DICTIONARY: transitDictionary,
            }),
          }],
        }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: toGeminiSchema(extractionSchema),
          temperature: 0,
          maxOutputTokens: 16384,
        },
      }),
    },
  )
  if (!response.ok) throw new Error(`Gemini ${response.status}: ${(await response.text()).slice(0, 300)}`)
  const body = await response.json()
  const raw = body.candidates?.[0]?.content?.parts?.[0]?.text
  if (!raw) throw new Error('Gemini returned no JSON content')
  let result
  try {
    result = JSON.parse(raw)
  } catch {
    throw new Error('Gemini returned invalid JSON')
  }
  return {
    result: assertValidExtraction(rawPost, result),
    rawResponse: raw,
    promptVersion: PROMPT_VERSION,
    model,
  }
}

function toGeminiSchema(value) {
  if (Array.isArray(value)) return value.map(toGeminiSchema)
  if (!value || typeof value !== 'object') return value
  const converted = Object.fromEntries(
    Object.entries(value)
      // Gemini accepts a JSON Schema subset and rejects additionalProperties.
      // The full schema is still enforced locally after parsing.
      .filter(([key]) => !['$id', 'additionalProperties'].includes(key))
      .map(([key, item]) => [key, toGeminiSchema(item)]),
  )
  if (typeof converted.type === 'string') converted.type = converted.type.toUpperCase()
  return converted
}
