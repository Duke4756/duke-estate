import Database from 'better-sqlite3'
import { classifyOwnership } from '../pipeline/ownershipClassifier.js'
import { classifyIntent } from '../pipeline/intentClassifier.js'
import { backfillListingClusters } from '../db/repositories/listingClusters.js'

export function pruneOwnerRentOnly({ filename = 'server/data/condo-leads.sqlite', dryRun = false } = {}) {
  const db = new Database(filename)
  db.pragma('foreign_keys = ON')
  const removeRawIds = []
  for (const row of db.prepare('SELECT id,raw_text FROM raw_posts').iterate()) {
    const role = classifyOwnership(row.raw_text).value
    const intent = classifyIntent(row.raw_text).intent
    if (['agent','co_agent'].includes(role) || ['offer_sale','wanted_buy'].includes(intent)) removeRawIds.push(row.id)
  }
  const saleProperties = db.prepare("SELECT COUNT(*) count FROM properties WHERE transaction_type NOT IN ('rent','rent_and_sale')").get().count
  if (dryRun) { db.close(); return { dryRun: true, rawPosts: removeRawIds.length, properties: saleProperties } }
  const result = db.transaction(() => {
    db.exec('CREATE TEMP TABLE remove_raw(id INTEGER PRIMARY KEY); CREATE TEMP TABLE remove_property(id INTEGER PRIMARY KEY);')
    const add = db.prepare('INSERT INTO remove_raw(id) VALUES (?)'); for (const id of removeRawIds) add.run(id)
    db.exec(`
      INSERT INTO remove_property SELECT id FROM properties WHERE raw_post_id IN (SELECT id FROM remove_raw) OR transaction_type NOT IN ('rent','rent_and_sale');
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
    `)
    return { removedRawPosts: db.prepare('SELECT COUNT(*) FROM remove_raw').pluck().get(), removedProperties: db.prepare('SELECT COUNT(*) FROM remove_property').pluck().get() }
  })()
  const clustersRebuilt = backfillListingClusters(db)
  const foreignKeyErrors = db.pragma('foreign_key_check').length
  db.close()
  return { ...result, clustersRebuilt, foreignKeyErrors }
}

if (process.argv[1]?.endsWith('prune-owner-rent-only.js')) console.log(JSON.stringify(pruneOwnerRentOnly({ dryRun: process.argv.includes('--dry-run') }), null, 2))
