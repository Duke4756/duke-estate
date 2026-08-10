import { TRANSIT_DATA_VERSION, transitLines, transitStations, transitSystems } from '../data/transit-reference.js'
import { normalizeTransitAlias } from '../services/transitStationMatcher.js'

export function seedTransitReference(db) {
  const upsertSystem = db.prepare(`INSERT INTO transit_systems(id, code, name_th, name_en, active, data_version) VALUES (?, ?, ?, ?, 1, ?) ON CONFLICT(id) DO UPDATE SET code=excluded.code, name_th=excluded.name_th, name_en=excluded.name_en, active=1, data_version=excluded.data_version`)
  const upsertLine = db.prepare(`INSERT INTO transit_lines(id, system_id, code, name_th, name_en, color, active) VALUES (?, ?, ?, ?, ?, ?, 1) ON CONFLICT(id) DO UPDATE SET system_id=excluded.system_id, code=excluded.code, name_th=excluded.name_th, name_en=excluded.name_en, color=excluded.color, active=1`)
  const upsertStation = db.prepare(`INSERT INTO transit_stations(id, system_id, canonical_name_th, canonical_name_en, active) VALUES (?, ?, ?, ?, 1) ON CONFLICT(id) DO UPDATE SET system_id=excluded.system_id, canonical_name_th=excluded.canonical_name_th, canonical_name_en=excluded.canonical_name_en, active=1`)
  const upsertStationLine = db.prepare(`INSERT INTO transit_station_lines(station_id, line_id, station_code) VALUES (?, ?, ?) ON CONFLICT(station_id, line_id) DO UPDATE SET station_code=excluded.station_code`)
  const upsertAlias = db.prepare(`INSERT INTO transit_station_aliases(station_id, alias, normalized_alias, language, alias_type, active) VALUES (?, ?, ?, ?, ?, 1) ON CONFLICT(station_id, normalized_alias) DO UPDATE SET alias=excluded.alias, language=excluded.language, alias_type=excluded.alias_type, active=1`)
  const seed = db.transaction(() => {
    for (const system of transitSystems) upsertSystem.run(system.id, system.code, system.nameTh, system.nameEn, TRANSIT_DATA_VERSION)
    for (const line of transitLines) upsertLine.run(line.id, line.systemId, line.code, line.nameTh, line.nameEn, line.color || null)
    for (const station of transitStations) {
      upsertStation.run(station.id, station.systemId, station.canonicalNameTh, station.canonicalNameEn)
      for (const line of station.lines) upsertStationLine.run(station.id, line.lineId, line.stationCode || null)
      const aliases = [
        [station.canonicalNameTh, 'th', 'canonical'],
        [station.canonicalNameEn, 'en', 'canonical'],
        ...station.aliases.map((alias) => [alias, /[ก-๙]/u.test(alias) ? 'th' : 'en', 'common']),
      ]
      for (const [alias, language, type] of aliases) {
        const normalized = normalizeTransitAlias(alias)
        if (normalized) upsertAlias.run(station.id, alias, normalized, language, type)
      }
    }
  })
  seed()
  return {
    version: TRANSIT_DATA_VERSION,
    systems: transitSystems.length,
    lines: transitLines.length,
    stations: transitStations.length,
  }
}
