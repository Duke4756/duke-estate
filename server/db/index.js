import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { seedTransitReference } from './seedTransit.js'
import { deterministicExtract } from '../pipeline/deterministicExtractor.js'
import { extractCandidates, isGenericProjectCandidate } from '../pipeline/candidateExtractor.js'
import { normalizeLookup } from '../pipeline/normalizer.js'
import { TransitStationMatcher } from '../services/transitStationMatcher.js'
import { saveTransitMatches } from './repositories/properties.js'
import { backfillListingClusters } from './repositories/listingClusters.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DEFAULT_FILE = path.join(__dirname, '..', 'data', 'condo-leads.sqlite')
const SCHEMA_FILE = path.join(__dirname, 'schema.sql')
const VERIFIED_STATIONS_FILE = path.join(__dirname, '..', 'data', 'verified-project-stations.json')

export function openDatabase(filename = process.env.CONDO_DB_PATH || DEFAULT_FILE) {
  if (filename !== ':memory:') fs.mkdirSync(path.dirname(filename), { recursive: true })
  const db = new Database(filename)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.exec(fs.readFileSync(SCHEMA_FILE, 'utf8'))
  migrateColumns(db)
  migrateAutomaticPropertySaving(db)
  migrateRetryLegacyExtractionFailures(db)
  migrateRetryTransitImportRegression(db)
  migrateRetryDatabaseLock(db)
  migrateCanonicalPrimaryTransit(db)
  migrateReextractUnverifiedProjectNames(db)
  seedTransitReference(db)
  seedVerifiedStations(db)
  migrateRemoveResidualGenericProjectNames(db)
  migrateVerifiedPropertyEnrichment(db)
  migrateProjectQualityRepair(db, 11)
  migrateProjectQualityRepair(db, 12)
  migrateProjectQualityRepair(db, 13)
  migrateRoomTypes(db)
  migrateRetryStudioBedroomConflict(db)
  migrateSourceRoles(db, 16)
  migrateSourceRoles(db, 17)
  migrateRepairExtension(db)
  migrateSourceRoles(db, 19)
  migrateSourceIntelligence(db)
  db.prepare('INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (?, ?)').run(1, new Date().toISOString())
  return db
}

function migrateSourceIntelligence(db) {
  if (db.prepare('SELECT 1 FROM schema_migrations WHERE version=20').get()) return
  const now = new Date().toISOString()
  db.transaction(() => {
    backfillListingClusters(db)
    db.prepare('INSERT OR IGNORE INTO schema_migrations(version,applied_at) VALUES (20,?)').run(now)
  })()
}

function migrateAutomaticPropertySaving(db) {
  const applied = db.prepare('SELECT 1 FROM schema_migrations WHERE version = 3').get()
  if (applied) return
  const now = new Date().toISOString()
  db.transaction(() => {
    db.prepare("UPDATE properties SET status='confirmed', updated_at=? WHERE status='pending_review' AND deleted_at IS NULL").run(now)
    db.prepare("UPDATE review_queue SET status='resolved', resolved_at=? WHERE status='open' AND property_id IS NOT NULL").run(now)
    db.prepare(`
      UPDATE post_processing_jobs SET status='COMPLETED', updated_at=?, completed_at=COALESCE(completed_at, ?)
      WHERE status='NEEDS_REVIEW'
        AND EXISTS (SELECT 1 FROM properties p WHERE p.raw_post_id=post_processing_jobs.raw_post_id AND p.deleted_at IS NULL)
    `).run(now, now)
    db.prepare('INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (3, ?)').run(now)
  })()
}

function migrateRetryLegacyExtractionFailures(db) {
  const applied = db.prepare('SELECT 1 FROM schema_migrations WHERE version = 4').get()
  if (applied) return
  const now = new Date().toISOString()
  db.transaction(() => {
    db.prepare(`
      UPDATE review_queue SET status='superseded', resolved_at=?
      WHERE status='open' AND raw_post_id IN (
        SELECT raw_post_id FROM post_processing_jobs WHERE status IN ('FAILED', 'NEEDS_REVIEW')
      )
    `).run(now)
    db.prepare(`
      UPDATE post_processing_jobs
      SET status='RETRY', attempt_count=0, next_retry_at=?, locked_at=NULL,
        locked_by=NULL, last_error=NULL, completed_at=NULL, updated_at=?
      WHERE status IN ('FAILED', 'NEEDS_REVIEW')
    `).run(now, now)
    db.prepare('INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (4, ?)').run(now)
  })()
}

