import { deterministicExtract } from '../pipeline/deterministicExtractor.js'
import { isSafeProjectBackfill } from '../migrations/backfill-project-names.js'

export function enrichMissingProperties(service) {
  const rows = /** @type {Record<string, any>[]} */ (service.db.prepare(`
    SELECT p.*, r.raw_text
    FROM properties p
    JOIN raw_posts r ON r.id = p.raw_post_id
    WHERE p.deleted_at IS NULL
      AND p.transaction_type IN ('rent', 'rent_and_sale')
      AND (
        p.rent_price_monthly IS NULL
        OR p.project_name_raw IS NULL
        OR p.source_role IS NULL
      )
  `).all())
  const stats = { scanned: rows.length, prices: 0, projects: 0, roles: 0, stations: 0, stationUpdates: 0 }
  const apply = service.db.transaction(() => {
    for (const row of rows) {
      const extracted = deterministicExtract(row.raw_text).properties[0]
      if (!extracted) continue
      const patch = {}
      const evidence = []
      if (row.rent_price_monthly == null && extracted.rent_price_monthly != null) {
        patch.rent_price_monthly = extracted.rent_price_monthly
        patch.currency = extracted.currency || 'THB'
        evidence.push(...extracted.evidence.filter((item) =>
          item.field === 'rent_price_monthly' || item.field === 'currency'))
        stats.prices++
      }
      if (row.project_name_raw == null && isSafeProjectBackfill(row.raw_text, extracted)) {
        patch.project_name_raw = extracted.project_name_raw
        patch.project_id = null
        patch.project_name_canonical = null
        patch.project_match_method = 'unverified'
        patch.project_match_score = 0
        evidence.push(...extracted.evidence.filter((item) => item.field === 'project_name_raw'))
        stats.projects++
      }
      if (row.source_role == null && extracted.source_role) {
        patch.source_role = extracted.source_role
        evidence.push(...extracted.evidence.filter((item) => item.field === 'source_role'))
        stats.roles++
      }
      if (!Object.keys(patch).length) continue
      service.update(row.id, patch, 'user_requested_missing_data_enrichment')
      addEvidence(service, row.id, row.raw_text, extracted, evidence)
    }
  })
  apply()
  stats.stations = service.db.prepare(`
    SELECT COUNT(DISTINCT p.id) count
    FROM properties p
    LEFT JOIN property_transit_stations pts ON pts.property_id=p.id AND pts.match_status='matched'
    WHERE p.deleted_at IS NULL
      AND p.transaction_type IN ('rent', 'rent_and_sale')
      AND pts.station_id IS NOT NULL
  `).get().count
  return stats
}

function addEvidence(service, propertyId, rawText, extracted, evidence) {
  const insert = service.db.prepare(`
    INSERT INTO field_evidence(property_id, field_name, value_json, quote, confidence, validation_status)
    VALUES (?, ?, ?, ?, ?, 'valid')
  `)
  for (const item of evidence) {
    if (!item.quote || !rawText.includes(item.quote)) continue
    insert.run(
      propertyId,
      item.field,
      JSON.stringify(extracted[item.field] ?? null),
      item.quote,
      item.confidence,
    )
  }
}
