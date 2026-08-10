// Facebook exposes the same group through several hostnames and URL variants.
// Compare the group path instead of the raw URL so those variants count as one.
export function groupKey(value = '') {
  const raw = String(value).trim()
  try {
    const url = new URL(raw)
    if (!/(^|\.)facebook\.com$/i.test(url.hostname)) return raw.toLowerCase()
    const match = url.pathname.match(/^\/groups\/([^/?#]+)/i)
    return match ? decodeURIComponent(match[1]).toLowerCase() : raw.toLowerCase()
  } catch {
    const match = raw.match(/facebook\.com\/groups\/([^/?#]+)/i)
    return match ? decodeURIComponent(match[1]).toLowerCase() : raw.toLowerCase()
  }
}

export function hasGroup(groups, url) {
  const key = groupKey(url)
  return groups.some((group) => groupKey(typeof group === 'string' ? group : group?.url) === key)
}
