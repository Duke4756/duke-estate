// ── Health / session status ───────────────────────────────────────────────
export async function getHealth() {
  const res = await fetch('/api/health')
  if (!res.ok) throw new Error(`Request failed (${res.status})`)
  return res.json() // { hasSession, gemini, groups, ... }
}

// ── Post Sets (reusable post content for auto-posting) ────────────────────
export async function getPostSets() {
  const res = await fetch('/api/postsets')
  if (!res.ok) throw new Error(`Request failed (${res.status})`)
  return res.json() // { postsets: [{id, name, text, images:[{file,url}], ...}] }
}

export async function createPostSet({ name, text, images }) {
  const res = await fetch('/api/postsets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, text, images }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`)
  return body.postset
}

export async function updatePostSet(id, { name, text, keepImages, newImages }) {
  const res = await fetch(`/api/postsets/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, text, keepImages, newImages }),
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

// ── Schedules (auto-post plans) ───────────────────────────────────────────
export async function getSchedules() {
  const res = await fetch('/api/schedules')
  if (!res.ok) throw new Error(`Request failed (${res.status})`)
  return res.json() // { schedules: [...] }
}

export async function createSchedule({ name, postSetId, groups, runAt }) {
  const res = await fetch('/api/schedules', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, postSetId, groups, runAt }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`)
  return body.schedule
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
export function streamLeads({ minutes = 60, mode = 'ai', fresh = false } = {}, handlers = {}) {
  const { onProgress, onLeads, onDone, onError } = handlers
  const es = new EventSource(
    `/api/leads/stream?minutes=${minutes}&mode=${mode}${fresh ? '&fresh=1' : ''}`,
  )
  es.addEventListener('progress', (e) => onProgress?.(JSON.parse(e.data)))
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

export async function getKeywords() {
  const res = await fetch('/api/keywords')
  if (!res.ok) throw new Error(`Request failed (${res.status})`)
  return res.json() // { defaults, extras, merged }
}

export async function saveKeywordsApi(extras) {
  const res = await fetch('/api/keywords', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ extras }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`)
  return body // { extras, merged }
}