function migrateRetryTransitImportRegression(db) {
  const applied = db.prepare('SELECT 1 FROM schema_migrations WHERE version = 5').get()
  if (applied) return
  const now = new Date().toISOString()
  db.transaction(() => {
    db.prepare(`
      UPDATE review_queue SET status='superseded', resolved_at=?
      WHERE status='open' AND raw_post_id IN (
        SELECT raw_post_id FROM post_processing_jobs
        WHERE status='NEEDS_REVIEW' AND last_error='isGenericTransitClaim is not defined'
      )
    `).run(now)
    db.prepare(`
      UPDATE post_processing_jobs
      SET status='RETRY', attempt_count=0, next_retry_at=?, locked_at=NULL,
        locked_by=NULL, last_error=NULL, completed_at=NULL, updated_at=?
      WHERE status='NEEDS_REVIEW' AND last_error='isGenericTransitClaim is not defined'
    `).run(now, now)
    db.prepare('INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (5, ?)').run(now)
  })()
}

function migrateRetryDatabaseLock(db) {
  const applied = db.prepare('SELECT 1 FROM schema_migrations WHERE version = 6').get()
  if (applied) return
  const now = new Date().toISOString()
  db.transaction(() => {
    db.prepare(`
      UPDATE review_queue SET status='superseded', resolved_at=?
      WHERE status='open' AND raw_post_id IN (
        SELECT raw_post_id FROM post_processing_jobs
        WHERE status='NEEDS_REVIEW' AND last_error='database is locked'
      )
    `).run(now)
    db.prepare(`
      UPDATE post_processing_jobs
      SET status='RETRY', attempt_count=0, next_retry_at=?, locked_at=NULL,
        locked_by=NULL, last_error=NULL, completed_at=NULL, updated_at=?
      WHERE status='NEEDS_REVIEW' AND last_error='database is locked'
    `).run(now, now)
    db.prepare('INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (6, ?)').run(now)
  })()
}

function migrateCanonicalPrimaryTransit(db) {
  const applied = db.prepare('SELECT 1 FROM schema_migrations WHERE version = 7').get()
  if (applied) return
  const now = new Date().toISOString()
  db.transaction(() => {
    db.prepare("DELETE FROM property_transit_stations WHERE match_status <> 'matched' OR station_id IS NULL").run()
    db.prepare(`
      DELETE FROM property_transit_stations
      WHERE id IN (
        SELECT id FROM (
          SELECT id, ROW_NUMBER() OVER (
            PARTITION BY property_id
            ORDER BY is_primary DESC,
              CASE WHEN distance_value IS NULL THEN 1 ELSE 0 END,
              CASE distance_unit WHEN 'km' THEN distance_value * 1000 WHEN 'm' THEN distance_value ELSE 999999 END,
              confidence DESC, id
          ) rank_in_property
          FROM property_transit_stations
        ) WHERE rank_in_property > 1
      )
    `).run()
    db.prepare("UPDATE property_transit_stations SET is_primary=1, updated_at=?").run(now)
    db.prepare('INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (7, ?)').run(now)
  })()
}

function migrateReextractUnverifiedProjectNames(db) {
  const applied = db.prepare('SELECT 1 FROM schema_migrations WHERE version = 8').get()
  if (applied) return
  const now = new Date().toISOString()
  const rows = db.prepare(`
    SELECT p.id, p.property_index, r.raw_text
    FROM properties p JOIN raw_posts r ON r.id=p.raw_post_id
    WHERE p.deleted_at IS NULL AND p.project_verified=0
  `).all()
  const update = db.prepare(`
    UPDATE properties SET project_name_raw=?, project_id=NULL,
      project_name_canonical=NULL, project_match_method=?, project_match_score=0,
      project_verified=0, updated_at=? WHERE id=?
  `)
  db.transaction(() => {
    for (const row of rows) {
      const extracted = deterministicExtract(row.raw_text)
      const property = extracted.properties[row.property_index] || extracted.properties[0]
      const projectName = property?.project_name_raw || null
      update.run(projectName, projectName ? 'unverified' : 'none', now, row.id)
      db.prepare("DELETE FROM field_evidence WHERE property_id=? AND field_name='project_name_raw'").run(row.id)
      const projectEvidence = property?.evidence?.find((item) => item.field === 'project_name_raw')
      if (projectName && projectEvidence?.quote) {
        db.prepare(`INSERT INTO field_evidence(property_id,field_name,value_json,quote,confidence,validation_status) VALUES (?,'project_name_raw',?,?,?,'valid')`)
          .run(row.id, JSON.stringify(projectName), projectEvidence.quote, projectEvidence.confidence)
      }
    }
    db.prepare('INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (8, ?)').run(now)
  })()
}

