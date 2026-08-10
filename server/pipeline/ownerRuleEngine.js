import { contentHash } from './hash.js'

export function evaluateOwnerRules(post, rules) {
  const text = String(post?.text || '')
  let score = 0
  const evidence = []
  for (const row of rules?.keywords || []) {
    const keyword = String(row.keyword || row.Keyword || row.pattern || '').trim()
    if (!keyword || !text.toLocaleLowerCase().includes(keyword.toLocaleLowerCase())) continue
    const points = Number(row.score ?? row.Score ?? 0) || 0
    score += points
    evidence.push({ source: 'rule', field: 'post_type', quote: keyword, score: points })
  }
  const threshold = Number(rules?.config?.owner_auto_accept_score) || 5
  return { score, threshold, candidate: score >= threshold, evidence, contentHash: contentHash(text) }
}

export function matchProject(rawName, rules) {
  const raw = String(rawName || '').trim()
  if (!raw) return { status: 'manual_review', project: null, confidence: 0, method: 'none', evidence: [] }
  const normalized = normalize(raw)
  const aliases = rules?.aliases || []
  const projects = rules?.projects || []
  const aliasName = (row) => String(row.alias || row.Alias || row.project_alias || '').trim()
  const projectId = (row) => String(row.project_id || row.Project_ID || row.id || '').trim()
  let hit = aliases.find((row) => aliasName(row) === raw)
  let method = 'exact_alias'; let confidence = 1
  if (!hit) { hit = aliases.find((row) => normalize(aliasName(row)) === normalized); method = 'normalized_alias'; confidence = 0.95 }
  if (!hit) {
    const ranked = aliases.map((row) => ({ row, score: similarity(normalized, normalize(aliasName(row))) })).sort((a, b) => b.score - a.score)
    if (ranked[0]?.score >= 0.82 && (!ranked[1] || ranked[0].score - ranked[1].score >= 0.08)) { hit = ranked[0].row; method = 'fuzzy_alias'; confidence = ranked[0].score }
    else return { status: ranked[0]?.score >= 0.65 ? 'ambiguous' : 'ai_suggestion', project: null, confidence: ranked[0]?.score || 0, method: 'manual_review', evidence: [] }
  }
  const id = projectId(hit)
  const project = projects.find((row) => projectId(row) === id) || null
  return { status: project ? 'matched' : 'manual_review', project, projectId: id || null, confidence, method, evidence: [{ source: 'project_alias', quote: aliasName(hit) }] }
}

function normalize(value) { return String(value || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '') }
function similarity(a, b) {
  if (!a || !b) return 0
  const bigrams = (value) => new Set([...Array(Math.max(0, value.length - 1))].map((_, i) => value.slice(i, i + 2)))
  const left = bigrams(a); const right = bigrams(b)
  if (!left.size || !right.size) return a === b ? 1 : 0
  let common = 0; for (const item of left) if (right.has(item)) common++
  return (2 * common) / (left.size + right.size)
}
