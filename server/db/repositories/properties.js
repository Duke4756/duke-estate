import { duplicateSignals } from '../../pipeline/deduplicator.js'
import { isGenericTransitClaim } from '../../services/transitStationMatcher.js'
import { attachPropertyToListingCluster } from './listingClusters.js'

const PROPERTY_COLUMNS = [
  'transaction_type', 'property_type', 'room_type', 'project_name_raw', 'project_id',
  'project_name_canonical', 'project_match_method', 'project_match_score',
  'rent_price_monthly', 'sale_price', 'currency', 'bedrooms', 'bathrooms',
  'area_sqm', 'floor', 'building', 'zone', 'subdistrict', 'district', 'province',
  'nearby_transit', 'transit_distance_m', 'pet_policy', 'furnishing',
  'available_date', 'contact_name', 'contact_phone', 'source_role',
]

export function createPropertyRepository(db) {
  const insertRun = db.prepare(`
    INSERT INTO processing_runs (
      raw_post_id, status, pipeline_version, parser_version, prompt_version,
      model_name, project_dictionary_version, started_at, finished_at,
      duration_ms, cache_hit, raw_ai_response_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const insertClassification = db.prepare(`
    INSERT INTO post_classifications (
      processing_run_id, post_intent, confidence, evidence_json,
      warnings_json, requires_review
    ) VALUES (?, ?, ?, ?, ?, ?)
  `)
  return {
    /** @param {{rawPostId: number, result: any, metadata?: Record<string, any>, replacePending?: boolean}} input */
    saveRun({ rawPostId, result, metadata = {}, replacePending = false }) {
      const now = new Date().toISOString()
      const transaction = db.transaction(() => {
        const sourceUrl = db.prepare('SELECT source_url FROM raw_posts WHERE id=?').get(rawPostId)?.source_url
        if (replacePending) retireUnreviewedProperties(db, rawPostId, now)
        const run = insertRun.run(
          rawPostId, 'completed', metadata.pipelineVersion, metadata.parserVersion,
          metadata.promptVersion || null, metadata.model || null,
          metadata.dictionaryVersion || 'empty-v1', metadata.startedAt || now, now,
          metadata.durationMs || 0, metadata.cacheHit ? 1 : 0,
          metadata.rawAiResponse || null,
        )
        const runId = Number(run.lastInsertRowid)
        // Confidence and warnings remain attached as machine-readable audit
        // signals. They no longer block inventory from being saved: operators
        // can correct exceptional records later and those edits are preserved
        // in audit_events as training feedback.
        const requiresReview = false
        insertClassification.run(
          runId, result.post_intent, result.post_confidence, '[]',
          JSON.stringify(result.warnings), requiresReview ? 1 : 0,
        )
        const propertyIds = []
        for (const [index, property] of result.properties.entries()) {
          if (['agent', 'co_agent'].includes(String(property.source_role || '').toLowerCase())) continue
          const overallConfidence = overallConfidenceOf(property)
          const status = 'confirmed'
          const values = PROPERTY_COLUMNS.map((column) => property[column] ?? null)
          const placeholders = PROPERTY_COLUMNS.map(() => '?').join(', ')
          const inserted = db.prepare(`
            INSERT INTO properties (
              raw_post_id, processing_run_id, property_index, ${PROPERTY_COLUMNS.join(', ')},
              project_verified, overall_confidence, warnings_json, status, created_at, updated_at
            ) VALUES (?, ?, ?, ${placeholders}, ?, ?, ?, ?, ?, ?)
          `).run(
            rawPostId, runId, index, ...values, property.project_id ? 1 : 0,
            overallConfidence, JSON.stringify(property.warnings), status, now, now,
          )
          const propertyId = Number(inserted.lastInsertRowid)
          propertyIds.push(propertyId)
          const addEvidence = db.prepare(`
            INSERT INTO field_evidence (
              property_id, field_name, value_json, quote, confidence, validation_status
            ) VALUES (?, ?, ?, ?, ?, 'valid')
          `)
          for (const item of property.evidence) {
            addEvidence.run(propertyId, item.field, JSON.stringify(property[item.field] ?? null), item.quote, item.confidence)
          }
          saveTransitMatches(db, propertyId, rawPostId, property.transit_matches || [], now)
          const qualityReasons = activeInventoryRejectionReasons(property, sourceUrl)
          if (qualityReasons.length) {
            const before = db.prepare('SELECT * FROM properties WHERE id=?').get(propertyId)
            db.prepare('UPDATE properties SET deleted_at=?,updated_at=? WHERE id=?').run(now, now, propertyId)
            db.prepare(`INSERT INTO audit_events(entity_type,entity_id,action,before_json,after_json,actor,created_at) VALUES ('property',?,'quality_reject',?,?,?,?)`).run(
              String(propertyId), JSON.stringify(before), JSON.stringify({ ...before, deleted_at: now, quality_rejection_reasons: qualityReasons }), 'system:active-inventory-quality-v1', now,
            )
            continue
          }
          attachPropertyToListingCluster(db, propertyId)
          groupPotentialDuplicates(db, propertyId)
        }
        return { runId, propertyIds }
      })
      return transaction()
    },
    query(options = {}) {
      const page = Math.max(1, Number(options.page) || 1)
      const pageSize = Math.min(100, Math.max(10, Number(options.pageSize) || 30))
      const where = [
        'p.deleted_at IS NULL',
        `p.transaction_type IN ('rent', 'sale', 'rent_and_sale', 'wanted_rent', 'wanted_buy')`,
      ]
      if (options.ownerOnly === true || options.ownerOnly === '1') where.push("p.source_role = 'owner'")
      if (options.rentOnly === true || options.rentOnly === '1') where.push("p.transaction_type IN ('rent','rent_and_sale')")
      const params = []
      if (options.search) {
        const search = String(options.search).trim()
        const generalPattern = `%${search}%`
        const stationTerm = search
          .replace(/^\s*(?:BTS|MRT|ARL|Airport\s+Rail\s+Link)\s*[-–—:]?\s*/i, '')
          .trim() || search
        const stationPattern = `%${stationTerm}%`
        where.push(`(p.project_name_canonical LIKE ? OR p.project_name_raw LIKE ? OR p.zone LIKE ? OR p.district LIKE ? OR p.province LIKE ? OR p.contact_phone LIKE ? OR r.raw_text LIKE ? OR EXISTS (
          SELECT 1 FROM property_transit_stations pts
          LEFT JOIN transit_stations ts ON ts.id=pts.station_id
          LEFT JOIN transit_station_aliases tsa ON tsa.station_id=ts.id AND tsa.active=1
          WHERE pts.property_id=p.id AND (
            ts.canonical_name_th LIKE ? OR ts.canonical_name_en LIKE ?
            OR pts.original_mention LIKE ? OR tsa.alias LIKE ?
          )
        ))`)
        params.push(...Array(7).fill(generalPattern), ...Array(4).fill(stationPattern))
      }
      const filters = [
        ['(p.project_name_canonical LIKE ? OR p.project_name_raw LIKE ?)', options.project ? `%${options.project}%` : null],
        ['(p.zone LIKE ? OR p.district LIKE ? OR p.province LIKE ?)', options.location ? `%${options.location}%` : null],
        ['p.transaction_type = ?', options.intent || null],
        ['p.pet_policy = ?', options.pet || null],
        ['p.bedrooms = ?', options.bedrooms || null],
        ['p.bathrooms = ?', options.bathrooms || null],
        ['p.room_type = ?', options.roomType || null],
        ['p.source_role = ?', options.sourceRole || null],
      ]
      for (const [clause, value] of filters) {
        if (value == null || value === '') continue
        where.push(clause)
        params.push(...Array((clause.match(/\?/g) || []).length).fill(value))
      }
      for (const [column, value, op] of [
        ['p.rent_price_monthly', options.minPrice, '>='],
        ['p.rent_price_monthly', options.maxPrice, '<='],
        ['p.area_sqm', options.minArea, '>='],
        ['p.area_sqm', options.maxArea, '<='],
      ]) {
        if (value == null || value === '') continue
        where.push(`${column} ${op} ?`)
        params.push(Number(value))
      }
      if (options.review === '1') where.push(`p.status = 'pending_review'`)
      if (options.system) { where.push('EXISTS (SELECT 1 FROM property_transit_stations pts JOIN transit_stations ts ON ts.id=pts.station_id JOIN transit_systems sys ON sys.id=ts.system_id WHERE pts.property_id=p.id AND pts.match_status=\'matched\' AND sys.code=?)'); params.push(String(options.system).toUpperCase()) }
      if (options.stationId) { where.push('EXISTS (SELECT 1 FROM property_transit_stations pts WHERE pts.property_id=p.id AND pts.match_status=\'matched\' AND pts.station_id=?)'); params.push(options.stationId) }
      if (options.transit) {
        const transitTerm = String(options.transit).replace(/^\s*(?:BTS|MRT|ARL|Airport\s+Rail\s+Link)\s*[-–—:]?\s*/i, '').trim()
        const pattern = `%${transitTerm || options.transit}%`
        where.push(`EXISTS (
          SELECT 1 FROM property_transit_stations pts
          LEFT JOIN transit_stations ts ON ts.id=pts.station_id
          LEFT JOIN transit_station_aliases tsa ON tsa.station_id=ts.id AND tsa.active=1
          WHERE pts.property_id=p.id AND (ts.canonical_name_th LIKE ? OR ts.canonical_name_en LIKE ? OR pts.original_mention LIKE ? OR tsa.alias LIKE ?)
        )`)
        params.push(pattern, pattern, pattern, pattern)
      }
      const sqlWhere = where.join(' AND ')
      const orderBy = {
        price_asc: 'p.rent_price_monthly IS NULL, p.rent_price_monthly ASC, p.updated_at DESC',
        price_desc: 'p.rent_price_monthly IS NULL, p.rent_price_monthly DESC, p.updated_at DESC',
        area_asc: 'p.area_sqm IS NULL, p.area_sqm ASC, p.updated_at DESC',
        area_desc: 'p.area_sqm IS NULL, p.area_sqm DESC, p.updated_at DESC',
        newest: "COALESCE(r.source_created_at,r.captured_at,r.collected_at,p.created_at) DESC, p.id DESC",
      }[options.sort] || "COALESCE(r.source_created_at,r.captured_at,r.collected_at,p.created_at) DESC, p.id DESC"
      const total = db.prepare(`SELECT COUNT(*) count FROM properties p JOIN raw_posts r ON r.id=p.raw_post_id WHERE ${sqlWhere}`).get(...params).count
      const posts = db.prepare(`
        SELECT p.*, r.raw_text, r.source_url permalink,
               COALESCE(r.source_created_at,r.captured_at,r.collected_at,p.created_at) source_posted_at,
               r.source_group_name "group", c.post_intent,
               CASE WHEN p.project_id IS NOT NULL THEN COALESCE(
                 (SELECT pa.alias FROM project_aliases pa WHERE pa.project_id=p.project_id AND pa.verified=1 AND pa.alias NOT GLOB '*[ก-๙]*' AND pa.alias GLOB '*[A-Za-z]*' ORDER BY pa.id LIMIT 1),
                 CASE WHEN pr.canonical_name NOT GLOB '*[ก-๙]*' THEN pr.canonical_name END
               ) END project_name_en,
               CASE WHEN p.project_id IS NOT NULL THEN COALESCE(
                 (SELECT pa.alias FROM project_aliases pa WHERE pa.project_id=p.project_id AND pa.verified=1 AND pa.alias GLOB '*[ก-๙]*' ORDER BY pa.id LIMIT 1),
                 CASE WHEN pr.canonical_name GLOB '*[ก-๙]*' THEN pr.canonical_name END
               ) END project_name_th,
               lc.id listing_cluster_id,lc.status inventory_status,lc.freshness_score,
               (SELECT json_group_array(json_object(
                 'id', pts.id, 'status', pts.match_status, 'stationId', pts.station_id,
                 'canonicalNameTh', ts.canonical_name_th, 'canonicalNameEn', ts.canonical_name_en,
                 'systemCode', sys.code, 'stationCode', (
                   SELECT group_concat(station_code, ',')
                   FROM transit_station_lines
                   WHERE station_id=ts.id
                 ),
                 'relationType', pts.relation_type, 'distanceValue', pts.distance_value,
                 'distanceUnit', pts.distance_unit, 'originalMention', pts.original_mention,
                 'evidenceText', pts.evidence_text, 'confidence', pts.confidence,
                 'matchMethod', pts.match_method, 'isPrimary', pts.is_primary,
                 'candidates', json(pts.candidates_json)
               )) FROM property_transit_stations pts
                 LEFT JOIN transit_stations ts ON ts.id=pts.station_id
                 LEFT JOIN transit_systems sys ON sys.id=ts.system_id
               WHERE pts.property_id=p.id) transit_json,
               (SELECT dm.reasons_json
                FROM duplicate_members dm
                JOIN duplicate_groups dg ON dg.id = dm.duplicate_group_id
                WHERE dm.property_id = p.id AND dg.status = 'open'
                LIMIT 1) duplicate_reasons_json,
               (SELECT json_group_array(json_object(
                 'field', e.field_name, 'quote', e.quote, 'confidence', e.confidence
               )) FROM field_evidence e WHERE e.property_id = p.id) evidence_json
        FROM properties p
        JOIN raw_posts r ON r.id = p.raw_post_id
        JOIN post_classifications c ON c.processing_run_id = p.processing_run_id
        LEFT JOIN projects pr ON pr.id=p.project_id
        LEFT JOIN listing_cluster_members lcm ON lcm.property_id=p.id
        LEFT JOIN listing_clusters lc ON lc.id=lcm.cluster_id
        WHERE ${sqlWhere}
        ORDER BY ${orderBy}
        LIMIT ? OFFSET ?
      `).all(...params, pageSize, (page - 1) * pageSize)
      return {
        posts: posts.map((row) => ({
          ...row,
          evidence: JSON.parse(row.evidence_json || '[]'),
          warnings: JSON.parse(row.warnings_json || '[]'),
          duplicateReasons: row.duplicate_reasons_json ? JSON.parse(row.duplicate_reasons_json) : [],
          transitStations: JSON.parse(row.transit_json || '[]'),
        })),
        total, page, pageSize, pages: Math.max(1, Math.ceil(total / pageSize)),
      }
    },
    update(id, patch, actor = 'user') {
      const allowed = [...PROPERTY_COLUMNS, 'project_verified'].filter((column) => Object.hasOwn(patch, column))
      if (!allowed.length && !Object.hasOwn(patch, 'status')) return null
      const before = db.prepare('SELECT * FROM properties WHERE id = ?').get(id)
      if (!before) return null
      const columns = [...allowed, ...(Object.hasOwn(patch, 'status') ? ['status'] : [])]
      db.prepare(`UPDATE properties SET ${columns.map((column) => `${column} = ?`).join(', ')}, updated_at = ? WHERE id = ?`)
        .run(...columns.map((column) => patch[column]), new Date().toISOString(), id)
      const after = db.prepare('SELECT * FROM properties WHERE id = ?').get(id)
      const event = db.prepare(`
        INSERT INTO audit_events(entity_type, entity_id, action, before_json, after_json, actor, created_at)
        VALUES ('property', ?, 'update', ?, ?, ?, ?)
      `).run(String(id), JSON.stringify(before), JSON.stringify(after), actor, new Date().toISOString())
      return { property: after, auditEventId: Number(event.lastInsertRowid) }
    },
    softDelete(id, actor = 'user') {
      const before = db.prepare('SELECT * FROM properties WHERE id = ?').get(id)
      if (!before) return null
      const now = new Date().toISOString()
      db.prepare('UPDATE properties SET deleted_at = ?, updated_at = ? WHERE id = ?').run(now, now, id)
      const event = db.prepare(`
        INSERT INTO audit_events(entity_type, entity_id, action, before_json, after_json, actor, created_at)
        VALUES ('property', ?, 'delete', ?, ?, ?, ?)
      `).run(String(id), JSON.stringify(before), JSON.stringify({ ...before, deleted_at: now }), actor, now)
      return { auditEventId: Number(event.lastInsertRowid) }
    },
    undo(eventId, actor = 'user') {
      const event = db.prepare('SELECT * FROM audit_events WHERE id = ?').get(eventId)
      if (!event || event.entity_type !== 'property') return null
      const before = JSON.parse(event.before_json)
      const columns = Object.keys(before).filter((column) => column !== 'id')
      db.prepare(`UPDATE properties SET ${columns.map((column) => `${column} = ?`).join(', ')} WHERE id = ?`)
        .run(...columns.map((column) => before[column]), before.id)
      db.prepare(`
        INSERT INTO audit_events(entity_type, entity_id, action, before_json, after_json, actor, created_at, undo_of_event_id)
        VALUES ('property', ?, 'undo', ?, ?, ?, ?, ?)
      `).run(String(before.id), event.after_json, event.before_json, actor, new Date().toISOString(), eventId)
      return db.prepare('SELECT * FROM properties WHERE id = ?').get(before.id)
    },
  }
}

export function activeInventoryRejectionReasons(property = {}, sourceUrl = '') {
  void sourceUrl
  return [
    Number(property.rent_price_monthly) > 0 && Number(property.rent_price_monthly) < 7000 && 'rent_price_below_7000',
    Number(property.sale_price) > 0 && Number(property.sale_price) < 7000 && 'sale_price_below_7000',
  ].filter(Boolean)
}

function retireUnreviewedProperties(db, rawPostId, now) {
  const protectedCount = db.prepare(`
    SELECT COUNT(*) count FROM properties p
    WHERE p.raw_post_id = ? AND p.deleted_at IS NULL
      AND EXISTS (
        SELECT 1 FROM audit_events a
        WHERE a.entity_type = 'property' AND a.entity_id = CAST(p.id AS TEXT)
          AND a.actor <> 'system'
      )
  `).get(rawPostId).count
  if (protectedCount) return
  db.prepare(`
    UPDATE review_queue SET status = 'superseded', resolved_at = ?
    WHERE raw_post_id = ? AND status = 'open'
  `).run(now, rawPostId)
  db.prepare(`
    UPDATE properties SET deleted_at = ?, updated_at = ?
    WHERE raw_post_id = ? AND deleted_at IS NULL
  `).run(now, now, rawPostId)
}

function overallConfidenceOf(property) {
  const values = Object.values(property.field_confidence || {})
  return values.length ? Math.min(...values) : 0.5
}

export function saveTransitMatches(db, propertyId, rawPostId, matches, now) {
  void rawPostId
  const insert = db.prepare(`
    INSERT INTO property_transit_stations (
      property_id, station_id, relation_type, distance_value, distance_unit,
      original_mention, normalized_mention, evidence_text, confidence,
      match_method, match_status, candidates_json, is_primary, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(property_id, original_mention, evidence_text) DO UPDATE SET
      station_id=excluded.station_id, relation_type=excluded.relation_type,
      distance_value=excluded.distance_value, distance_unit=excluded.distance_unit,
      confidence=excluded.confidence, match_method=excluded.match_method,
      match_status=excluded.match_status, candidates_json=excluded.candidates_json,
      is_primary=excluded.is_primary, updated_at=excluded.updated_at
  `)
  let primaryAssigned = false
  for (const match of matches) {
    const isPrimary = !primaryAssigned && match.status === 'matched'
    if (isPrimary) primaryAssigned = true
    insert.run(
      propertyId, match.status === 'matched' ? match.stationId : null,
      match.relationType || 'mentioned', match.distanceValue ?? null,
      match.distanceUnit || null, match.originalMention, match.normalizedMention,
      match.evidenceText, match.confidence || 0, match.matchMethod || 'none',
      match.status, JSON.stringify(match.candidates || []), isPrimary ? 1 : 0, now, now,
    )
  }
  const unresolved = matches.some((match) => match.status !== 'matched' && !isGenericTransitClaim(match.originalMention))
  if (!unresolved && matches.some((match) => match.status === 'matched')) {
    db.prepare(`UPDATE review_queue SET status='resolved', resolved_at=? WHERE property_id=? AND status='open' AND reason_code IN ('TRANSIT_STATION_NOT_FOUND','TRANSIT_STATION_AMBIGUOUS')`).run(now, propertyId)
  }
}

function groupPotentialDuplicates(db, propertyId) {
  const candidate = db.prepare(`
    SELECT p.*, r.source_post_id, r.source_url_normalized, r.raw_text
    FROM properties p JOIN raw_posts r ON r.id = p.raw_post_id WHERE p.id = ?
  `).get(propertyId)
  const existing = db.prepare(`
    SELECT p.*, r.source_post_id, r.source_url_normalized, r.raw_text
    FROM properties p JOIN raw_posts r ON r.id = p.raw_post_id
    WHERE p.id <> ? AND p.deleted_at IS NULL
      AND (p.raw_post_id <> ? OR p.property_index = ?)
  `).all(propertyId, candidate.raw_post_id, candidate.property_index)
  const match = existing
    .map((property) => ({ property, signal: duplicateSignals(candidate, property) }))
    .filter((item) => item.signal.duplicate)
    .sort((a, b) => b.signal.score - a.signal.score)[0]
  if (!match) return
  const now = new Date().toISOString()
  const group = db.prepare(`INSERT INTO duplicate_groups(status, created_at) VALUES ('open', ?)`).run(now)
  const groupId = Number(group.lastInsertRowid)
  const insert = db.prepare(`
    INSERT INTO duplicate_members(duplicate_group_id, property_id, match_method, match_score, reasons_json)
    VALUES (?, ?, 'multi_signal', ?, ?)
  `)
  insert.run(groupId, propertyId, match.signal.score, JSON.stringify(match.signal.reasons))
  insert.run(groupId, match.property.id, match.signal.score, JSON.stringify(match.signal.reasons))
  const keeper = preferredProperty(candidate, match.property)
  const duplicate = keeper.id === candidate.id ? match.property : candidate
  softDeleteDuplicate(db, duplicate.id, keeper.id, match.signal.reasons, now)
  db.prepare(`UPDATE duplicate_groups SET status = 'resolved', resolved_at = ? WHERE id = ?`).run(now, groupId)
}

function preferredProperty(first, second) {
  const quality = (property) => {
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
  const firstScore = quality(first)
  const secondScore = quality(second)
  if (firstScore !== secondScore) return firstScore > secondScore ? first : second
  return Number(first.id) < Number(second.id) ? first : second
}

function softDeleteDuplicate(db, duplicateId, keeperId, reasons, now) {
  const before = db.prepare('SELECT * FROM properties WHERE id = ? AND deleted_at IS NULL').get(duplicateId)
  if (!before) return
  db.prepare('UPDATE properties SET deleted_at = ?, updated_at = ? WHERE id = ?').run(now, now, duplicateId)
  db.prepare(`
    UPDATE review_queue SET status = 'resolved', resolved_at = ?
    WHERE property_id = ? AND status = 'open'
  `).run(now, duplicateId)
  db.prepare(`
    INSERT INTO audit_events(entity_type, entity_id, action, before_json, after_json, actor, created_at)
    VALUES ('property', ?, 'auto_deduplicate', ?, ?, 'system', ?)
  `).run(
    String(duplicateId),
    JSON.stringify(before),
    JSON.stringify({ ...before, deleted_at: now, duplicate_of: keeperId, duplicate_reasons: reasons }),
    now,
  )
}