function migrateRemoveResidualGenericProjectNames(db) {
  const applied = db.prepare('SELECT 1 FROM schema_migrations WHERE version = 9').get()
  if (applied) return
  const now = new Date().toISOString()
  const rows = db.prepare(`
    SELECT id, project_name_raw FROM properties
    WHERE deleted_at IS NULL AND project_verified=0 AND project_name_raw IS NOT NULL
  `).all().filter((row) => isGenericProjectCandidate(row.project_name_raw))
  db.transaction(() => {
    for (const row of rows) {
      db.prepare(`
        UPDATE properties SET project_name_raw=NULL, project_id=NULL,
          project_name_canonical=NULL, project_match_method='none',
          project_match_score=0, project_verified=0, updated_at=? WHERE id=?
      `).run(now, row.id)
      db.prepare("DELETE FROM field_evidence WHERE property_id=? AND field_name='project_name_raw'").run(row.id)
    }
    db.prepare('INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (9, ?)').run(now)
  })()
}

function migrateColumns(db) {
  const columns = new Set(db.prepare('PRAGMA table_info(raw_posts)').all().map((row) => row.name))
  for (const [name, definition] of [
    ['author_profile_url', 'TEXT'],
    ['media_json', "TEXT NOT NULL DEFAULT '{}'"],
    ['crawl_run_id', 'TEXT'],
    ['raw_snippet', 'TEXT'],
    ['ingestion_status', "TEXT NOT NULL DEFAULT 'CAPTURED'"],
    ['captured_at', 'TEXT'],
  ]) {
    if (!columns.has(name)) db.exec(`ALTER TABLE raw_posts ADD COLUMN ${name} ${definition}`)
  }
  db.prepare('INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (?, ?)').run(2, new Date().toISOString())
}

function seedVerifiedStations(db) {
  const entries = JSON.parse(fs.readFileSync(VERIFIED_STATIONS_FILE, 'utf8'))
  const insertStation = db.prepare(`
    INSERT OR REPLACE INTO verified_project_stations
      (id, project_name, station_name, distance_m, source_url, verified_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `)
  const insertAlias = db.prepare(`
    INSERT OR REPLACE INTO verified_project_station_aliases(station_id, alias)
    VALUES (?, ?)
  `)
  const seed = db.transaction(() => {
    for (const entry of entries) {
      insertStation.run(
        entry.id, entry.projectName, entry.stationName, entry.distanceM,
        entry.sourceUrl, new Date().toISOString(),
      )
      for (const alias of entry.aliases) insertAlias.run(entry.id, alias.trim())
    }
  })
  seed()
}

