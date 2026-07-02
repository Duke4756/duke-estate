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
