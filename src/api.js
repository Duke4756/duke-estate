// ── Health / session status ───────────────────────────────────────────────
export async function getHealth() {
  const res = await fetch('/api/health')
  if (!res.ok) throw new Error(`Request failed (${res.status})`)
  return res.json() // { hasSession, gemini, groups, ... }
}
export async function getSystemOverview() {
  const res = await fetch('/api/system-overview')
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || 'โหลดภาพรวมระบบไม่สำเร็จ')
  return body
}

export async function getOwnerRulesStatus() {
  const res = await fetch('/api/owner-rules/status')
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || 'โหลดสถานะกฎไม่สำเร็จ')
  return body
}

export async function refreshOwnerRules() {
  const res = await fetch('/api/owner-rules/refresh', { method: 'POST' })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || 'Refresh Rules ไม่สำเร็จ')
  return body
}

async function sourceRequest(path = '', options) {
  const res = await fetch(`/api/sources${path}`, options)
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || 'จัดการ Source ไม่สำเร็จ')
  return body
}
export const getSources = () => sourceRequest()
export const getSourceCoverage = () => sourceRequest('/coverage')
export const addSourceCandidate = (input) => sourceRequest('/candidates', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) })
export const importSourceCandidates = (text) => sourceRequest('/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) })
export const authorizeSource = (id, authorized = true) => sourceRequest(`/${id}/authorization`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ authorized, accessible: true, reference: 'database_ui' }) })
export const setSourceStatus = (id, status) => sourceRequest(`/${id}/status`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) })
export const controlSourceLane = (lane, action) => sourceRequest(`/${lane}/${action}`, { method: 'POST' })
export const refreshSourcesNow = () => sourceRequest('/refresh-now', { method: 'POST' })
export const getSourceSchedulerStatus = () => sourceRequest('/scheduler/status')

// ── Post Sets (reusable post content for auto-posting) ────────────────────
export async function getPostSets() {
  const res = await fetch('/api/postsets')
  if (!res.ok) throw new Error(`Request failed (${res.status})`)
  return res.json() // { postsets: [{id, name, text, images:[{file,url}], ...}] }
}

export async function previewMarketingPlan(plan) {
  const res = await fetch('/api/marketing-plan/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ plan }) })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`)
  return body.plan
}
export async function applyMarketingPlan(plan) { const res = await fetch('/api/marketing-plan/apply', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ plan }) }); const body = await res.json().catch(() => ({})); if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`); return body }
export async function previewCampaignCsv(csv) { const res = await fetch('/api/campaign-csv/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ csv }) }); const body = await res.json().catch(() => ({})); if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`); return body.preview }
export async function applyCampaignCsv(csv) { const res = await fetch('/api/campaign-csv/apply', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ csv }) }); const body = await res.json().catch(() => ({})); if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`); return body }
export async function exportMarketingPlan() { const res = await fetch('/api/marketing-plan/export'); return res.json() }

export async function importPostSetUrl(url) {
  const res = await fetch('/api/postsets/import-preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`)
  return body.preview
}

/** @param {string} url @param {{ propertyType?: string, deal?: string }} options */
export async function createPostSetFromUrl(url, { propertyType, deal } = {}) {
  const res = await fetch('/api/postsets/import', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url, propertyType, deal }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`)
  return { ...body.postset, duplicateImport: body.duplicate === true }
}

async function jsaSessionRequest(path = '', options) {
  const res = await fetch(`/api/postsets/jsa-session${path}`, options)
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`)
  return body
}

export const getJsaSession = () => jsaSessionRequest()
export const startJsaSession = (url) => jsaSessionRequest('/start', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }),
})
export const finishJsaSession = () => jsaSessionRequest('/finish', { method: 'POST' })
export const disconnectJsaSession = () => jsaSessionRequest('', { method: 'DELETE' })

