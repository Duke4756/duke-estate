import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { openDatabase } from '../db/index.js'
import { saveTransitMatches } from '../db/repositories/properties.js'
import { TransitStationMatcher } from '../services/transitStationMatcher.js'

export function backfillTransitStations({ db = openDatabase(), actor = 'transit-backfill-v1' } = {}) {
  const matcher = new TransitStationMatcher(db)
  /** @type {Array<{property_id:number, raw_post_id:number, legacy_transit:string|null, raw_text:string}>} */
  const rows = /** @type {any} */ (db.prepare(`SELECT p.id property_id, p.raw_post_id, p.nearby_transit legacy_transit, r.raw_text FROM properties p JOIN raw_posts r ON r.id=p.raw_post_id WHERE p.deleted_at IS NULL`).all())
  const stats = { scanned: rows.length, matched: 0, ambiguous: 0, notFound: 0, noEvidence: 0, reviewItems: 0 }
  const reviewCountBefore = /** @type {any} */ (db.prepare(`SELECT COUNT(*) count FROM review_queue WHERE reason_code LIKE 'TRANSIT_%'`).get()).count
  const addReview = (row, reason) => {
    const now = new Date().toISOString()
    const result = db.prepare(`INSERT INTO review_queue(raw_post_id, property_id, reason_code, priority, created_at) SELECT ?, ?, ?, 80, ? WHERE NOT EXISTS (SELECT 1 FROM review_queue WHERE raw_post_id=? AND property_id=? AND reason_code=? AND status='open')`).run(row.raw_post_id, row.property_id, reason, now, row.raw_post_id, row.property_id, reason)
    stats.reviewItems += result.changes
  }
  const run = db.transaction(() => {
    for (const row of rows) {
      let matches = matcher.extract(row.raw_text)
      if (!matches.length && row.legacy_transit) {
        if (!row.raw_text.includes(row.legacy_transit)) {
          stats.noEvidence++; addReview(row, 'TRANSIT_STATION_NO_EVIDENCE')
        } else matches = [matcher.match(row.legacy_transit, { evidenceText: row.legacy_transit, rawText: row.raw_text })]
      }
      if (!matches.length) continue
      const now = new Date().toISOString()
      saveTransitMatches(db, row.property_id, row.raw_post_id, matches, now)
      for (const item of matches) {
        if (item.status === 'matched') stats.matched++
        else if (item.status === 'ambiguous') stats.ambiguous++
        else stats.notFound++
      }
      const before = { nearby_transit: row.legacy_transit }
      const after = { transitMatches: matches.map(({ evidenceText: _evidence, ...item }) => item) }
      db.prepare(`INSERT INTO audit_events(entity_type, entity_id, action, before_json, after_json, actor, created_at) SELECT 'property', ?, 'transit_backfill', ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM audit_events WHERE entity_type='property' AND entity_id=? AND action='transit_backfill' AND actor=?)`).run(String(row.property_id), JSON.stringify(before), JSON.stringify(after), actor, now, String(row.property_id), actor)
    }
  })
  run()
  const reviewCountAfter = /** @type {any} */ (db.prepare(`SELECT COUNT(*) count FROM review_queue WHERE reason_code LIKE 'TRANSIT_%'`).get()).count
  stats.reviewItems = Math.max(0, reviewCountAfter - reviewCountBefore)
  return stats
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const db = openDatabase()
  try { console.log(JSON.stringify(backfillTransitStations({ db }), null, 2)) }
  finally { db.close() }
}
