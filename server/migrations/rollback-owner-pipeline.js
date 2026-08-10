import { pathToFileURL } from 'node:url'
import { openDatabase } from '../db/index.js'

export function rollbackOwnerPipeline(db = openDatabase()) {
  const ownsDatabase = arguments.length === 0
  const transaction = db.transaction(() => {
    const rawRows = /** @type {{id: number}[]} */ (db.prepare(`
      SELECT id FROM raw_posts WHERE source_adapter = 'legacy_owner_pipeline'
    `).all())
    const rawIds = rawRows.map((row) => row.id)
    if (!rawIds.length) return { rawPosts: 0, processingRuns: 0, properties: 0 }

    const placeholders = rawIds.map(() => '?').join(', ')
    const runRows = /** @type {{id: number}[]} */ (db.prepare(`
      SELECT id FROM processing_runs WHERE raw_post_id IN (${placeholders})
    `).all(...rawIds))
    const runIds = runRows.map((row) => row.id)
    const propertyIds = runIds.length
      ? /** @type {{id: number}[]} */ (db.prepare(`SELECT id FROM properties WHERE processing_run_id IN (${runIds.map(() => '?').join(', ')})`)
        .all(...runIds)).map((row) => row.id)
      : []

    if (propertyIds.length) {
      const propertyPlaceholders = propertyIds.map(() => '?').join(', ')
      db.prepare(`DELETE FROM cluster_merge_audits WHERE property_id IN (${propertyPlaceholders})`).run(...propertyIds)
      db.prepare(`DELETE FROM listing_cluster_members WHERE property_id IN (${propertyPlaceholders})`).run(...propertyIds)
      db.prepare(`UPDATE listing_clusters SET canonical_property_id=(SELECT MIN(property_id) FROM listing_cluster_members WHERE cluster_id=listing_clusters.id) WHERE canonical_property_id IN (${propertyPlaceholders})`).run(...propertyIds)
      db.prepare('DELETE FROM cluster_merge_audits WHERE cluster_id IN (SELECT id FROM listing_clusters WHERE canonical_property_id IS NULL)').run()
      db.prepare('DELETE FROM listing_clusters WHERE canonical_property_id IS NULL').run()
      db.prepare(`DELETE FROM duplicate_members WHERE property_id IN (${propertyPlaceholders})`).run(...propertyIds)
      db.prepare(`DELETE FROM field_evidence WHERE property_id IN (${propertyPlaceholders})`).run(...propertyIds)
      db.prepare(`DELETE FROM review_queue WHERE property_id IN (${propertyPlaceholders})`).run(...propertyIds)
      db.prepare(`DELETE FROM audit_events WHERE entity_type = 'property' AND entity_id IN (${propertyPlaceholders})`)
        .run(...propertyIds.map(String))
      db.prepare(`DELETE FROM properties WHERE id IN (${propertyPlaceholders})`).run(...propertyIds)
      db.prepare('DELETE FROM duplicate_groups WHERE id NOT IN (SELECT DISTINCT duplicate_group_id FROM duplicate_members)').run()
    }
    if (runIds.length) {
      const runPlaceholders = runIds.map(() => '?').join(', ')
      db.prepare(`DELETE FROM post_classifications WHERE processing_run_id IN (${runPlaceholders})`).run(...runIds)
      db.prepare(`DELETE FROM processing_runs WHERE id IN (${runPlaceholders})`).run(...runIds)
    }
    db.prepare(`DELETE FROM review_queue WHERE raw_post_id IN (${placeholders})`).run(...rawIds)
    db.prepare(`DELETE FROM raw_posts WHERE id IN (${placeholders})`).run(...rawIds)
    return { rawPosts: rawIds.length, processingRuns: runIds.length, properties: propertyIds.length }
  })
  const result = transaction()
  if (ownsDatabase) db.close()
  return result
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify(rollbackOwnerPipeline(), null, 2))
}