function migrateVerifiedPropertyEnrichment(db) {
  const applied = db.prepare('SELECT 1 FROM schema_migrations WHERE version = 10').get()
  if (applied) return
  const now = new Date().toISOString()
  const matcher = new TransitStationMatcher(db)
  const mappings = db.prepare(`
    SELECT v.*, GROUP_CONCAT(a.alias, char(31)) aliases
    FROM verified_project_stations v
    LEFT JOIN verified_project_station_aliases a ON a.station_id=v.id
    GROUP BY v.id
  `).all().map((row) => ({
    ...row,
    aliases: [...new Set([row.project_name, ...String(row.aliases || '').split(String.fromCharCode(31))].filter(Boolean))],
  }))
  const upsertProject = db.prepare(`
    INSERT INTO projects(id, canonical_name, active, verified_at, dictionary_version)
    VALUES (?, ?, 1, ?, 'verified-station-v1')
    ON CONFLICT(id) DO UPDATE SET canonical_name=excluded.canonical_name, active=1
  `)
  const upsertAlias = db.prepare(`
    INSERT INTO project_aliases(project_id,alias,alias_normalized,alias_type,source,verified,created_at)
    VALUES (?, ?, ?, 'verified_mapping', ?, 1, ?)
    ON CONFLICT(alias_normalized) DO UPDATE SET project_id=excluded.project_id, alias=excluded.alias,
      source=excluded.source, verified=1
  `)
  const rows = db.prepare(`
    SELECT p.id, p.raw_post_id, p.property_index, p.project_name_raw, r.raw_text
    FROM properties p JOIN raw_posts r ON r.id=p.raw_post_id
    WHERE p.deleted_at IS NULL
  `).all()
  const updateProject = db.prepare(`
    UPDATE properties SET project_name_raw=?, project_id=?, project_name_canonical=?,
      project_match_method=?, project_match_score=?, project_verified=?, updated_at=? WHERE id=?
  `)
  db.transaction(() => {
    for (const mapping of mappings) {
      upsertProject.run(mapping.id, mapping.project_name, now)
      for (const alias of mapping.aliases) upsertAlias.run(mapping.id, alias, normalizeLookup(alias), mapping.source_url, now)
    }
    for (const row of rows) {
      const property = deterministicExtract(row.raw_text).properties[row.property_index]
        || deterministicExtract(row.raw_text).properties[0]
      let rawName = property?.project_name_raw || row.project_name_raw || null
      const normalizedRaw = normalizeLookup(rawName || '')
      const mapping = mappings.find((item) => item.aliases.some((alias) => {
        const normalizedAlias = normalizeLookup(alias)
        return normalizedAlias && (normalizedRaw === normalizedAlias
          || (!normalizedRaw && normalizeLookup(row.raw_text).includes(normalizedAlias)))
      }))
      if (mapping) {
        rawName ||= mapping.aliases.find((alias) => normalizeLookup(row.raw_text).includes(normalizeLookup(alias))) || mapping.project_name
        updateProject.run(rawName, mapping.id, mapping.project_name, 'verified_alias', 1, 1, now, row.id)
      } else if (rawName && rawName !== row.project_name_raw) {
        updateProject.run(rawName, null, null, 'unverified', 0, 0, now, row.id)
      }

      const existingTransit = db.prepare("SELECT 1 FROM property_transit_stations WHERE property_id=? AND match_status='matched' LIMIT 1").get(row.id)
      if (existingTransit) continue
      let matches = matcher.extract(row.raw_text)
      if (!matches.length && mapping) {
        const resolved = matcher.match(mapping.station_name, {
          evidenceText: mapping.station_name,
          rawText: mapping.station_name,
          allowFuzzy: false,
        })
        if (resolved.status === 'matched') {
          const projectEvidence = mapping.aliases.find((alias) => normalizeLookup(row.raw_text).includes(normalizeLookup(alias))) || rawName
          matches = [{ ...resolved, evidenceText: projectEvidence || mapping.project_name,
            originalMention: mapping.station_name, matchMethod: 'verified_project_mapping',
            confidence: 1, relationType: 'near', distanceValue: mapping.distance_m, distanceUnit: mapping.distance_m == null ? null : 'm' }]
        }
      }
      if (matches.length) saveTransitMatches(db, row.id, row.raw_post_id, matches.slice(0, 1), now)
    }
    db.prepare('INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (10, ?)').run(now)
  })()
}

