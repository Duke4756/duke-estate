const OWNER_ACCEPTED = new Set(['owner_rent', 'owner_sale', 'agent_listing', 'co_agent_listing'])

export function resolveSearchMode(value) {
  return value === 'owner_listing' ? 'owner_listing' : 'lead'
}

export function filterOwnerSearchResults(posts, visibility = 'owner') {
  if (visibility === 'all') return posts
  if (visibility === 'unknown') return posts.filter((post) => post.category === 'unknown')
  if (visibility === 'rejected') return posts.filter((post) => !OWNER_ACCEPTED.has(post.category) && post.category !== 'unknown')
  return posts.filter((post) => OWNER_ACCEPTED.has(post.category))
}

export function searchClassificationCacheKey(mode, hash) {
  return `${resolveSearchMode(mode)}:${hash}`
}
