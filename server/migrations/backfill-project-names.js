import { pathToFileURL } from 'node:url'
import { createPropertyDataService } from '../db/service.js'
import { deterministicExtract } from '../pipeline/deterministicExtractor.js'

const GENERIC_NAME = /^(?:คอนโด|condo|house|home|apartment|for\s+rent|pet[- ]?friendly\s+condo|corner\s+unit|duplex|loft|penthouse|studio|ดู(?:เพิ่มเติม|น้อยลง))$/iu
const PROJECT_SIGNAL = /\b(?:condo|apartment|residence|tower|place|park|parc|maestro|ideo|metris|life|origin|aspire|noble|scope|metropole|villa)\b|คอนโด|โครงการ|หมู่บ้าน|เรสซิเดนซ์/iu

export function isSuspiciousStoredProject(value) {
  if (!value) return true
  const name = String(value).trim()
  return GENERIC_NAME.test(name)
    || /#|ดู(?:เพิ่มเติม|น้อยลง)|(?:ราคา|ค่าเช่า|rent)\s*[:：]?\s*\d|(?:ชั้น|floor)\s*\d|property\s+details/iu.test(name)
    || /^ดู(?:เพิ่มเติม|น้อยลง)$/u.test(name)
    || /^(?:on the|ready to|available|ขาย\s*\/\s*ให้เช่า)/iu.test(name)
    || /(?:เสนอลูกค้า|ขอรายละเอียด|เครื่องปรับอากาศ|แอร์\s*\d|7-eleven|เซเว่น)/iu.test(name)
    || /^(?:สถานที่ใกล้|สถานที่สำคัญ|สิ่งอำนวยความสะดวก|จุดเด่น)/u.test(name)
    || /#\p{L}/u.test(name)
    || isRepeatedProjectName(name)
    || name.length > 90
}

function isRepeatedProjectName(value) {
  const words = String(value).trim().split(/\s+/)
  if (words.length < 4 || words.length % 2 !== 0) return false
  const middle = words.length / 2
  return words.slice(0, middle).join(' ').toLocaleLowerCase() === words.slice(middle).join(' ').toLocaleLowerCase()
}

export function isSafeProjectBackfill(rawText, property) {
  const name = String(property?.project_name_raw || '').trim()
  if (!name || name.length < 3 || name.length > 80 || GENERIC_NAME.test(name)) return false
  if (/ราคา|ค่าเช่า|\d[\d,.]*\s*(?:บาท|thb|sqm|ตร\.?\s*ม)|#|ดู(?:เพิ่มเติม|น้อยลง)/iu.test(name)) return false
  if (/^\(?owner|^agent|^new(?:ly)?|^spacious|^cat[- ]?friendly|^home\s+for|^house\s+for|^บ้านทาวน์โฮม|^บ้านเดี่ยว(?:หลัง|ใน)|^โฮมออฟฟิศ|^condo\s+details?$/iu.test(name)) return false
  if (/^(?:boutique\s+residence|detached\s+house\s+at)\b/iu.test(name)) return false
  const quote = property.evidence?.find((item) => item.field === 'project_name_raw')?.quote
  if (!quote || !String(rawText).includes(quote)) return false
  const start = String(rawText).indexOf(quote)
  const before = String(rawText).slice(Math.max(0, start - 100), start)
  return PROJECT_SIGNAL.test(name)
    || /(?:for\s+rent|ให้เช่า|ปล่อยเช่า)\s*[|:：–—\n-]*\s*$/iu.test(before)
    || /(?:for\s+rent|ให้เช่า|ปล่อยเช่า|โครงการ|หมู่บ้าน|pet[- ]?friendly)[^\n]{0,90}$/iu.test(before)
}

export function backfillProjectNames({ service = createPropertyDataService(), dryRun = false } = {}) {
  const ownsService = !arguments[0]?.service
  const rows = /** @type {{id: number, project_name_raw: string | null, raw_text: string}[]} */ (service.db.prepare(`
    SELECT p.id, p.project_name_raw, r.raw_text
    FROM properties p
    JOIN raw_posts r ON r.id = p.raw_post_id
    WHERE p.deleted_at IS NULL
      AND p.transaction_type IN ('rent', 'rent_and_sale')
  `).all())
  const changes = []
  const apply = service.db.transaction(() => {
    for (const row of rows) {
      if (!isSuspiciousStoredProject(row.project_name_raw)) continue
      const property = deterministicExtract(row.raw_text).properties[0]
      if (!isSafeProjectBackfill(row.raw_text, property)) continue
      if (property.project_name_raw === row.project_name_raw) continue
      changes.push({ id: row.id, before: row.project_name_raw, after: property.project_name_raw })
      if (dryRun) continue
      service.update(row.id, {
        project_name_raw: property.project_name_raw,
        project_id: null,
        project_name_canonical: null,
        project_match_method: 'unverified',
        project_match_score: 0,
      }, 'system_project_name_backfill_v6')
      const item = property.evidence.find((entry) => entry.field === 'project_name_raw')
      if (!item) throw new Error(`Project evidence missing for property ${row.id}`)
      service.db.prepare(`
        INSERT INTO field_evidence(property_id, field_name, value_json, quote, confidence, validation_status)
        VALUES (?, 'project_name_raw', ?, ?, ?, 'valid')
      `).run(row.id, JSON.stringify(property.project_name_raw), item.quote, item.confidence)
    }
  })
  apply()
  if (ownsService) service.close()
  return { scanned: rows.length, updated: changes.length, changes }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dryRun = process.argv.includes('--dry-run')
  console.log(JSON.stringify(backfillProjectNames({ dryRun }), null, 2))
}