export async function createPostSet({ name, text, images, sourceUrl, kind, propertyType, deal }) {
  const res = await fetch('/api/postsets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, text, images, sourceUrl, kind, propertyType, deal }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`)
  return body.postset
}

export async function updatePostSet(id, { name, text, keepImages, newImages, imageOrder, propertyType, deal }) {
  const res = await fetch(`/api/postsets/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, text, keepImages, newImages, imageOrder, propertyType, deal }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`)
  return body.postset
}

export async function deletePostSet(id) {
  const res = await fetch(`/api/postsets/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(`Request failed (${res.status})`)
  return res.json()
}

export async function deletePostSets(ids) {
  const res = await fetch('/api/postsets/bulk-delete', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`)
  return body
}

export async function reorderPostSets(ids) {
  const res = await fetch('/api/postsets-order', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`)
  return body
}

// ── Schedules (auto-post plans) ───────────────────────────────────────────
export async function getSchedules() {
  const res = await fetch('/api/schedules')
  if (!res.ok) throw new Error(`Request failed (${res.status})`)
  return res.json() // { schedules: [...] }
}

export async function getPostingSettings() {
  const res = await fetch('/api/posting-settings')
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`)
  return body
}

export async function updatePostingSettings(settings) {
  const res = await fetch('/api/posting-settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`)
  return body
}

export async function getAutoCampaign() {
  const res = await fetch('/api/auto-campaign')
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`)
  return body
}

export async function getAutoCampaignStatus() {
  const res = await fetch('/api/auto-campaign/status')
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`)
  return body
}

export async function openAutopostEvidenceFolder() {
  const res = await fetch('/api/autopost/evidence/open-folder', { method: 'POST' })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`)
  return body
}

export async function updateAutoCampaign(campaign) {
  const res = await fetch('/api/auto-campaign', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(campaign),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`)
  return body
}

async function membershipRequest(accountId, action, options = {}) {
  const res = await fetch(`/api/accounts/${encodeURIComponent(accountId)}/group-membership/${action}`, options)
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`)
  return body
}

export const startGroupMembership = (accountId, groupUrl) => membershipRequest(accountId, 'start', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ groupUrl }),
})
export const getGroupMembershipStatus = (accountId) => membershipRequest(accountId, 'status')
export const finishGroupMembership = (accountId) => membershipRequest(accountId, 'finish', { method: 'POST' })
export const cancelGroupMembership = (accountId) => membershipRequest(accountId, 'cancel', { method: 'POST' })

export async function createSchedule({ name, postSetId, groups, runAt, groupMode, accountId }) {
  const res = await fetch('/api/schedules', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, postSetId, groups, runAt, groupMode, accountId }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`)
  return body.schedule
}

export async function createScheduleBatch({ name, postSetIds, groups, runAt, groupMode, intervalMinutes, jitterMinutes, accountId }) {
  const res = await fetch('/api/schedules/batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, postSetIds, groups, runAt, groupMode, intervalMinutes, jitterMinutes, accountId }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`)
  return body.schedules
}

export async function getAccounts(refresh = false) {
  const res = await fetch(`/api/accounts${refresh ? '?refresh=1' : ''}`)
  if (!res.ok) throw new Error(`Request failed (${res.status})`)
  return res.json()
}

export async function renameAccount(id, name) {
  const res = await fetch(`/api/accounts/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`)
  return body.account
}

export async function startAccountLogin(name) {
  const res = await fetch('/api/accounts/login/start', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`)
  return body.account
}

export async function restartAccountLogin(id, name) {
  const res = await fetch(`/api/accounts/${id}/login/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`)
  return body.account
}

export async function finishAccountLogin(id) {
  const res = await fetch(`/api/accounts/${id}/login/finish`, { method: 'POST' })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`)
  return body.account
}

export async function getAccountLoginStatus(id) {
  const res = await fetch(`/api/accounts/${id}/login/status`)
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`)
  return body
}

export async function cancelAccountLogin(id) {
  const res = await fetch(`/api/accounts/${id}/login/cancel`, { method: 'POST' })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`)
  return body
}

export async function deleteAccount(id) {
  const res = await fetch(`/api/accounts/${id}`, { method: 'DELETE' })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`)
  return body
}

export async function updateSchedule(id, patch) {
  const res = await fetch(`/api/schedules/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`)
  return body.schedule
}

export async function deleteSchedule(id) {
  const res = await fetch(`/api/schedules/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(`Request failed (${res.status})`)
  return res.json()
}

// Run a schedule NOW ("โพสต์เลย"), streaming live progress via SSE.
// Returns the EventSource so the caller can .close() it. Events:
//   progress {message}  ·  done {ok}  ·  fail {error}
export function streamScheduleRun(id, handlers = {}) {
  const { onProgress, onDone, onError } = handlers
  const es = new EventSource(`/api/schedules/${id}/run`)
  es.addEventListener('progress', (e) => onProgress?.(JSON.parse(e.data)))
  es.addEventListener('done', (e) => {
    es.close()
    onDone?.(JSON.parse(e.data))
  })
  es.addEventListener('fail', (e) => {
    es.close()
    let msg = 'เกิดข้อผิดพลาด'
    try {
      msg = JSON.parse(e.data).error
    } catch {
      /* keep default */
    }
    onError?.(msg)
  })
  es.onerror = () => {
    if (es.readyState === EventSource.CLOSED) return
    es.close()
    onError?.('การเชื่อมต่อกับเซิร์ฟเวอร์ขาด')
  }
  return es
}

