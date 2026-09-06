import { randomUUID } from 'node:crypto'
import { PIPELINE_VERSION } from '../pipeline/versions.js'
import { TRANSIT_DATA_VERSION } from '../data/transit-reference.js'
import { saveTransitMatches } from '../db/repositories/properties.js'

const REPAIR_FIELDS = ['project_name_raw','project_id','project_name_canonical','project_match_method','project_match_score','rent_price_monthly','sale_price','currency','bedrooms','bathrooms','area_sqm','floor','building','room_type','pet_policy','contact_name','contact_phone','source_role']

export class PropertyRepairJob {
  constructor({ service, extract = null, useAI = () => Boolean(process.env.GEMINI_API_KEY), now = () => new Date().toISOString() }) {
    this.service = service
    this.extract = extract || ((text) => service.extractForRepair(text, { useAI: useAI() }))
    this.now = now
    this.current = null
  }
  status() { return this.current ? structuredClone(this.current) : { status: 'idle' } }
  start({ force = false } = {}) {
    if (this.current?.status === 'running') return this.status()
    this.current = { id: `repair_${Date.now()}_${randomUUID().slice(0, 6)}`, status: 'running', phase: 'กำลังค้นหารายการที่ต้องอัปเดต', found: 0, processed: 0, fieldsUpdated: 0, projectsMatched: 0, stationsMatched: 0, uncertain: 0, errors: 0, startedAt: this.now(), completedAt: null }
    this.#run(force).catch((error) => { this.current = { ...this.current, status: 'failed', phase: 'เกิดข้อผิดพลาด', error: String(error.message || error), completedAt: this.now() } })
    return this.status()
  }
  async #run(force) {
    const db = this.service.db
    const referenceVersion = referenceVersionOf(db)
    const rows = db.prepare(`
      SELECT p.*,r.raw_text,r.content_hash raw_content_hash
      FROM properties p JOIN raw_posts r ON r.id=p.raw_post_id
      LEFT JOIN property_repair_state prs ON prs.property_id=p.id
      WHERE p.deleted_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM audit_events a WHERE a.entity_type='property' AND a.entity_id=CAST(p.id AS TEXT) AND a.actor NOT LIKE 'system%')
        AND (p.project_name_raw IS NULL OR p.project_verified=0 OR p.rent_price_monthly IS NULL OR p.bedrooms IS NULL OR p.area_sqm IS NULL OR p.source_role IS NULL OR p.overall_confidence < 0.75 OR NOT EXISTS (SELECT 1 FROM property_transit_stations pts WHERE pts.property_id=p.id AND pts.match_status='matched'))
        AND (?=1 OR prs.property_id IS NULL OR prs.raw_content_hash<>r.content_hash OR prs.pipeline_version<>? OR prs.reference_version<>?)
      ORDER BY p.id
    `).all(force ? 1 : 0, PIPELINE_VERSION, referenceVersion)
    this.current = { ...this.current, found: rows.length, phase: rows.length ? 'กำลังตรวจและเติมข้อมูล' : 'ข้อมูลเป็นปัจจุบันแล้ว' }
    for (const row of rows) {
      try {
        const output = await this.extract(row.raw_text, row)
        const extracted = output?.result?.properties?.[row.property_index] || output?.result?.properties?.[0]
        const outcome = extracted ? applyRepair(this.service, row, extracted, this.now()) : { fields: 0, project: 0, station: 0 }
        const uncertain = outcome.fields === 0 && outcome.project === 0 && outcome.station === 0 ? 1 : 0
        saveState(db, row.id, row.raw_content_hash, referenceVersion, uncertain ? 'uncertain' : 'updated', outcome, this.now())
        this.current = { ...this.current, processed: this.current.processed + 1, fieldsUpdated: this.current.fieldsUpdated + outcome.fields, projectsMatched: this.current.projectsMatched + outcome.project, stationsMatched: this.current.stationsMatched + outcome.station, uncertain: this.current.uncertain + uncertain }
      } catch (error) {
        saveState(db, row.id, row.raw_content_hash, referenceVersion, 'error', { error: String(error.message || error) }, this.now())
        this.current = { ...this.current, processed: this.current.processed + 1, errors: this.current.errors + 1 }
      }
    }
    this.current = { ...this.current, status: 'completed', phase: 'เสร็จสิ้น', completedAt: this.now() }
  }
}

