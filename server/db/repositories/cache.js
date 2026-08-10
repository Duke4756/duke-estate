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
