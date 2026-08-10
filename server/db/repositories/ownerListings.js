// @ts-nocheck -- runtime payloads are validated by ownerListingExtractionSchema.
import { contentHash } from '../../pipeline/hash.js'
import { validateOwnerListingExtraction } from '../../pipeline/ownerListingSchema.js'
import { normalizeSourceUrl } from './rawPosts.js'
import { TransitStationMatcher } from '../../services/transitStationMatcher.js'
import { saveTransitMatches } from './properties.js'

export function createOwnerListingRepository(db, { afterRawInsert = null } = {}) {
  const transitMatcher = new TransitStationMatcher(db)
  const commitTransaction = db.transaction((draft, reviewed, actor) => {
    validateOwnerListingExtraction(draft.source.text, reviewed)
    if (!reviewed.listing) throw repositoryError('VALIDATION_FAILED', 'reviewed result has no single listing')
    const source = draft.source
    const hash = contentHash(source.text)
    const normalizedUrl = normalizeSourceUrl(source.url)
    const existing = db.prepare(`
      SELECT * FROM raw_posts
      WHERE (source_adapter = 'facebook_group' AND source_post_id = ?)
         OR (? IS NOT NULL AND source_url_normalized = ?)
         OR content_hash = ?
      ORDER BY id LIMIT 1
    `).get(source.postId || null, normalizedUrl, normalizedUrl, hash)
    if (existing) {
      db.prepare('UPDATE raw_posts SET collected_at = ? WHERE id = ?').run(source.capturedAt, existing.id)
      const property = db.prepare('SELECT id FROM properties WHERE raw_post_id = ? AND deleted_at IS NULL ORDER BY id LIMIT 1').get(existing.id)
      return { duplicate: true, rawPostId: existing.id, propertyId: property?.id || null, lastSeenAt: source.capturedAt }
    }
    const raw = db.prepare(`
      INSERT INTO raw_posts (
        source_adapter, source_post_id, source_url, source_url_normalized,
        source_group_name, raw_text, content_hash, source_created_at, collected_at,
        collector_version, collection_warnings_json
      ) VALUES ('facebook_group', ?, ?, ?, ?, ?, ?, ?, ?, 'owner-listing-review-v1', '[]')
    `).run(source.postId || null, source.url, normalizedUrl, source.group, source.text, hash, source.postedAt, source.capturedAt)
    const rawPostId = Number(raw.lastInsertRowid)
    afterRawInsert?.({ db, rawPostId, draft, reviewed })

    const possibleDuplicate = findPossibleDuplicate(db, reviewed.listing)
    if (possibleDuplicate) throw repositoryError('POSSIBLE_DUPLICATE', `possible duplicate property ${possibleDuplicate.id}`, { propertyId: possibleDuplicate.id })

    const now = new Date().toISOString()
    const run = db.prepare(`
      INSERT INTO processing_runs (
        raw_post_id, status, pipeline_version, parser_version, prompt_version,
        model_name, project_dictionary_version, started_at, finished_at,
        duration_ms, cache_hit, raw_ai_response_json
      ) VALUES (?, 'completed', 'owner-review-v1', 'owner-review-v1',
        'owner-listing-v1', ?, 'reviewed-v1', ?, ?, 0, ?, ?)
    `).run(rawPostId, draft.model || null, draft.createdAt || now, now, draft.cacheHit ? 1 : 0, draft.rawAiResponse || null)
    const runId = Number(run.lastInsertRowid)
    db.prepare(`
      INSERT INTO post_classifications (
        processing_run_id, post_intent, confidence, evidence_json, warnings_json, requires_review
      ) VALUES (?, ?, ?, ?, ?, 0)
    `).run(runId, reviewed.post_type.value, reviewed.post_type.confidence, JSON.stringify(reviewed.post_type.evidence), JSON.stringify(reviewed.warnings || []))

    const l = reviewed.listing
    const transactionType = ['owner_sale'].includes(reviewed.post_type.value) ? 'sale' : 'rent'
    const petPolicy = mapPetStatus(l.pet_status.value)
    const status = 'confirmed'
    const property = db.prepare(`
      INSERT INTO properties (
        raw_post_id, processing_run_id, property_index, transaction_type,
        property_type, room_type, project_name_raw, project_match_method,
        project_match_score, project_verified, rent_price_monthly, sale_price,
        currency, bedrooms, bathrooms, area_sqm, nearby_transit, pet_policy,
        contact_name, contact_phone, source_role, overall_confidence,
        warnings_json, status, created_at, updated_at
      ) VALUES (?, ?, 0, ?, ?, ?, ?, 'unverified', 0, 0, ?, ?, 'THB', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      rawPostId, runId, transactionType, unknownToNull(l.property_type.value), roomType(l),
      l.project_name_raw.value, l.rent_price_monthly.value, l.sale_price.value,
      l.bedroom_count.value, l.bathroom_count.value, l.area_sqm.value,
      null, petPolicy, l.contact_name.value, l.contact_phone.value,
      sourceRole(reviewed.post_type.value), minimumConfidence(reviewed),
      JSON.stringify(reviewed.warnings || []), status, now, now,
    )
    const propertyId = Number(property.lastInsertRowid)
    saveTransitMatches(db, propertyId, rawPostId, transitMatcher.extract(source.text), now)
    const insertEvidence = db.prepare(`
      INSERT INTO field_evidence(property_id, field_name, value_json, quote, confidence, validation_status, warning)
      VALUES (?, ?, ?, ?, ?, 'valid', ?)
    `)
    for (const [fieldName, item] of Object.entries(l)) {
      for (const quote of item.evidence || []) insertEvidence.run(propertyId, fieldName, JSON.stringify(item.value), quote, item.confidence, item.conflict)
    }
    for (const quote of reviewed.post_type.evidence) insertEvidence.run(propertyId, 'post_type', JSON.stringify(reviewed.post_type.value), quote, reviewed.post_type.confidence, reviewed.post_type.conflict)
    db.prepare(`
      INSERT INTO audit_events(entity_type, entity_id, action, before_json, after_json, actor, created_at)
      VALUES ('property', ?, 'owner_listing_confirm', ?, ?, ?, ?)
    `).run(String(propertyId), JSON.stringify(draft.extraction), JSON.stringify({ reviewed, propertyId, reviewLog: draft.reviewLog || [] }), actor, now)
    return { duplicate: false, rawPostId, runId, propertyId }
  })

  return {
    confirmAndSave(draft, reviewed = draft.reviewed, actor = 'user') {
      try { return commitTransaction(draft, reviewed, actor) }
      catch (error) {
        if (error.code) throw error
        throw repositoryError('TRANSACTION_FAILED', error.message)
      }
    },
  }
}

function findPossibleDuplicate(db, listing) {
  const project = listing.project_name_raw.value
  const phone = listing.contact_phone.value
  if (!project && !phone) return null
  return db.prepare(`
    SELECT id FROM properties
    WHERE deleted_at IS NULL
      AND ((? IS NOT NULL AND project_name_raw = ? COLLATE NOCASE AND rent_price_monthly IS ?)
        OR (? IS NOT NULL AND contact_phone = ?))
    LIMIT 1
  `).get(project, project, listing.rent_price_monthly.value, phone, phone)
}

function roomType(listing) {
  if (listing.room_variant.value === 'studio') return 'studio'
  if (listing.layout_type.value !== 'unknown') return listing.layout_type.value
  return unknownToNull(listing.room_variant.value)
}
function sourceRole(type) { return type.startsWith('owner_') ? 'owner' : type.includes('agent') ? 'agent' : null }
function mapPetStatus(value) {
  if (value === 'allowed') return 'allowed'
  if (value === 'not_allowed') return 'not_allowed'
  if (['case_by_case', 'owner_allowed_building_unknown', 'needs_verification'].includes(value)) return 'conditional'
  return null
}
function unknownToNull(value) { return value === 'unknown' ? null : value }
function minimumConfidence(reviewed) {
  return Math.min(reviewed.post_type.confidence, ...Object.values(reviewed.listing).map((item) => item.confidence))
}
function repositoryError(code, message, details) { const error = new Error(message); error.code = code; error.details = details; return error }