// ── History (past search rounds, stored as Excel on the backend) ──────────
export async function getHistory() {
  const res = await fetch('/api/history')
  if (!res.ok) throw new Error(`Request failed (${res.status})`)
  return res.json() // { rounds: [...] }
}

export async function getHistoryRound(id) {
  const res = await fetch(`/api/history/${id}`)
  if (!res.ok) throw new Error(`Request failed (${res.status})`)
  return res.json() // { meta, leads }
}

export async function deleteHistoryRound(id) {
  const res = await fetch(`/api/history/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(`Request failed (${res.status})`)
  return res.json()
}

export const historyExcelUrl = (id) => `/api/history/${id}/excel`

export async function getOwnerPosts(params = {}) {
  const query = new URLSearchParams(Object.entries(params).filter(([, value]) => value !== '' && value != null))
  const res = await fetch(`/api/owner-posts?${query}`)
  if (!res.ok) throw new Error(`Request failed (${res.status})`)
  return res.json()
}

export async function deleteOwnerPost(identity) {
  const res = await fetch(`/api/owner-posts/${encodeURIComponent(identity)}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(`Request failed (${res.status})`)
  return res.json()
}

export async function getStructuredProperties(params = {}) {
  const query = new URLSearchParams(Object.entries(params).filter(([, value]) => value !== '' && value != null))
  const res = await fetch(`/api/properties?${query}`)
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`)
  return body
}

export async function getTransitStations(params = {}) {
  const query = new URLSearchParams(Object.entries(params).filter(([, value]) => value !== '' && value != null))
  const res = await fetch(`/api/properties/transit-stations?${query}`)
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`)
  return body
}

export async function getPropertyReviewQueue({ page = 1, pageSize = 8 } = {}) {
  const res = await fetch(`/api/properties/review-queue?page=${page}&pageSize=${pageSize}`)
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`)
  return body
}

export async function propertyReviewAction(id, action) {
  const res = await fetch(`/api/properties/review-queue/${id}/action`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`)
  return body
}

export async function getRawPostStatuses(limit = 50) {
  const res = await fetch(`/api/raw-posts?limit=${encodeURIComponent(limit)}`)
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`)
  return body
}

export async function importLatestSearchResults() {
  const res = await fetch('/api/properties/import-latest', { method: 'POST' })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`)
  return body
}

export async function enrichMissingPropertyData() {
  const res = await fetch('/api/properties/enrich-missing', { method: 'POST' })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`)
  return body
}

export async function startAiPropertyUpdate(force = false) {
  const res = await fetch('/api/properties/ai-update-all', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ force }) })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`)
  return body
}

export async function getAiPropertyUpdateStatus() {
  const res = await fetch('/api/properties/ai-update-all/status')
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`)
  return body
}

export async function updateStructuredProperty(id, patch) {
  const res = await fetch(`/api/properties/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`)
  return body
}

export async function deleteStructuredProperty(id) {
  const res = await fetch(`/api/properties/${id}`, { method: 'DELETE' })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`)
  return body
}

export async function undoStructuredProperty(eventId) {
  const res = await fetch(`/api/properties/undo/${eventId}`, { method: 'POST' })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`)
  return body
}

export async function extractOwnerListing(post, force = false, autoSave = false) {
  const res = await fetch('/api/owner-listings/extract', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ post, force, autoSave }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw Object.assign(new Error(body.error || `Request failed (${res.status})`), { code: body.code })
  return body
}

export async function getOwnerListingReviews() {
  const res = await fetch('/api/owner-listings/reviews')
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`)
  return body
}

export async function updateOwnerListingReview(id, reviewed) {
  const res = await fetch(`/api/owner-listings/reviews/${encodeURIComponent(id)}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reviewed }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`)
  return body.draft
}

