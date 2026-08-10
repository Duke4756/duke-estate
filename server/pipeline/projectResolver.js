import { normalizeLookup } from './normalizer.js'

export function resolveProject(rawName, projects, { fuzzyThreshold = 0.88, ambiguityMargin = 0.04 } = {}) {
  if (!rawName) return unresolved(null, 'none')
  const needle = normalizeLookup(rawName)
  if (!needle) return unresolved(rawName, 'unverified')
  for (const project of projects || []) {
    const aliases = project.aliases || []
    if (aliases.some((alias) => normalizeLookup(alias) === needle)) return resolved(project, rawName, 'alias_exact', 1)
  }
  for (const project of projects || []) {
    if (normalizeLookup(project.canonical_name) === needle) return resolved(project, rawName, 'canonical_exact', 1)
  }
  const ranked = (projects || [])
    .map((project) => ({ project, score: similarity(needle, normalizeLookup(project.canonical_name)) }))
    .sort((a, b) => b.score - a.score)
  const best = ranked[0]
  const second = ranked[1]
  if (best && best.score >= fuzzyThreshold && (!second || best.score - second.score >= ambiguityMargin)) {
    return resolved(best.project, rawName, 'fuzzy', best.score)
  }
  return unresolved(rawName, 'unverified')
}

function resolved(project, rawName, method, score) {
  return {
    project_name_raw: rawName,
    project_id: String(project.id),
    project_name_canonical: project.canonical_name,
    project_match_method: method,
    project_match_score: score,
    project_verified: true,
  }
}

function unresolved(rawName, method) {
  return {
    project_name_raw: rawName,
    project_id: null,
    project_name_canonical: null,
    project_match_method: method,
    project_match_score: 0,
    project_verified: false,
  }
}

function similarity(a, b) {
  if (!a || !b) return 0
  const distance = levenshtein(a, b)
  return 1 - distance / Math.max(a.length, b.length)
}

function levenshtein(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0]
    row[0] = i
    for (let j = 1; j <= b.length; j++) {
      const current = row[j]
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1))
      previous = current
    }
  }
  return row[b.length]
}
