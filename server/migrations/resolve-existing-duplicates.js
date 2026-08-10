import { pathToFileURL } from 'node:url'
import { openDatabase } from '../db/index.js'

export function resolveExistingDuplicates(db = openDatabase()) {
  const ownsDatabase = arguments.length === 0
  const rows = /** @type {Record<string, any>[]} */ (db.prepare(`
    SELECT dm.duplicate_group_id group_id, dm.property_id, p.deleted_at,
           p.raw_post_id, p.property_index,
           p.project_id, p.project_name_raw, p.rent_price_monthly, p.sale_price,
           p.area_sqm, p.bedrooms, p.floor, p.contact_phone,
           p.project_verified, p.overall_confidence, dm.reasons_json
    FROM duplicate_members dm
    JOIN properties p ON p.id = dm.property_id
    ORDER BY dm.duplicate_group_id, dm.property_id
  `).all())
  /** @type {Map<number, Record<string, any>[]>} */
  const groups = new Map()
  for (const row of rows) {
    const members = groups.get(row.group_id) || []
    members.push(row)
    groups.set(row.group_id, members)
  }
  let removed = 0
  const now = new Date().toISOString()
  const transaction = db.transaction(() => {
    for (const [groupId, members] of groups) {
      const active = members.filter((member) => !member.deleted_at)
      const isDistinctPropertyInSamePost = active.length > 1
        && active.every((member) => member.raw_post_id === active[0].raw_post_id)
        && new Set(active.map((member) => member.property_index)).size === active.length
      if (isDistinctPropertyInSamePost) {
        db.prepare(`UPDATE duplicate_groups SET status = 'dismissed', resolved_at = ? WHERE id = ?`).run(now, groupId)
        continue
      }
      if (active.length < 2) {
        db.prepare(`UPDATE duplicate_groups SET status = 'resolved', resolved_at = COALESCE(resolved_at, ?) WHERE id = ?`)
          .run(now, groupId)
        continue
      }
      const keeper = [...active].sort((a, b) => quality(b) - quality(a) || a.property_id - b.property_id)[0]
      for (const duplicate of active) {
        if (duplicate.property_id === keeper.property_id) continue
        const before = /** @type {Record<string, any>} */ (
          db.prepare('SELECT * FROM properties WHERE id = ?').get(duplicate.property_id)
        )
        db.prepare('UPDATE properties SET deleted_at = ?, updated_at = ? WHERE id = ?')
          .run(now, now, duplicate.property_id)
        db.prepare(`UPDATE review_queue SET status = 'resolved', resolved_at = ? WHERE property_id = ? AND status = 'open'`)
          .run(now, duplicate.property_id)
        db.prepare(`
          INSERT INTO audit_events(entity_type, entity_id, action, before_json, after_json, actor, created_at)
          VALUES ('property', ?, 'auto_deduplicate', ?, ?, 'system', ?)
        `).run(
          String(duplicate.property_id),
          JSON.stringify(before),
          JSON.stringify({
            ...before,
            deleted_at: now,
            duplicate_of: keeper.property_id,
            duplicate_reasons: JSON.parse(duplicate.reasons_json || '[]'),
          }),
          now,
        )
        removed++
      }
      db.prepare(`UPDATE duplicate_groups SET status = 'resolved', resolved_at = ? WHERE id = ?`).run(now, groupId)
    }
  })
  transaction()
  if (ownsDatabase) db.close()
  return { groups: groups.size, removed }
}

function quality(property) {
  const populated = [
    property.project_id || property.project_name_raw,
    property.rent_price_monthly ?? property.sale_price,
    property.area_sqm,
    property.bedrooms,
    property.floor,
    property.contact_phone,
  ].filter((value) => value !== null && value !== undefined && value !== '').length
  return populated * 10 + Number(property.project_verified || 0) * 5 + Number(property.overall_confidence || 0)
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify(resolveExistingDuplicates(), null, 2))
}
