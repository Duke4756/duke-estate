import Database from 'better-sqlite3'
import { explicitAgentPostRole } from '../pipeline/candidateExtractor.js'
import { backfillListingClusters } from '../db/repositories/listingClusters.js'

export function removeAgentPosts({ filename = 'server/data/condo-leads.sqlite', dryRun = false } = {}) {
  const db = new Database(filename)
  db.pragma('foreign_keys = ON')
  const rows = db.prepare('SELECT id,raw_text FROM raw_posts').all()
  const explicitAgentRawIds = rows.filter((row) => explicitAgentPostRole(row.raw_text)).map((row) => row.id)
  const explicitAgentPropertyIds = db.prepare("SELECT id FROM properties WHERE lower(coalesce(source_role,'')) IN ('agent','co_agent')").all().map((row) => row.id)
  const counts = { agentRawPosts: explicitAgentRawIds.length, agentProperties: explicitAgentPropertyIds.length }
  if (dryRun) { db.close(); return { dryRun: true, ...counts } }

  const result = db.transaction(() => {
    db.exec('CREATE TEMP TABLE remove_agent_raw(id INTEGER PRIMARY KEY); CREATE TEMP TABLE remove_agent_property(id INTEGER PRIMARY KEY);')
    const addRaw = db.prepare('INSERT OR IGNORE INTO remove_agent_raw(id) VALUES (?)')
    const addProperty = db.prepare('INSERT OR IGNORE INTO remove_agent_property(id) VALUES (?)')
    for (const id of explicitAgentRawIds) addRaw.run(id)
    for (const id of explicitAgentPropertyIds) addProperty.run(id)
    // Any property belonging to an explicitly identified agent post must go,
    // even when an older extractor left source_role empty.
    db.prepare('INSERT OR IGNORE INTO remove_agent_property SELECT id FROM properties WHERE raw_post_id IN (SELECT id FROM remove_agent_raw)').run()

    db.exec(`
      CREATE TEMP TABLE remove_agent_cluster AS
        SELECT DISTINCT cluster_id id FROM listing_cluster_members
        WHERE property_id IN (SELECT id FROM remove_agent_property)
           OR raw_post_id IN (SELECT id FROM remove_agent_raw);
      DELETE FROM cluster_merge_audits WHERE cluster_id IN (SELECT id FROM remove_agent_cluster) OR property_id IN (SELECT id FROM remove_agent_property);
      DELETE FROM listing_cluster_members WHERE cluster_id IN (SELECT id FROM remove_agent_cluster) OR property_id IN (SELECT id FROM remove_agent_property) OR raw_post_id IN (SELECT id FROM remove_agent_raw);
      DELETE FROM listing_clusters WHERE id IN (SELECT id FROM remove_agent_cluster) OR canonical_property_id IN (SELECT id FROM remove_agent_property);
      DELETE FROM duplicate_members WHERE property_id IN (SELECT id FROM remove_agent_property);
      DELETE FROM review_queue WHERE property_id IN (SELECT id FROM remove_agent_property) OR raw_post_id IN (SELECT id FROM remove_agent_raw);
      DELETE FROM field_evidence WHERE property_id IN (SELECT id FROM remove_agent_property);
      DELETE FROM property_transit_stations WHERE property_id IN (SELECT id FROM remove_agent_property);
      DELETE FROM property_repair_state WHERE property_id IN (SELECT id FROM remove_agent_property);
      DELETE FROM audit_events WHERE (entity_type='property' AND CAST(entity_id AS INTEGER) IN (SELECT id FROM remove_agent_property)) OR (entity_type='raw_post' AND CAST(entity_id AS INTEGER) IN (SELECT id FROM remove_agent_raw));
      DELETE FROM properties WHERE id IN (SELECT id FROM remove_agent_property);
      DELETE FROM post_classifications WHERE processing_run_id IN (SELECT id FROM processing_runs WHERE raw_post_id IN (SELECT id FROM remove_agent_raw));
      DELETE FROM processing_runs WHERE raw_post_id IN (SELECT id FROM remove_agent_raw);
      DELETE FROM leads WHERE raw_post_id IN (SELECT id FROM remove_agent_raw);
      DELETE FROM raw_posts WHERE id IN (SELECT id FROM remove_agent_raw);
    `)
    return {
      ...counts,
      removedRawPosts: db.prepare('SELECT COUNT(*) FROM remove_agent_raw').pluck().get(),
      removedProperties: db.prepare('SELECT COUNT(*) FROM remove_agent_property').pluck().get(),
    }
  })()
  const clustersRebuilt = backfillListingClusters(db)
  const integrity = db.pragma('foreign_key_check')
  db.close()
  return { ...result, clustersRebuilt, foreignKeyErrors: integrity.length }
}

if (process.argv[1]?.endsWith('remove-agent-posts.js')) {
  console.log(JSON.stringify(removeAgentPosts({ dryRun: process.argv.includes('--dry-run') }), null, 2))
}
