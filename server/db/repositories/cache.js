export function createCacheRepository(db) {
  return {
    get(contentHash, pipelineVersion, dictionaryVersion) {
      const row = db.prepare(`
        SELECT * FROM extraction_cache
        WHERE content_hash = ? AND pipeline_version = ? AND project_dictionary_version = ?
      `).get(contentHash, pipelineVersion, dictionaryVersion)
      if (!row) return null
      db.prepare(`
        UPDATE extraction_cache SET hit_count = hit_count + 1, last_used_at = ?
        WHERE content_hash = ? AND pipeline_version = ? AND project_dictionary_version = ?
      `).run(new Date().toISOString(), contentHash, pipelineVersion, dictionaryVersion)
      return JSON.parse(row.result_json)
    },
    set(contentHash, pipelineVersion, dictionaryVersion, value) {
      const now = new Date().toISOString()
      db.prepare(`
        INSERT INTO extraction_cache (
          content_hash, pipeline_version, project_dictionary_version,
          result_json, created_at, last_used_at, hit_count
        ) VALUES (?, ?, ?, ?, ?, ?, 0)
        ON CONFLICT(content_hash, pipeline_version, project_dictionary_version)
        DO UPDATE SET result_json = excluded.result_json, last_used_at = excluded.last_used_at
      `).run(contentHash, pipelineVersion, dictionaryVersion, JSON.stringify(value), now, now)
    },
  }
}

// Extraction results are reproducible and version-scoped. Keeping results
// from obsolete pipeline versions only makes SQLite larger and slows backups.
// Retain a bounded LRU window for the current version; raw posts, properties,
// evidence and audit records are deliberately untouched.
/**
 * @param {import('better-sqlite3').Database} db
 * @param {{ pipelineVersion: string, maxEntries?: number }} options
 */
export function pruneExtractionCache(db, { pipelineVersion, maxEntries = 3000 }) {
  if (!pipelineVersion) throw new Error('pipelineVersion is required')
  const obsolete = db.prepare('DELETE FROM extraction_cache WHERE pipeline_version<>?').run(pipelineVersion).changes
  const currentCount = Number(db.prepare('SELECT COUNT(*) FROM extraction_cache WHERE pipeline_version=?').pluck().get(pipelineVersion))
  const excess = Math.max(0, currentCount - maxEntries)
  const lru = excess > 0
    ? db.prepare(`DELETE FROM extraction_cache WHERE rowid IN (SELECT rowid FROM extraction_cache WHERE pipeline_version=? ORDER BY last_used_at ASC,created_at ASC LIMIT ?)`).run(pipelineVersion, excess).changes
    : 0
  return { obsolete, lru, remaining: Number(db.prepare('SELECT COUNT(*) FROM extraction_cache').pluck().get()) }
}
