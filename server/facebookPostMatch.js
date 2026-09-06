export function postVerificationMarkers(text = '') {
  const value = String(text)
  const reference = value.match(/\b[A-Z]{1,8}-\d{3,}\b/i)?.[0]
  const lines = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length >= 8)

  return [...new Set([reference, ...lines].filter(Boolean))]
}

export function facebookPostPermalink(hrefs = [], groupUrl = '', { allowPhotoFallback = true } = {}) {
  const links = (hrefs || []).map(String)
  for (const href of links) {
    const direct = href.match(/facebook\.com\/groups\/([^/?#]+)\/(?:posts|permalink)\/(\d+)/i)
    if (direct) return `https://www.facebook.com/groups/${direct[1]}/posts/${direct[2]}/`
    const multi = href.match(/facebook\.com\/groups\/([^/?#]+)\/[?#][^#]*\bmulti_permalinks=(\d+)/i)
    if (multi) return `https://www.facebook.com/groups/${multi[1]}/posts/${multi[2]}/`
  }

  const groupToken = String(groupUrl).match(/facebook\.com\/groups\/([^/?#]+)/i)?.[1]
    || links.map((href) => href.match(/\/groups\/([^/?#]+)\//i)?.[1]).find(Boolean)
    || links.map((href) => href.match(/[?&]id=(\d+)/i)?.[1]).find(Boolean)
  if (!groupToken) return null

  const storyId = links.map((href) => href.match(/[?&]story_fbid=(\d+)/i)?.[1]).find(Boolean)
  if (storyId) return `https://www.facebook.com/groups/${groupToken}/posts/${storyId}/`

  // Facebook frequently hides the post id in photo links even when the
  // timestamp/permalink anchor is absent from the rendered card.
  if (!allowPhotoFallback) return null
  const photoPostId = links.map((href) => href.match(/[?&]set=pcb\.(\d+)/i)?.[1]).find(Boolean)
  return photoPostId ? `https://www.facebook.com/groups/${groupToken}/posts/${photoPostId}/` : null
}

// Delayed verification must not attach an older post with the same property
// reference to a new schedule. Facebook exposes either a unix timestamp on a
// time link or a short relative label on newly-created cards. If neither is
// available we deliberately leave the result unconfirmed.
export function isPostCardRecent({ unixTimes = [], cardText = '', submittedAt, now = Date.now(), toleranceMs = 5 * 60_000, maxAgeMs = 6 * 60 * 60_000 } = {}) {
  const submittedMs = new Date(submittedAt || 0).getTime()
  if (!Number.isFinite(submittedMs) || submittedMs <= 0) return false
  const numericTimes = (unixTimes || [])
    .map(Number)
    .filter(Number.isFinite)
    .map((value) => value < 10_000_000_000 ? value * 1000 : value)
  if (numericTimes.some((value) => value >= submittedMs - toleranceMs && value <= now + toleranceMs)) return true

  const text = String(cardText)
  if (/(?:เมื่อสักครู่|เพิ่งโพสต์|ไม่กี่วินาที|just now|a few seconds)/i.test(text)) {
    return now - submittedMs <= maxAgeMs
  }
  const relative = text.match(/(?:^|\s)(\d{1,3})\s*(นาที|ชม\.|ชั่วโมง|min(?:ute)?s?|hr|hours?)(?:\s*(?:ที่แล้ว|ago))?(?:\s|$)/i)
  if (!relative) return false
  const amount = Number(relative[1])
  const unitMs = /^(?:ชม\.|ชั่วโมง|hr|hour)/i.test(relative[2]) ? 60 * 60_000 : 60_000
  const estimatedAt = now - amount * unitMs
  // Relative hour labels are rounded aggressively by Facebook ("1 hr" can
  // represent anything from roughly 60-119 minutes). Allow one display unit
  // of rounding while still enforcing the absolute six-hour safety window.
  const displayRoundingMs = unitMs === 60 * 60_000 ? unitMs : 0
  return estimatedAt >= submittedMs - toleranceMs - displayRoundingMs && now - submittedMs <= maxAgeMs
}