function applyRepair(service, row, extracted, now) {
  const patch = {}
  const evidence = extracted.evidence || []
  for (const field of REPAIR_FIELDS) {
    if (!canFill(row, field) || extracted[field] == null) continue
    if (['project_id','project_name_canonical'].includes(field) && !extracted.project_verified) continue
    const proof = evidence.find((item) => item.field === field || (['project_id','project_name_canonical'].includes(field) && item.field === 'project_name_raw'))
    if (!proof?.quote || !row.raw_text.includes(proof.quote)) continue
    patch[field] = extracted[field]
  }
  if (patch.project_id) { patch.project_name_raw ||= extracted.project_name_raw; patch.project_match_method = extracted.project_match_method; patch.project_match_score = extracted.project_match_score; patch.project_verified = 1 }
  if (Object.keys(patch).length) service.update(row.id, patch, 'system:ai_repair')
  addEvidence(service.db, row.id, row.raw_text, extracted, Object.keys(patch))
  let station = 0
  const hasStation = service.db.prepare("SELECT 1 FROM property_transit_stations WHERE property_id=? AND match_status='matched'").get(row.id)
  const matches = (extracted.transit_matches || []).filter((item) => item.status === 'matched').slice(0, 1)
  if (!hasStation && matches.length) { saveTransitMatches(service.db, row.id, row.raw_post_id, matches, now); station = 1 }
  return { fields: Object.keys(patch).length, project: !row.project_verified && Boolean(patch.project_id) ? 1 : 0, station }
}
function canFill(row, field) {
  if (['project_name_raw','project_match_method','project_match_score','project_id','project_name_canonical'].includes(field)) return !row.project_verified
  return row[field] == null || row[field] === '' || row[field] === 'unknown'
}
function addEvidence(db, propertyId, rawText, extracted, fields) {
  const insert = db.prepare(`INSERT INTO field_evidence(property_id,field_name,value_json,quote,confidence,validation_status) SELECT ?,?,?,?,?, 'valid' WHERE NOT EXISTS (SELECT 1 FROM field_evidence WHERE property_id=? AND field_name=? AND quote=?)`)
  for (const field of fields) {
    const item = (extracted.evidence || []).find((entry) => entry.field === field || (['project_id','project_name_canonical'].includes(field) && entry.field === 'project_name_raw'))
    if (item?.quote && rawText.includes(item.quote)) insert.run(propertyId, field, JSON.stringify(extracted[field] ?? null), item.quote, item.confidence, propertyId, field, item.quote)
  }
}
function referenceVersionOf(db) { const projects = db.prepare("SELECT COUNT(*) count,COALESCE(MAX(verified_at),'') latest FROM projects WHERE active=1").get(); return `${TRANSIT_DATA_VERSION}:projects-${projects.count}-${projects.latest}` }
function saveState(db, propertyId, hash, referenceVersion, status, result, now) { db.prepare(`INSERT INTO property_repair_state(property_id,raw_content_hash,pipeline_version,reference_version,status,result_json,processed_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(property_id) DO UPDATE SET raw_content_hash=excluded.raw_content_hash,pipeline_version=excluded.pipeline_version,reference_version=excluded.reference_version,status=excluded.status,result_json=excluded.result_json,processed_at=excluded.processed_at`).run(propertyId, hash, PIPELINE_VERSION, referenceVersion, status, JSON.stringify(result), now) }
