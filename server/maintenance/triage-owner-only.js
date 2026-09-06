import Database from 'better-sqlite3'
import { classifyOwnership } from '../pipeline/ownershipClassifier.js'
import { backfillListingClusters } from '../db/repositories/listingClusters.js'

export function triageOwnerOnly({ filename = 'server/data/condo-leads.sqlite', dryRun = false, requeueLimit = 25 } = {}) {
  const db = new Database(filename)
  db.pragma('foreign_keys = ON')
  const rows = db.prepare('SELECT id,raw_text,author_profile_url FROM raw_posts').all()
  const directOwnerIds = new Set(rows.filter((row) => classifyOwnership(row.raw_text).value === 'owner').map((row) => row.id))
  const trustedProfiles = new Set(rows.filter((row) => directOwnerIds.has(row.id) && row.author_profile_url).map((row) => row.author_profile_url))
  const owner = []; const uncertain = []; const remove = []
  for (const row of rows) {
    const result = classifyOwnership(row.raw_text, { trustedOwnerProfile: trustedProfiles.has(row.author_profile_url) })
    if (result.value === 'owner') owner.push(row.id)
    else if (result.value === 'uncertain') uncertain.push(row.id)
    else remove.push(row.id)
  }
  const preview = { ownerRawPosts: owner.length, uncertainRawPosts: uncertain.length, nonOwnerRawPosts: remove.length }
  if (dryRun) { db.close(); return { dryRun: true, ...preview } }

  const result = db.transaction(() => {
    db.exec('CREATE TEMP TABLE owner_raw(id INTEGER PRIMARY KEY); CREATE TEMP TABLE uncertain_raw(id INTEGER PRIMARY KEY); CREATE TEMP TABLE remove_raw(id INTEGER PRIMARY KEY); CREATE TEMP TABLE remove_property(id INTEGER PRIMARY KEY);')
    const insert = (table, ids) => { const stmt = db.prepare(`INSERT INTO ${table}(id) VALUES (?)`); for (const id of ids) stmt.run(id) }
    insert('owner_raw', owner); insert('uncertain_raw', uncertain); insert('remove_raw', remove)
    db.exec(`
      UPDATE properties SET source_role='owner',updated_at=datetime('now') WHERE raw_post_id IN (SELECT id FROM owner_raw);
      INSERT INTO remove_property SELECT id FROM properties WHERE raw_post_id IN (SELECT id FROM uncertain_raw UNION SELECT id FROM remove_raw);
      CREATE TEMP TABLE remove_cluster AS SELECT DISTINCT cluster_id id FROM listing_cluster_members WHERE property_id IN (SELECT id FROM remove_property);
      DELETE FROM cluster_merge_audits WHERE cluster_id IN (SELECT id FROM remove_cluster) OR property_id IN (SELECT id FROM remove_property);
      DELETE FROM listing_cluster_members WHERE cluster_id IN (SELECT id FROM remove_cluster) OR property_id IN (SELECT id FROM remove_property);
      DELETE FROM listing_clusters WHERE id IN (SELECT id FROM remove_cluster) OR canonical_property_id IN (SELECT id FROM remove_property);
      DELETE FROM duplicate_members WHERE property_id IN (SELECT id FROM remove_property);
      DELETE FROM review_queue WHERE property_id IN (SELECT id FROM remove_property) OR raw_post_id IN (SELECT id FROM remove_raw);
      DELETE FROM field_evidence WHERE property_id IN (SELECT id FROM remove_property);
      DELETE FROM property_transit_stations WHERE property_id IN (SELECT id FROM remove_property);
      DELETE FROM property_repair_state WHERE property_id IN (SELECT id FROM remove_property);
      DELETE FROM properties WHERE id IN (SELECT id FROM remove_property);
      DELETE FROM post_classifications WHERE processing_run_id IN (SELECT id FROM processing_runs WHERE raw_post_id IN (SELECT id FROM remove_raw));
      DELETE FROM processing_runs WHERE raw_post_id IN (SELECT id FROM remove_raw);
      DELETE FROM leads WHERE raw_post_id IN (SELECT id FROM remove_raw);
      DELETE FROM raw_posts WHERE id IN (SELECT id FROM remove_raw);
      UPDATE raw_posts SET ingestion_status='OWNER_UNCERTAIN' WHERE id IN (SELECT id FROM uncertain_raw);
      UPDATE raw_posts SET ingestion_status='OWNER_CONFIRMED' WHERE id IN (SELECT id FROM owner_raw);
    `)
    const now = new Date().toISOString()
    const candidates = db.prepare(`SELECT r.id FROM raw_posts r WHERE r.id IN (SELECT id FROM owner_raw) AND NOT EXISTS (SELECT 1 FROM properties p WHERE p.raw_post_id=r.id) ORDER BY COALESCE(r.source_created_at,r.captured_at,r.collected_at) DESC LIMIT ?`).all(requeueLimit)
    const enqueue = db.prepare("INSERT OR IGNORE INTO post_processing_jobs(raw_post_id,job_type,status,created_at,updated_at) VALUES (?,'PROCESS_RAW_POST','PENDING',?,?)")
    let requeued = 0
    for (const row of candidates) requeued += enqueue.run(row.id, now, now).changes
    return { ...preview, removedProperties: db.prepare('SELECT COUNT(*) FROM remove_property').pluck().get(), requeuedOwners: requeued }
  })()
  const clustersRebuilt = backfillListingClusters(db)
  const foreignKeyErrors = db.pragma('foreign_key_check').length
  db.close()
  return { ...result, clustersRebuilt, foreignKeyErrors }
}

if (process.argv[1]?.endsWith('triage-owner-only.js')) console.log(JSON.stringify(triageOwnerOnly({ dryRun: process.argv.includes('--dry-run') }), null, 2))
