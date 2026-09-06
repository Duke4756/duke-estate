import { listSets, findSetBySourceUrl } from './postsets.js'

const CD = /^CD-\d{6}$/i
export function distributePlacements(total, rounds) { const n = Math.max(0, Number(total) || 0); const r = Math.max(1, Number(rounds) || 1); const base = Math.floor(n / r); const extra = n % r; return Array.from({ length: r }, (_, i) => base + (i < extra ? 1 : 0)).filter(Boolean) }
export function parseTimeWindows(windows = []) { return windows.map((value) => { const m = String(value).match(/^(\d{2}):(\d{2})-(\d{2}):(\d{2})$/); return m ? { raw: value, start: `${m[1]}:${m[2]}`, end: `${m[3]}:${m[4]}` } : null }).filter(Boolean) }
export function resolveProjectId(item, projects = [], sourceText = '') {
  if (item.projectId && projects.some((project) => String(project.id) === String(item.projectId))) return String(item.projectId)
  const haystack = String(sourceText || '').toLowerCase()
  const match = projects.find((project) => [project.canonical_name, project.canonicalName, project.name, ...(project.aliases || [])].filter(Boolean).some((name) => haystack.includes(String(name).toLowerCase())))
  return match ? String(match.id) : null
}

export function rankPlanGroups(item, groups = [], { memberships, accountIds = [] } = {}) {
  const tags = new Set(item.groupTags || [])
  const candidates = (groups || []).filter((group) => group?.enabled !== false && (group.url || group.id))
    .filter((group) => !accountIds.length || accountIds.some((accountId) => memberships?.(accountId, group.url || group.id) === 'MEMBER'))
    .map((group) => {
      const projectMatch = item.projectId && (group.projectIds || []).map(String).includes(String(item.projectId))
      const projectSpecific = projectMatch || (group.projectTags || []).length > 0 || (group.marketingTags || []).includes('PROJECT_SPECIFIC')
      const tagMatches = (group.marketingTags || []).filter((tag) => tags.has(String(tag).toUpperCase())).length
      let score = tagMatches
      if (projectMatch) score += 1000
      else if (item.projectSpecific && projectSpecific) score += 500
      return { ...group, _score: score, _tagMatches: tagMatches, _projectMatch: Boolean(projectMatch) }
    })
  return candidates.sort((a, b) => b._score - a._score || String(a.name || a.url).localeCompare(String(b.name || b.url))).map(({ _score, _tagMatches, _projectMatch, ...group }) => group)
}

export function buildPlanPlacements(item, groups = [], accountIds = [], memberships) {
  const ranked = rankPlanGroups(item, groups, { memberships, accountIds })
  const rounds = distributePlacements(item.placements, item.rounds)
  const placements = []
  let index = 0
  rounds.forEach((count, roundIndex) => {
    for (let i = 0; i < count; i += 1) {
      const group = ranked[index % Math.max(1, ranked.length)]
      if (!group) continue
      const eligible = accountIds.filter((accountId) => memberships?.(accountId, group.url || group.id) === 'MEMBER')
      if (!eligible.length) continue
      const accountId = eligible[index % eligible.length]
      placements.push({ round: roundIndex + 1, cd: item.cd, postSetId: item.postSetId || null, groupId: group.id || group.url, group: group.url, accountId, preferredTimeWindow: item.timeWindows?.[index % Math.max(1, item.timeWindows?.length || 1)] || null })
      index += 1
    }
  })
  return { groups: ranked, placements, rounds }
}

export function parseMarketingPlan(input) {
  const plan = typeof input === 'string' ? JSON.parse(input) : input
  if (!plan || plan.version !== 1 || !Array.isArray(plan.properties)) throw new Error('AI Marketing Plan ต้องมี version 1 และ properties เป็น array')
  const properties = plan.properties.map((item, index) => {
    const cd = String(item.cd || '').trim().toUpperCase()
    if (!CD.test(cd)) throw new Error(`CD ไม่ถูกต้องที่รายการ ${index + 1}: ${cd || '-'}`)
    return { cd, projectId: item.projectId ? String(item.projectId).trim() : null, projectSpecific: item.projectSpecific === true, priority: Number(item.priority) || 999, groupTags: [...new Set((item.groupTags || []).map((tag) => String(tag).trim().toUpperCase()).filter(Boolean))], placements: Math.max(1, Number(item.placements) || 1), rounds: Math.max(1, Number(item.rounds) || 1), preferredTime: Array.isArray(item.preferredTime) ? item.preferredTime : [], timeWindows: parseTimeWindows(item.preferredTime || []) }
  }).sort((a, b) => a.priority - b.priority)
  return { version: 1, campaign: String(plan.campaign || 'AI Marketing Plan'), properties }
}

export function resolvePlanGroups(plan, groups) {
  return plan.properties.map((item) => ({ ...item, resolvedGroups: rankPlanGroups(item, groups).slice(0, item.placements) }))
}

export function previewMarketingPlan(input, { sets = listSets(), groups = [] } = {}) {
  const base = parseMarketingPlan(input)
  const properties = resolvePlanGroups(base, groups)
  return { ...base, properties: properties.map((item) => { const postSetId = sets.find((set) => new RegExp(`(^|\\s)${item.cd}(?:\\s|$)`, 'i').test(`${set.name}\n${set.text}`))?.id || null; const resolvedGroups = item.resolvedGroups || []; return { ...item, postSetId, resolvedGroups, status: postSetId && resolvedGroups.length ? 'READY' : postSetId ? 'NO_MATCHING_GROUP' : 'NEED_IMPORT' } }) }
}