export async function ownerListingReviewAction(id, action) {
  const res = await fetch(`/api/owner-listings/reviews/${encodeURIComponent(id)}/action`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw Object.assign(new Error(body.error || `Request failed (${res.status})`), { code: body.code, details: body.details })
  return body
}

// Calls the backend, which scrapes posts and classifies them.
// mode: 'keyword' (fast, rules only) or 'ai' (Gemini).
// fresh: true forces a re-scrape; false reuses the cached scrape (instant).
export async function fetchLeads({ minutes = 60, mode = 'ai', fresh = false } = {}) {
  const res = await fetch(
    `/api/leads?minutes=${minutes}&mode=${mode}${fresh ? '&fresh=1' : ''}`,
  )
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error || `Request failed (${res.status})`)
  }
  return res.json()
}

// Streams the scrape+classify with live progress via SSE.
// Returns the EventSource so the caller can .close() it (e.g. on re-run).
export function streamLeads({ minutes = 60, mode = 'ai', searchMode = 'lead', fresh = false, groupCategory = 'all', customUrl = '', skipGroups = [] } = {}, handlers = {}) {
  const { onProgress, onPipeline, onLeads, onDone, onError } = handlers
  const es = new EventSource(
    `/api/leads/stream?minutes=${minutes}&mode=${mode}&searchMode=${searchMode}&groupCategory=${encodeURIComponent(groupCategory)}${customUrl ? `&customUrl=${encodeURIComponent(customUrl)}` : ''}${skipGroups.length ? `&skipGroups=${encodeURIComponent(skipGroups.join(','))}` : ''}${fresh ? '&fresh=1' : ''}`,
  )
  es.addEventListener('progress', (e) => onProgress?.(JSON.parse(e.data)))
  es.addEventListener('pipeline', (e) => onPipeline?.(JSON.parse(e.data)))
  es.addEventListener('leads', (e) => onLeads?.(JSON.parse(e.data)))
  es.addEventListener('done', (e) => {
    es.close()
    onDone?.(JSON.parse(e.data))
  })
  es.addEventListener('fail', (e) => {
    es.close()
    let msg = 'เกิดข้อผิดพลาด'
    try {
      msg = JSON.parse(e.data).error
    } catch {
      /* keep default */
    }
    onError?.(msg)
  })
  // Native connection error (server unreachable, not our `fail` event).
  es.onerror = () => {
    if (es.readyState === EventSource.CLOSED) return
    es.close()
    onError?.('การเชื่อมต่อกับเซิร์ฟเวอร์ขาด')
  }
  return es
}

export async function getGroups() {
  const res = await fetch('/api/groups')
  if (!res.ok) throw new Error(`Request failed (${res.status})`)
  return res.json() // { groups: [{url, label}] }
}
export async function previewCampaignEngine(input) { const res = await fetch('/api/campaign-engine/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) }); const body = await res.json().catch(() => ({})); if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`); return body }
export async function startCampaignEngine(input) { const res = await fetch('/api/campaign-engine/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) }); const body = await res.json().catch(() => ({})); if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`); return body }
export async function getCampaignGroups(accountId, { refreshMembership = false } = {}) { const query = refreshMembership ? '&refreshMembership=1' : ''; const res = await fetch(`/api/campaign-engine/groups?accountId=${encodeURIComponent(accountId)}${query}`); const body = await res.json().catch(() => ({})); if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`); return body }
export async function previewGroupClassification() { const res = await fetch('/api/groups/classify-preview', { method: 'POST' }); const body = await res.json().catch(() => ({})); if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`); return body }
export async function applyGroupClassification() { const res = await fetch('/api/groups/classify-apply', { method: 'POST' }); const body = await res.json().catch(() => ({})); if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`); return body }
export async function getProjects() { const res = await fetch('/api/properties/projects'); if (!res.ok) throw new Error(`Request failed (${res.status})`); return res.json() }

export async function getGroupCrawlHistory() {
  const res = await fetch('/api/groups/crawl-history')
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`)
  return body
}

export async function saveGroups(groups) {
  const res = await fetch('/api/groups', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ groups }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`)
  return body // { groups: [{url, label}] }
}

export async function resolveGroupNames(urls) {
  const res = await fetch('/api/groups/resolve-names', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ urls }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`)
  return body
}

export async function getKeywords() {
  const res = await fetch('/api/keywords')
  if (!res.ok) throw new Error(`Request failed (${res.status})`)
  return res.json() // { defaults, extras, merged }
}

export async function saveKeywordsApi(keywords) {
  const res = await fetch('/api/keywords', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ keywords }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`)
  return body // { keywords, merged }
}

export async function retryMarketingProperty(property) {
  const response = await fetch('/api/marketing-plan/retry-property', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ property }) })
  const body = await response.json()
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`)
  return body
}
