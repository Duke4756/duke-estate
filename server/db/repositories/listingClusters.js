import { duplicateSignals } from '../../pipeline/deduplicator.js'
import { INVENTORY_FRESHNESS_POLICY } from '../../config/sourceIntelligence.js'

export function attachPropertyToListingCluster(db, propertyId) {
  const candidate = propertyWithSource(db, propertyId)
  if (!candidate) return null
  const existing = db.prepare(`SELECT p.*,r.source_post_id,r.source_url_normalized,r.raw_text,lcm.cluster_id FROM properties p JOIN raw_posts r ON r.id=p.raw_post_id JOIN listing_cluster_members lcm ON lcm.property_id=p.id WHERE p.id<>? ORDER BY p.updated_at DESC LIMIT 500`).all(propertyId)
  const match = existing.map((property) => ({ property, signal: duplicateSignals(candidate, property) }))
    .filter(({ signal }) => signal.duplicate && hasConservativeEvidence(signal.reasons) && !onlyProjectAndPrice(signal.reasons))
    .sort((a, b) => b.signal.score - a.signal.score)[0]
  const now = new Date().toISOString()
  let clusterId
  let created = false
  if (match) clusterId = match.property.cluster_id
  else {
    const inserted = db.prepare(`INSERT INTO listing_clusters(canonical_property_id,status,freshness_score,confidence,match_method,created_at,updated_at) VALUES (?,'LIKELY_ACTIVE',1,1,'singleton',?,?)`).run(propertyId, now, now)
    clusterId = Number(inserted.lastInsertRowid); created = true
  }
  const reasons = match?.signal.reasons || ['new_listing_instance']
  db.prepare(`INSERT OR IGNORE INTO listing_cluster_members(cluster_id,property_id,raw_post_id,source_group_key,match_score,match_method,evidence_json,price_at_capture,joined_at) VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(clusterId, propertyId, candidate.raw_post_id, candidate.source_group_id || candidate.source_group_name || null, match?.signal.score || 1, match ? 'multi_signal' : 'singleton', JSON.stringify(reasons), candidate.rent_price_monthly ?? candidate.sale_price ?? null, now)
  db.prepare(`INSERT INTO cluster_merge_audits(cluster_id,action,property_id,score,evidence_json,actor,created_at) VALUES (?,?,?,?,?,'system',?)`)
    .run(clusterId, match ? 'ATTACH' : 'CREATE', propertyId, match?.signal.score || 1, JSON.stringify(reasons), now)
  if (match) db.prepare(`UPDATE listing_clusters SET status='ACTIVE',confidence=MAX(confidence,?),updated_at=? WHERE id=?`).run(match.signal.score, now, clusterId)
  return { clusterId, created, matched: Boolean(match), score: match?.signal.score || 1, reasons }
}

export function splitListingCluster(db, propertyId, actor = 'user') {
  const membership = db.prepare('SELECT * FROM listing_cluster_members WHERE property_id=?').get(propertyId)
  if (!membership) return null
  const now = new Date().toISOString()
  return db.transaction(() => {
    const inserted = db.prepare(`INSERT INTO listing_clusters(canonical_property_id,status,freshness_score,confidence,match_method,created_at,updated_at) VALUES (?,'UNKNOWN',0.5,1,'manual_split',?,?)`).run(propertyId, now, now)
    const clusterId = Number(inserted.lastInsertRowid)
    db.prepare(`UPDATE listing_cluster_members SET cluster_id=?,match_score=1,match_method='manual_split',evidence_json='["manual_split"]',joined_at=? WHERE property_id=?`).run(clusterId, now, propertyId)
    db.prepare(`INSERT INTO cluster_merge_audits(cluster_id,action,property_id,score,evidence_json,actor,created_at) VALUES (?,'SPLIT',?,1,'["manual_split"]',?,?)`).run(membership.cluster_id, propertyId, actor, now)
    return { clusterId, previousClusterId: membership.cluster_id }
  })()
}

export function backfillListingClusters(db) {
  const rows = db.prepare(`SELECT p.id property_id,p.raw_post_id,p.rent_price_monthly,p.sale_price,r.source_group_id,r.source_group_name FROM properties p JOIN raw_posts r ON r.id=p.raw_post_id LEFT JOIN listing_cluster_members m ON m.property_id=p.id WHERE m.property_id IS NULL ORDER BY p.id`).all()
  const createCluster = db.prepare(`INSERT INTO listing_clusters(canonical_property_id,status,freshness_score,confidence,match_method,created_at,updated_at) VALUES (?,'UNKNOWN',0.5,1,'legacy_singleton',?,?)`)
  const addMember = db.prepare(`INSERT INTO listing_cluster_members(cluster_id,property_id,raw_post_id,source_group_key,match_score,match_method,evidence_json,price_at_capture,joined_at) VALUES (?,?,?,?,1,'legacy_singleton','["migration"]',?,?)`)
  const audit = db.prepare(`INSERT INTO cluster_merge_audits(cluster_id,action,property_id,score,evidence_json,actor,created_at) VALUES (?,'CREATE',?,1,'["migration"]','system_migration',?)`)
  const now = new Date().toISOString()
  return db.transaction(() => {
    for (const row of rows) {
      const clusterId = Number(createCluster.run(row.property_id, now, now).lastInsertRowid)
      addMember.run(clusterId, row.property_id, row.raw_post_id, row.source_group_id || row.source_group_name || null, row.rent_price_monthly ?? row.sale_price ?? null, now)
      audit.run(clusterId, row.property_id, now)
    }
    return rows.length
  })()
}

export function refreshListingFreshness(db, policy = INVENTORY_FRESHNESS_POLICY, now = Date.now()) {
  const clusters = db.prepare(`SELECT lc.id,MAX(COALESCE(r.source_created_at,r.captured_at,r.collected_at,p.updated_at)) latest_at,MAX(p.transaction_type IN ('sale','wanted_buy')) is_sale FROM listing_clusters lc JOIN listing_cluster_members m ON m.cluster_id=lc.id JOIN properties p ON p.id=m.property_id JOIN raw_posts r ON r.id=m.raw_post_id GROUP BY lc.id`).all()
  const update = db.prepare('UPDATE listing_clusters SET status=?,freshness_score=?,updated_at=? WHERE id=?')
  const timestamp = new Date(now).toISOString()
  return db.transaction(() => {
    for (const cluster of clusters) {
      const days = Math.max(0, (now - Date.parse(cluster.latest_at || timestamp)) / 86_400_000)
      const likely = cluster.is_sale ? policy.saleLikelyActiveDays : policy.rentLikelyActiveDays
      const stale = cluster.is_sale ? policy.saleStaleDays : policy.rentStaleDays
      const status = days <= likely ? 'LIKELY_ACTIVE' : days <= stale ? 'UNKNOWN' : 'STALE'
      update.run(status, Math.max(0, Math.round((1 - days / stale) * 1000) / 1000), timestamp, cluster.id)
    }
    return clusters.length
  })()
}

function propertyWithSource(db, propertyId) { return db.prepare(`SELECT p.*,r.source_post_id,r.source_url_normalized,r.raw_text,r.source_group_id,r.source_group_name FROM properties p JOIN raw_posts r ON r.id=p.raw_post_id WHERE p.id=?`).get(propertyId) }
function onlyProjectAndPrice(reasons) { return reasons.every((reason) => ['project','price'].includes(reason)) }
function hasConservativeEvidence(reasons) { return reasons.some((reason) => ['source_post_id','source_url','content_hash','property_fingerprint'].includes(reason)) }
