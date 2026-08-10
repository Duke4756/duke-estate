import { contentHash } from '../../pipeline/hash.js'

const ADAPTER = 'facebook_group'

export function normalizeGroupKey(value = '') {
  const raw = String(value || '').trim()
  const match = raw.match(/facebook\.com\/groups\/([^/?#]+)/i)
  return (match?.[1] || raw).toLowerCase()
}

export function createCrawlStateRepository(db) {
  const hasSeen = db.prepare(`
    SELECT 1 FROM crawl_seen_posts
    WHERE source_adapter = ? AND source_post_id = ?
    LIMIT 1
  `)
  const upsertSeen = db.prepare(`
    INSERT INTO crawl_seen_posts (
      source_adapter, source_post_id, source_group_key, source_url,
      content_hash, first_seen_at, last_seen_at, seen_count
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 1)
    ON CONFLICT(source_adapter, source_post_id) DO UPDATE SET
      source_group_key = excluded.source_group_key,
      source_url = COALESCE(excluded.source_url, crawl_seen_posts.source_url),
      content_hash = COALESCE(excluded.content_hash, crawl_seen_posts.content_hash),
      last_seen_at = excluded.last_seen_at,
      seen_count = crawl_seen_posts.seen_count + 1
  `)
  const getGroup = db.prepare(`
    SELECT * FROM crawl_group_state
    WHERE source_adapter = ? AND source_group_key = ?
  `)
  const startGroup = db.prepare(`
    INSERT INTO crawl_group_state (
      source_adapter, source_group_key, last_started_at
    ) VALUES (?, ?, ?)
    ON CONFLICT(source_adapter, source_group_key) DO UPDATE SET
      last_started_at = excluded.last_started_at
  `)
  const completeGroup = db.prepare(`
    INSERT INTO crawl_group_state (
      source_adapter, source_group_key, completed_runs, last_depth,
      last_seen_count, last_new_count, total_new_count,
      last_started_at, last_completed_at
    ) VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(source_adapter, source_group_key) DO UPDATE SET
      completed_runs = crawl_group_state.completed_runs + 1,
      last_depth = MAX(crawl_group_state.last_depth, excluded.last_depth),
      last_seen_count = excluded.last_seen_count,
      last_new_count = excluded.last_new_count,
      total_new_count = crawl_group_state.total_new_count + excluded.last_new_count,
      last_completed_at = excluded.last_completed_at
  `)

  return {
    isKnown(sourcePostId) {
      return Boolean(sourcePostId && hasSeen.get(ADAPTER, String(sourcePostId)))
    },
    markSeen({ sourcePostId, groupUrl, sourceUrl, text, seenAt = new Date().toISOString() }) {
      if (!sourcePostId) return false
      const known = this.isKnown(sourcePostId)
      upsertSeen.run(
        ADAPTER,
        String(sourcePostId),
        normalizeGroupKey(groupUrl),
        sourceUrl || null,
        text ? contentHash(text) : null,
        seenAt,
        seenAt,
      )
      return known
    },
    start(groupUrl, startedAt = new Date().toISOString()) {
      const key = normalizeGroupKey(groupUrl)
      startGroup.run(ADAPTER, key, startedAt)
      return getGroup.get(ADAPTER, key) || null
    },
    recommendedDepth(groupUrl, baseDepth, increment = 4, maximum = 120) {
      const state = getGroup.get(ADAPTER, normalizeGroupKey(groupUrl))
      if (!state?.last_depth) return Math.min(maximum, baseDepth)
      return Math.min(maximum, Math.max(baseDepth, state.last_depth + increment))
    },
    complete(groupUrl, { depth, seen, fresh, completedAt = new Date().toISOString() }) {
      const key = normalizeGroupKey(groupUrl)
      const state = getGroup.get(ADAPTER, key)
      completeGroup.run(
        ADAPTER,
        key,
        depth,
        seen,
        fresh,
        fresh,
        state?.last_started_at || completedAt,
        completedAt,
      )
      return getGroup.get(ADAPTER, key)
    },
    get(groupUrl) {
      return getGroup.get(ADAPTER, normalizeGroupKey(groupUrl)) || null
    },
    list() {
      return db.prepare(`
        SELECT * FROM crawl_group_state
        WHERE source_adapter = ?
        ORDER BY COALESCE(last_completed_at, last_started_at) DESC
      `).all(ADAPTER)
    },
    countSeen() {
      return db.prepare('SELECT COUNT(*) count FROM crawl_seen_posts WHERE source_adapter = ?')
        .get(ADAPTER).count
    },
  }
}