function migrateProjectQualityRepair(db, version) {
  const applied = db.prepare('SELECT 1 FROM schema_migrations WHERE version = ?').get(version)
  if (applied) return
  const now = new Date().toISOString()
  const rows = db.prepare(`
    SELECT p.id,p.project_name_raw,p.project_verified,r.raw_text
    FROM properties p JOIN raw_posts r ON r.id=p.raw_post_id
    WHERE p.deleted_at IS NULL AND p.project_verified=0
  `).all()
  const update = db.prepare(`UPDATE properties SET project_name_raw=?,project_id=NULL,
    project_name_canonical=NULL,project_match_method=?,project_match_score=0,project_verified=0,updated_at=? WHERE id=?`)
  db.transaction(() => {
    for (const row of rows) {
      const currentBad = row.project_name_raw && isGenericProjectCandidate(row.project_name_raw)
      if (row.project_name_raw && !currentBad) continue
      const candidate = extractCandidates(row.raw_text).projectNames.find((item) => !isGenericProjectCandidate(item.value))
      const next = candidate?.value || null
      if (next === row.project_name_raw) continue
      update.run(next, next ? 'unverified' : 'none', now, row.id)
      db.prepare("DELETE FROM field_evidence WHERE property_id=? AND field_name='project_name_raw'").run(row.id)
      if (next && candidate?.quote && row.raw_text.includes(candidate.quote)) {
        db.prepare(`INSERT INTO field_evidence(property_id,field_name,value_json,quote,confidence,validation_status)
          VALUES (?,'project_name_raw',?,?,0.65,'valid')`).run(row.id, JSON.stringify(next), candidate.quote)
      }
    }
    db.prepare('INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (?, ?)').run(version, now)
  })()
}

function migrateRoomTypes(db) {
  const applied = db.prepare('SELECT 1 FROM schema_migrations WHERE version = 14').get()
  if (applied) return
  const now = new Date().toISOString()
  db.transaction(() => {
    db.prepare(`
      UPDATE properties SET room_type = CASE
        WHEN lower((SELECT raw_text FROM raw_posts WHERE id=properties.raw_post_id)) LIKE '%duplex%'
          OR (SELECT raw_text FROM raw_posts WHERE id=properties.raw_post_id) LIKE '%ดูเพล็กซ์%'
          OR (SELECT raw_text FROM raw_posts WHERE id=properties.raw_post_id) LIKE '%ดูเพลกซ์%' THEN 'duplex'
        WHEN lower((SELECT raw_text FROM raw_posts WHERE id=properties.raw_post_id)) LIKE '%penthouse%'
          OR (SELECT raw_text FROM raw_posts WHERE id=properties.raw_post_id) LIKE '%เพนต์เฮาส์%'
          OR (SELECT raw_text FROM raw_posts WHERE id=properties.raw_post_id) LIKE '%เพนท์เฮาส์%' THEN 'penthouse'
        WHEN lower((SELECT raw_text FROM raw_posts WHERE id=properties.raw_post_id)) LIKE '%loft%'
          OR (SELECT raw_text FROM raw_posts WHERE id=properties.raw_post_id) LIKE '%ห้องลอฟท์%'
          OR (SELECT raw_text FROM raw_posts WHERE id=properties.raw_post_id) LIKE '%ห้องลอฟต์%' THEN 'loft'
        WHEN lower((SELECT raw_text FROM raw_posts WHERE id=properties.raw_post_id)) LIKE '%studio%'
          OR (SELECT raw_text FROM raw_posts WHERE id=properties.raw_post_id) LIKE '%สตูดิโอ%' THEN 'studio'
        ELSE room_type END,
        updated_at=?
      WHERE deleted_at IS NULL AND (
        lower((SELECT raw_text FROM raw_posts WHERE id=properties.raw_post_id)) LIKE '%duplex%'
        OR (SELECT raw_text FROM raw_posts WHERE id=properties.raw_post_id) LIKE '%ดูเพล็กซ์%'
        OR (SELECT raw_text FROM raw_posts WHERE id=properties.raw_post_id) LIKE '%ดูเพลกซ์%'
        OR lower((SELECT raw_text FROM raw_posts WHERE id=properties.raw_post_id)) LIKE '%penthouse%'
        OR (SELECT raw_text FROM raw_posts WHERE id=properties.raw_post_id) LIKE '%เพนต์เฮาส์%'
        OR (SELECT raw_text FROM raw_posts WHERE id=properties.raw_post_id) LIKE '%เพนท์เฮาส์%'
        OR lower((SELECT raw_text FROM raw_posts WHERE id=properties.raw_post_id)) LIKE '%loft%'
        OR (SELECT raw_text FROM raw_posts WHERE id=properties.raw_post_id) LIKE '%ห้องลอฟท์%'
        OR (SELECT raw_text FROM raw_posts WHERE id=properties.raw_post_id) LIKE '%ห้องลอฟต์%'
        OR lower((SELECT raw_text FROM raw_posts WHERE id=properties.raw_post_id)) LIKE '%studio%'
        OR (SELECT raw_text FROM raw_posts WHERE id=properties.raw_post_id) LIKE '%สตูดิโอ%'
      )
    `).run(now)
    db.prepare('INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (14, ?)').run(now)
  })()
}

