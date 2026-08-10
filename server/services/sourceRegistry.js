import { SOURCE_TAXONOMY } from '../config/sourceIntelligence.js'

export function canonicalFacebookGroup(value = '') {
  const raw = String(value || '').trim()
  const match = raw.match(/(?:https?:\/\/)?(?:www\.|web\.|m\.)?facebook\.com\/groups\/([^/?#]+)/i)
  if (!match) return null
  const identity = decodeURIComponent(match[1]).trim().toLowerCase()
  if (!identity) return null
  return { identity, sourceGroupId: /^\d+$/.test(identity) ? identity : null, canonicalUrl: `https://www.facebook.com/groups/${identity}` }
}

export function normalizeGroupName(value = '') { return String(value || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ').trim() }

export function classifyGroupCandidate(input, taxonomy = SOURCE_TAXONOMY) {
  const text = [input.name,input.description,input.evidenceText].filter(Boolean).join(' ').normalize('NFKC').toLowerCase()
  const tags = {}
  let hits = 0
  for (const [axis, keywords] of Object.entries(taxonomy)) {
    const matched = keywords.filter((keyword) => text.includes(String(keyword).toLowerCase()))
    if (matched.length) { tags[axis] = matched; hits += matched.length }
  }
  const relevance = Math.min(1, hits / 4)
  return { relevance, decision: relevance >= 0.5 ? 'relevant' : relevance === 0 ? 'uncertain' : 'possibly_relevant', tags, evidence: Object.values(tags).flat() }
}

export function createSourceRegistry(db) {
  const byIdentity = db.prepare('SELECT * FROM source_groups WHERE platform=\'facebook\' AND source_group_id=?')
  const byUrl = db.prepare('SELECT * FROM source_groups WHERE platform=\'facebook\' AND canonical_url=?')
  const byName = db.prepare("SELECT * FROM source_groups WHERE platform='facebook' AND group_name_normalized<>'' AND group_name_normalized=? LIMIT 1")
  return {
    addCandidate(input) {
      const normalized = canonicalFacebookGroup(input.url)
      if (!normalized) throw new Error('Facebook group URL ไม่ถูกต้อง')
      const nameNormalized = normalizeGroupName(input.name)
      const classification = classifyGroupCandidate(input)
      const now = new Date().toISOString()
      const existing = (normalized.sourceGroupId && byIdentity.get(normalized.sourceGroupId)) || byUrl.get(normalized.canonicalUrl) || (nameNormalized && byName.get(nameNormalized))
      let id
      if (existing) {
        id = existing.id
        db.prepare(`UPDATE source_groups SET source_group_id=COALESCE(source_group_id,?),canonical_url=?,group_name=COALESCE(NULLIF(?,''),group_name),group_name_normalized=COALESCE(NULLIF(?,''),group_name_normalized),privacy_type=COALESCE(NULLIF(?,''),privacy_type),visibility_type=COALESCE(NULLIF(?,''),visibility_type),relevance_score=MAX(relevance_score,?),metadata_json=?,tags_json=?,updated_at=? WHERE id=?`).run(normalized.sourceGroupId, normalized.canonicalUrl, input.name || '', nameNormalized, input.privacyType || '', input.visibilityType || '', classification.relevance, JSON.stringify(input.metadata || {}), JSON.stringify(classification.tags), now, id)
      } else {
        const inserted = db.prepare(`INSERT INTO source_groups(platform,source_group_id,canonical_url,group_name,group_name_normalized,privacy_type,visibility_type,access_status,authorization_status,discovered_via,discovered_at,relevance_score,status,metadata_json,tags_json,created_at,updated_at) VALUES ('facebook',?,?,?,?,?,?,?,'DISCOVERED',?,?,?,'DISCOVERED',?,?,?,?)`).run(normalized.sourceGroupId, normalized.canonicalUrl, input.name || null, nameNormalized || null, input.privacyType || 'UNKNOWN', input.visibilityType || 'UNKNOWN', input.accessStatus || 'UNKNOWN', input.discoveredVia || 'manual', now, classification.relevance, JSON.stringify(input.metadata || {}), JSON.stringify(classification.tags), now, now)
        id = Number(inserted.lastInsertRowid)
        db.prepare('INSERT INTO source_metrics(source_group_id,updated_at) VALUES (?,?)').run(id, now)
      }
      const eventSource = input.discoveredVia || 'manual'
      const eventUrl = input.evidenceUrl || normalized.canonicalUrl
      const repeated = db.prepare('SELECT 1 FROM group_discovery_events WHERE source_group_id=? AND discovered_via=? AND evidence_url=? LIMIT 1').get(id, eventSource, eventUrl)
      if (!repeated) db.prepare(`INSERT INTO group_discovery_events(source_group_id,discovered_via,evidence_text,evidence_url,metadata_json,discovered_at) VALUES (?,?,?,?,?,?)`).run(id, eventSource, input.evidenceText || classification.evidence.join(', ') || null, eventUrl, JSON.stringify(input.metadata || {}), now)
      return this.get(id)
    },
    authorize(id, { authorized, reference = null, accessible = true } = {}) {
      const now = new Date().toISOString()
      db.prepare(`UPDATE source_groups SET authorization_status=?,authorization_reference=?,access_status=?,status=?,last_verified_at=?,updated_at=? WHERE id=?`).run(authorized ? 'AUTHORIZED' : 'DISCOVERED', reference, accessible ? 'ACCESSIBLE' : 'INACCESSIBLE', authorized && accessible ? 'ACTIVE' : accessible ? 'PENDING_ACCESS' : 'INACCESSIBLE', now, now, id)
      return this.get(id)
    },
    setStatus(id, status) { db.prepare('UPDATE source_groups SET status=?,updated_at=? WHERE id=?').run(status, new Date().toISOString(), id); return this.get(id) },
    get(id) { return db.prepare('SELECT * FROM source_groups WHERE id=?').get(id) || null },
    list({ status = '', authorization = '' } = {}) {
      const where = ['1=1']; const params = []
      if (status) { where.push('sg.status=?'); params.push(status) }
      if (authorization) { where.push('sg.authorization_status=?'); params.push(authorization) }
      return db.prepare(`SELECT sm.*,sg.* FROM source_groups sg LEFT JOIN source_metrics sm ON sm.source_group_id=sg.id WHERE ${where.join(' AND ')} ORDER BY sg.status='ACTIVE' DESC,sg.relevance_score DESC,sg.updated_at DESC`).all(...params).map(parseSource)
    },
    schedulable() { return db.prepare("SELECT sm.*,sg.* FROM source_groups sg LEFT JOIN source_metrics sm ON sm.source_group_id=sg.id WHERE sg.status='ACTIVE' AND sg.authorization_status='AUTHORIZED' AND sg.access_status='ACCESSIBLE'").all().map(parseSource) },
    importLegacy(groups) {
      return db.transaction(() => (groups || []).map((group) => {
        const source = this.addCandidate({ url: group.url || group, name: group.name || '', discoveredVia: 'legacy_config', evidenceText: 'นำเข้าจากรายชื่อกลุ่มเดิม' })
        return this.authorize(source.id, { authorized: group.active !== false, accessible: true, reference: 'legacy_config' })
      }))()
    },
    recordCapture(id, delta = {}) {
      const now = new Date().toISOString()
      const fields = ['posts_seen','raw_posts_created','raw_posts_updated','duplicate_raw_posts','listing_instances_created','unique_listing_clusters_created','owner_posts_found','agent_posts_found','properties_created','properties_updated','fields_repaired','unresolved_fields','scroll_units_used','processing_duration_ms','ai_calls','ai_cost_estimate','capture_failures']
      const entries = fields.filter((field) => Number(delta[field]))
      if (entries.length) db.prepare(`UPDATE source_metrics SET ${entries.map((field) => `${field}=${field}+?`).join(',')},updated_at=? WHERE source_group_id=?`).run(...entries.map((field) => Number(delta[field])), now, id)
      const totals = db.prepare('SELECT * FROM source_metrics WHERE source_group_id=?').get(id)
      if (totals) {
        const seen = Math.max(1, Number(totals.posts_seen || 0))
        const created = Math.max(1, Number(totals.raw_posts_created || 0))
        db.prepare(`UPDATE source_groups SET unique_listing_yield=?,owner_lead_yield=?,duplicate_rate=?,failure_rate=?,estimated_collection_cost=? WHERE id=?`).run(
          Number(totals.unique_listing_clusters_created || totals.properties_created || 0) / seen,
          Number(totals.owner_posts_found || 0) / seen,
          Number(totals.duplicate_raw_posts || 0) / seen,
          Number(totals.capture_failures || 0) / Math.max(1, Number(totals.capture_failures || 0) + Number(totals.raw_posts_created || 0)),
          Number(totals.scroll_units_used || 0) / created + Number(totals.ai_cost_estimate || 0), id,
        )
      }
      db.prepare(`UPDATE source_groups SET last_capture_at=?,last_success_at=CASE WHEN ?=0 THEN ? ELSE last_success_at END,updated_at=? WHERE id=?`).run(now, Number(delta.capture_failures || 0), now, now, id)
    },
  }
}

function parseSource(row) { return { ...row, metadata: JSON.parse(row.metadata_json || '{}'), tags: JSON.parse(row.tags_json || '{}') } }
