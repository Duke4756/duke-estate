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