function migrateRetryStudioBedroomConflict(db) {
  const applied = db.prepare('SELECT 1 FROM schema_migrations WHERE version = 15').get()
  if (applied) return
  const now = new Date().toISOString()
  db.transaction(() => {
    const rawIds = db.prepare(`
      SELECT DISTINCT raw_post_id FROM post_processing_jobs
      WHERE status='NEEDS_REVIEW' AND last_error LIKE '%bedrooms must be 0 for studio%'
    `).all().map((row) => row.raw_post_id)
    for (const rawPostId of rawIds) {
      const latest = db.prepare(`
        SELECT MAX(id) id FROM post_processing_jobs
        WHERE raw_post_id=? AND status='NEEDS_REVIEW'
      `).get(rawPostId)
      db.prepare(`
        UPDATE post_processing_jobs SET status='SUPERSEDED',locked_at=NULL,locked_by=NULL,updated_at=?
        WHERE raw_post_id=? AND status='NEEDS_REVIEW'
      `).run(now, rawPostId)
      db.prepare(`
        UPDATE post_processing_jobs SET status='RETRY',attempt_count=0,next_retry_at=?,
          locked_at=NULL,locked_by=NULL,last_error=NULL,completed_at=NULL,updated_at=?
        WHERE id=?
      `).run(now, now, latest.id)
      db.prepare(`
        UPDATE review_queue SET status='superseded',resolved_at=?
        WHERE raw_post_id=? AND status='open' AND reason_code='PROCESSING_VALIDATION_ERROR'
      `).run(now, rawPostId)
      db.prepare("UPDATE raw_posts SET ingestion_status='RETRY' WHERE id=?").run(rawPostId)
    }
    db.prepare('INSERT OR IGNORE INTO schema_migrations(version,applied_at) VALUES (15,?)').run(now)
  })()
}

function migrateSourceRoles(db, version) {
  const applied = db.prepare('SELECT 1 FROM schema_migrations WHERE version = ?').get(version)
  if (applied) return
  const now = new Date().toISOString()
  const rows = db.prepare(`
    SELECT p.id,r.raw_text FROM properties p JOIN raw_posts r ON r.id=p.raw_post_id
    WHERE p.deleted_at IS NULL
  `).all()
  const update = db.prepare('UPDATE properties SET source_role=?,updated_at=? WHERE id=?')
  db.transaction(() => {
    for (const row of rows) {
      const roles = [...new Set((extractCandidates(row.raw_text).sourceRoles || []).map((item) => item.value))]
      update.run(roles.length === 1 ? roles[0] : null, now, row.id)
    }
    db.prepare('INSERT OR IGNORE INTO schema_migrations(version,applied_at) VALUES (?,?)').run(version, now)
  })()
}

function migrateRepairExtension(db) {
  const applied = db.prepare('SELECT 1 FROM schema_migrations WHERE version = 18').get()
  if (applied) return
  const now = new Date().toISOString()
  db.transaction(() => {
    db.prepare(`UPDATE properties SET room_type='double_volume',updated_at=? WHERE deleted_at IS NULL AND room_type IS NULL AND (lower((SELECT raw_text FROM raw_posts WHERE id=properties.raw_post_id)) LIKE '%double volume%' OR lower((SELECT raw_text FROM raw_posts WHERE id=properties.raw_post_id)) LIKE '%double-volume%' OR (SELECT raw_text FROM raw_posts WHERE id=properties.raw_post_id) LIKE '%ดับเบิลวอลุ่ม%' OR (SELECT raw_text FROM raw_posts WHERE id=properties.raw_post_id) LIKE '%เพดานสูงสองชั้น%')`).run(now)
    db.prepare('INSERT OR IGNORE INTO schema_migrations(version,applied_at) VALUES (18,?)').run(now)
  })()
}
