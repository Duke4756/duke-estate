export function postVerificationMarkers(text = '') {
  const value = String(text)
  const reference = value.match(/\b[A-Z]{1,8}-\d{3,}\b/i)?.[0]
  const lines = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length >= 8)

  return [...new Set([reference, ...lines].filter(Boolean))]
}

export function facebookPostPermalink(hrefs = [], groupUrl = '') {
  const links = (hrefs || []).map(String)
  for (const href of links) {
    const direct = href.match(/facebook\.com\/groups\/([^/?#]+)\/(?:posts|permalink)\/(\d+)/i)
    if (direct) return `https://www.facebook.com/groups/${direct[1]}/posts/${direct[2]}/`
  }

  const groupToken = String(groupUrl).match(/facebook\.com\/groups\/([^/?#]+)/i)?.[1]
    || links.map((href) => href.match(/\/groups\/([^/?#]+)\//i)?.[1]).find(Boolean)
    || links.map((href) => href.match(/[?&]id=(\d+)/i)?.[1]).find(Boolean)
  if (!groupToken) return null

  const storyId = links.map((href) => href.match(/[?&]story_fbid=(\d+)/i)?.[1]).find(Boolean)
  if (storyId) return `https://www.facebook.com/groups/${groupToken}/posts/${storyId}/`

  // Facebook frequently hides the post id in photo links even when the
  // timestamp/permalink anchor is absent from the rendered card.
  const photoPostId = links.map((href) => href.match(/[?&]set=pcb\.(\d+)/i)?.[1]).find(Boolean)
  return photoPostId ? `https://www.facebook.com/groups/${groupToken}/posts/${photoPostId}/` : null
}
