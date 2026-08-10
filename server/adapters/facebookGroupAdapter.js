import { assertRawPost } from './sourceAdapter.js'

export function facebookLeadToRawPost(lead) {
  const permalink = lead.permalink || null
  const sourcePostId = facebookPostIdentity(permalink, lead.id)
  return assertRawPost({
    source_adapter: 'facebook_group',
    source_post_id: sourcePostId,
    source_url: permalink,
    source_group_name: lead.group || null,
    author_name: lead.author || null,
    author_profile_url: lead.authorUrl || null,
    // Shared Facebook posts render the sharer's caption and the original
    // listing in separate DOM nodes. Both are source evidence, so preserve
    // their provenance while keeping group/author/UI chrome out of extraction.
    raw_text: composeFacebookPostText(lead),
    source_created_at: lead.createdAt || null,
    captured_at: lead.capturedAt || new Date().toISOString(),
    crawl_run_id: lead.crawlRunId || null,
    media: lead.media || { imageCount: lead.imageCount || 0, videoCount: lead.videoCount || 0, urls: lead.mediaUrls || [] },
    raw_snippet: lead.rawSnippet || (lead.sharedText ? JSON.stringify({ shareCaption: lead.text || '', sharedPostText: lead.sharedText, sharedPermalink: lead.sharedPermalink || null }) : null),
    collector_version: 'facebook-group-v2-shared-post',
  })
}

export function composeFacebookPostText(lead = {}) {
  const caption = String(lead.text || '').trim()
  const shared = String(lead.sharedText || '').trim()
  if (!shared || normalizeForComparison(shared) === normalizeForComparison(caption)) return caption
  // Original listing first: this is normally where project, room and price
  // live. The sharer's caption remains available as separately-labelled
  // evidence and can express a newer price without being silently discarded.
  return [`[โพสต์ต้นฉบับที่แชร์]`, shared, caption ? `[ข้อความผู้แชร์]\n${caption}` : ''].filter(Boolean).join('\n')
}

function normalizeForComparison(value) { return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase() }

export function facebookPostIdentity(permalink, fallbackId = '') {
  return String(permalink || '').match(/\/(?:posts|permalink)\/([^/?#]+)/i)?.[1]
    || String(fallbackId || '')
}
