import { contentHash } from '../../pipeline/hash.js'

export function createRawPostRepository(db) {
  const insert = db.prepare(`
    INSERT INTO raw_posts (
      source_adapter, source_post_id, source_url, source_url_normalized,
      source_group_id, source_group_name, author_name, raw_text, content_hash,
      source_created_at, collected_at, collector_version,
      collection_warnings_json, legacy_identity
      , author_profile_url, media_json, crawl_run_id, raw_snippet,
      ingestion_status, captured_at
    ) VALUES (
      @source_adapter, @source_post_id, @source_url, @source_url_normalized,
      @source_group_id, @source_group_name, @author_name, @raw_text, @content_hash,
      @source_created_at, @collected_at, @collector_version,
      @collection_warnings_json, @legacy_identity
      , @author_profile_url, @media_json, @crawl_run_id, @raw_snippet,
      @ingestion_status, @captured_at
    )
  `)
  const byLegacy = db.prepare('SELECT * FROM raw_posts WHERE legacy_identity = ? LIMIT 1')
  const bySource = db.prepare('SELECT * FROM raw_posts WHERE source_adapter = ? AND source_post_id = ? LIMIT 1')
  const byUrl = db.prepare('SELECT * FROM raw_posts WHERE source_adapter = ? AND source_url_normalized = ? LIMIT 1')
  const byHash = db.prepare('SELECT * FROM raw_posts WHERE source_adapter = ? AND content_hash = ? LIMIT 1')
  const byId = db.prepare('SELECT * FROM raw_posts WHERE id = ?')
  const updateCollectedPost = db.prepare(`
    UPDATE raw_posts SET
      source_url = @source_url, source_url_normalized = @source_url_normalized,
      source_group_name = @source_group_name, author_name = @author_name,
      raw_text = @raw_text, content_hash = @content_hash,
      source_created_at = @source_created_at, collected_at = @collected_at,
      collector_version = @collector_version,
      collection_warnings_json = @collection_warnings_json,
      author_profile_url = COALESCE(@author_profile_url, author_profile_url),
      media_json = @media_json, crawl_run_id = COALESCE(@crawl_run_id, crawl_run_id),
      raw_snippet = COALESCE(@raw_snippet, raw_snippet),
      ingestion_status = @ingestion_status, captured_at = @captured_at
    WHERE id = @id
  `)
  return {
    upsert(input) {
      if (input.legacy_identity) {
        const existing = byLegacy.get(input.legacy_identity)
        if (existing) return { ...existing, _created: false }
      }
      const adapter = input.source_adapter || 'unknown'
      const normalizedUrl = normalizeSourceUrl(input.source_url)
      const nextHash = contentHash(input.raw_text)
      const hasMeaningfulText = String(input.raw_text || '').trim().length > 0
      if (input.source_post_id || normalizedUrl || hasMeaningfulText) {
        const existing = (input.source_post_id && bySource.get(adapter, input.source_post_id))
          || (normalizedUrl && byUrl.get(adapter, normalizedUrl))
          || (!input.source_post_id && !normalizedUrl && hasMeaningfulText && byHash.get(adapter, nextHash))
        if (existing) {
          if (nextHash === existing.content_hash) return { ...existing, _created: false, _contentChanged: false }
          db.prepare(`INSERT OR IGNORE INTO raw_post_versions(raw_post_id, content_hash, raw_text, source_url, captured_at, metadata_json) VALUES (?, ?, ?, ?, ?, ?)`)
            .run(existing.id, existing.content_hash, existing.raw_text, existing.source_url, existing.captured_at || existing.collected_at, JSON.stringify({ replacedByHash: nextHash }))
          updateCollectedPost.run({
            id: existing.id,
            source_url: input.source_url || existing.source_url,
            source_url_normalized: normalizeSourceUrl(input.source_url) || existing.source_url_normalized,
            source_group_name: input.source_group_name || existing.source_group_name,
            author_name: input.author_name || existing.author_name,
            raw_text: String(input.raw_text || ''),
            content_hash: nextHash,
            source_created_at: input.source_created_at || existing.source_created_at,
            collected_at: input.collected_at || new Date().toISOString(),
            collector_version: input.collector_version || 'unknown',
            collection_warnings_json: JSON.stringify(input.collection_warnings || []),
            author_profile_url: input.author_profile_url || null,
            media_json: JSON.stringify(input.media || {}),
            crawl_run_id: input.crawl_run_id || null,
            raw_snippet: input.raw_snippet || null,
            ingestion_status: 'CAPTURED',
            captured_at: input.captured_at || new Date().toISOString(),
          })
          return { ...byId.get(existing.id), _created: false, _contentChanged: true }
        }
      }
      const row = {
        source_adapter: adapter,
        source_post_id: input.source_post_id || null,
        source_url: input.source_url || null,
        source_url_normalized: normalizedUrl,
        source_group_id: input.source_group_id || null,
        source_group_name: input.source_group_name || null,
        author_name: input.author_name || null,
        raw_text: String(input.raw_text || ''),
        content_hash: contentHash(input.raw_text),
        source_created_at: input.source_created_at || null,
        collected_at: input.collected_at || new Date().toISOString(),
        collector_version: input.collector_version || 'unknown',
        collection_warnings_json: JSON.stringify(input.collection_warnings || []),
        legacy_identity: input.legacy_identity || null,
        author_profile_url: input.author_profile_url || null,
        media_json: JSON.stringify(input.media || {}),
        crawl_run_id: input.crawl_run_id || null,
        raw_snippet: input.raw_snippet || null,
        ingestion_status: 'CAPTURED',
        captured_at: input.captured_at || new Date().toISOString(),
      }
      const result = insert.run(row)
      return { ...byId.get(result.lastInsertRowid), _created: true }
    },
    get(id) { return byId.get(id) || null },
    count() { return db.prepare('SELECT COUNT(*) AS count FROM raw_posts').get().count },
  }
}

export function normalizeSourceUrl(value) {
  if (!value) return null
  try {
    const url = new URL(value, 'https://www.facebook.com')
    url.hostname = url.hostname.replace(/^web\./, 'www.')
    url.search = ''
    url.hash = ''
    return url.href.replace(/\/+$/, '')
  } catch {
    return String(value).trim() || null
  }
}
