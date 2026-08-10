import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { openDatabase } from '../db/index.js'
import { PIPELINE_VERSION } from '../pipeline/versions.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** @param {{db?: import('better-sqlite3').Database, sourceFile?: string}} [options] */
export function verifyOwnerPipeline({
  db = openDatabase(),
  sourceFile = path.join(__dirname, '..', 'owner-posts.json'),
} = {}) {
  const ownsDb = !arguments[0]?.db
  const source = JSON.parse(fs.readFileSync(sourceFile, 'utf8')).posts || []
  const rawPosts = /** @type {{count: number}} */ (db.prepare(`SELECT COUNT(*) count FROM raw_posts WHERE source_adapter = 'legacy_owner_pipeline'`).get()).count
  const processingRuns = /** @type {{count: number}} */ (db.prepare(`
    SELECT COUNT(DISTINCT pr.raw_post_id) count FROM processing_runs pr
    JOIN raw_posts rp ON rp.id = pr.raw_post_id
    WHERE rp.source_adapter = 'legacy_owner_pipeline' AND pr.pipeline_version = ?
  `).get(PIPELINE_VERSION)).count
  const invalidWantedProperties = /** @type {{count: number}} */ (db.prepare(`
    SELECT COUNT(*) count FROM properties p
    JOIN post_classifications c ON c.processing_run_id = p.processing_run_id
    WHERE c.post_intent IN ('wanted_rent', 'wanted_buy') AND p.deleted_at IS NULL
  `).get()).count
  const protectedUserRecords = /** @type {{count: number}} */ (db.prepare(`
    SELECT COUNT(DISTINCT rp.id) count
    FROM raw_posts rp
    JOIN properties p ON p.raw_post_id = rp.id
    WHERE rp.source_adapter = 'legacy_owner_pipeline' AND p.deleted_at IS NULL
      AND (
        p.status = 'confirmed'
        OR EXISTS (
          SELECT 1 FROM audit_events a
          WHERE a.entity_type = 'property' AND a.entity_id = CAST(p.id AS TEXT)
        )
      )
  `).get()).count
  const result = {
    // Older source identities are retained intentionally for rollback/audit.
    // Verification requires full coverage of the current JSON, not deletion
    // of historical raw posts.
    valid: rawPosts >= source.length
      && processingRuns + protectedUserRecords >= source.length
      && invalidWantedProperties === 0,
    source: source.length,
    rawPosts,
    processingRuns,
    protectedUserRecords,
    invalidWantedProperties,
  }
  if (ownsDb) db.close()
  return result
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify(verifyOwnerPipeline(), null, 2))
}
