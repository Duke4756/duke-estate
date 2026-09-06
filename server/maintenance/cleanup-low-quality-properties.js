import { openDatabase } from '../db/index.js'

const apply = process.argv.includes('--apply')
const db = openDatabase()
const candidates = db.prepare(`
  SELECT p.*, r.source_url
  FROM properties p
  JOIN raw_posts r ON r.id=p.raw_post_id
  WHERE p.deleted_at IS NULL AND (
    r.source_url IS NULL OR TRIM(r.source_url)=''
    OR (p.rent_price_monthly > 0 AND p.rent_price_monthly < 7000)
    OR (p.sale_price > 0 AND p.sale_price < 7000)
  )
`).all()

const reasons = (row) => [
  !String(row.source_url || '').trim() && 'missing_source_permalink',
  row.rent_price_monthly > 0 && row.rent_price_monthly < 7000 && 'rent_price_below_7000',
  row.sale_price > 0 && row.sale_price < 7000 && 'sale_price_below_7000',
].filter(Boolean)

let removed = 0
if (apply) {
  const now = new Date().toISOString()
  const transaction = db.transaction(() => {
    for (const row of candidates) {
      const rowReasons = reasons(row)
      db.prepare('UPDATE properties SET deleted_at=?, updated_at=? WHERE id=? AND deleted_at IS NULL').run(now, now, row.id)
      db.prepare(`
        INSERT INTO audit_events(entity_type,entity_id,action,before_json,after_json,actor,created_at)
        VALUES ('property',?,'quality_cleanup',?,?,?,?)
      `).run(
        String(row.id), JSON.stringify(row),
        JSON.stringify({ ...row, deleted_at: now, quality_cleanup_reasons: rowReasons }),
        'system:quality-cleanup-v1', now,
      )
      removed += 1
    }
  })
  transaction()
}

console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', found: candidates.length, removed, examples: candidates.slice(0, 10).map((row) => ({ id: row.id, project: row.project_name_canonical || row.project_name_raw, rent: row.rent_price_monthly, sale: row.sale_price, sourceUrl: row.source_url, reasons: reasons(row) })) }, null, 2))
db.close()
