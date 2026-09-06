function decodeBody(value = '') {
  try { return decodeURIComponent(String(value).replace(/\+/g, ' ')) }
  catch { return String(value) }
}

export function facebookCreatePostMutation(url = '', postData = '') {
  if (!/facebook\.com\/(?:api\/)?graphql/i.test(String(url))) return null
  const candidate = facebookGraphqlFriendlyName(postData)
  if (/comment|reaction|edit|delete/i.test(candidate)) return null
  if (!/(?:composer|story|post|group).*(?:create|publish)|(?:create|publish).*(?:composer|story|post|group)/i.test(candidate)) return null
  return candidate
}

export function facebookGraphqlFriendlyName(postData = '') {
  const body = decodeBody(postData)
  const friendlyName = body.match(/(?:fb_api_req_friendly_name|friendly_name)=([^&]+)/i)?.[1] || ''
  return decodeBody(friendlyName)
}

function walk(value, visit, path = '') {
  if (value == null) return
  if (Array.isArray(value)) return value.forEach((item, index) => walk(item, visit, `${path}.${index}`))
  if (typeof value !== 'object') return visit(path, value)
  for (const [key, item] of Object.entries(value)) walk(item, visit, `${path}.${key}`)
}

export function parseFacebookPublishReceipt(text = '', groupUrl = '', friendlyName = '') {
  const documents = String(text).split('\n').map((line) => {
    try { return JSON.parse(line) } catch { return null }
  }).filter(Boolean)
  if (!documents.length || documents.some((document) => Array.isArray(document.errors) && document.errors.length)) return null

  let permalink = null
  const ids = []
  let hasCreatePayload = false
  for (const document of documents) {
    walk(document, (path, value) => {
      if (/(?:story_create|post_create|create_story|create_post|story_publish|publish_story)/i.test(path) && value != null) hasCreatePayload = true
      if (typeof value === 'string' && /permalink|url/i.test(path) && /facebook\.com\/.*(?:posts|permalink|multi_permalinks)/i.test(value)) permalink ||= value
      if (/\.(?:post_id|story_id|story\.id|post\.id)$/i.test(path) && /^\d{8,}$/.test(String(value))) ids.push(String(value))
    })
  }
  const knownCreateMutation = /(?:composer|story|post|group).*(?:create|publish)|(?:create|publish).*(?:composer|story|post|group)/i.test(friendlyName)
  if (!hasCreatePayload && !knownCreateMutation) return null
  const postId = ids[0] || null
  const groupToken = String(groupUrl).match(/facebook\.com\/groups\/([^/?#]+)/i)?.[1]
  const postUrl = permalink || (postId && groupToken ? `https://www.facebook.com/groups/${groupToken}/posts/${postId}/` : null)
  // A successful create mutation is an authoritative receipt even when the
  // response omits the story id because of Facebook privacy/layout variants.
  if (!postId && !postUrl && !hasCreatePayload) return null
  return { accepted: true, friendlyName: friendlyName || 'unknown_create_mutation', postId, postUrl }
}
