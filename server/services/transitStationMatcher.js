const PREFIX = /^(?:(?:ใกล้|ติด|ห่าง(?:จาก)?|เดิน(?:ไป|ถึง)?|near|next\s+to|walk(?:ing)?\s+to)\s*)?(?:สถานี\s*)?(bts|mrt|arl|airport\s*rail\s*link|airport\s*link)\s*/iu

export function normalizeTransitAlias(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(PREFIX, '')
    .replace(/\b(?:station|sta)\b/giu, ' ')
    .replace(/สถานี/gu, ' ')
    .replace(/[()[\]{}.,:;/'"`~_–—-]+/gu, ' ')
    .replace(/([\p{L}\p{M}])(\d)/gu, '$1 $2')
    .replace(/(\d)([\p{L}\p{M}])/gu, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
}

export class TransitStationMatcher {
  constructor(db, { fuzzyThreshold = 0.92, ambiguityGap = 0.08 } = {}) {
    this.db = db
    this.fuzzyThreshold = fuzzyThreshold
    this.ambiguityGap = ambiguityGap
  }

  match(mention, { evidenceText = mention, rawText = evidenceText, allowFuzzy = true } = {}) {
    const originalMention = String(mention || '').trim()
    const evidence = String(evidenceText || '')
    const raw = String(rawText || '')
    const normalizedMention = normalizeTransitAlias(originalMention)
    const systemCode = systemFromMention(originalMention)
    if (!originalMention || !normalizedMention || !evidence || !raw.includes(evidence)) {
      return result('not_found', { originalMention, normalizedMention, evidenceText: evidence, matchMethod: 'none', confidence: 0 })
    }
    const rows = this.#directory(systemCode)
    const exact = rows.filter((row) => row.normalized_alias === normalizedMention)
    if (exact.length === 1 && contextAllows(exact[0], originalMention, systemCode)) return matched(exact[0], originalMention, normalizedMention, evidence, exact[0].alias_type === 'canonical' ? 'canonical_name' : 'exact_alias', 1)
    if (exact.length > 1) return ambiguous(exact, originalMention, normalizedMention, evidence, 'exact_alias')

    const contained = rows.filter((row) => aliasInsideMention(normalizedMention, row.normalized_alias) && contextAllows(row, originalMention, systemCode))
    const uniqueContained = bestPerStation(contained).sort((a, b) => b.normalized_alias.length - a.normalized_alias.length)
    if (uniqueContained.length === 1) return matched(uniqueContained[0], originalMention, normalizedMention, evidence, 'contextual', 0.98)
    if (uniqueContained.length > 1) {
      const longest = uniqueContained[0].normalized_alias.length
      const equallySpecific = uniqueContained.filter((item) => longest - item.normalized_alias.length <= 1)
      if (equallySpecific.length === 1) return matched(equallySpecific[0], originalMention, normalizedMention, evidence, 'contextual', 0.96)
      return ambiguous(equallySpecific, originalMention, normalizedMention, evidence, 'contextual')
    }

    if (!allowFuzzy || normalizedMention.length < 5) return result('not_found', { originalMention, normalizedMention, evidenceText: evidence, matchMethod: 'none', confidence: 0 })
    const scored = bestPerStation(rows.map((row) => ({ ...row, score: similarity(normalizedMention, row.normalized_alias) })))
      .sort((a, b) => b.score - a.score)
    const best = scored[0]
    const second = scored[1]
    if (!best || best.score < this.fuzzyThreshold) return result('not_found', { originalMention, normalizedMention, evidenceText: evidence, matchMethod: 'fuzzy', confidence: best?.score || 0, candidates: candidates(scored.slice(0, 3)) })
    if (second && best.score - second.score < this.ambiguityGap) return ambiguous(scored.slice(0, 3), originalMention, normalizedMention, evidence, 'fuzzy')
    return matched(best, originalMention, normalizedMention, evidence, 'fuzzy', best.score)
  }

  extract(rawText) {
    const raw = String(rawText || '')
    const mentions = []
    const prefixed = /(?:(?:ใกล้|ติด|ห่าง(?:จาก)?|เดิน(?:ไป|ถึง)?|near|next\s+to|walk(?:ing)?\s+to)\s*)?(?:\b(?:BTS|MRT|ARL)\b|Airport\s+(?:Rail\s+)?Link|รถไฟฟ้า(?:บีทีเอส|เอ็มอาร์ที)?)\s*[:：-]?\s*.*?(?=(?:(?:ใกล้|ติด|ห่าง(?:จาก)?|เดิน(?:ไป|ถึง)?|near|next\s+to|walk(?:ing)?\s+to)\s*)?(?:\b(?:BTS|MRT|ARL)\b|Airport\s+(?:Rail\s+)?Link|รถไฟฟ้า(?:บีทีเอส|เอ็มอาร์ที)?)|[\n|,;•]|$)/giu
    for (const match of raw.matchAll(prefixed)) {
      const claim = trimClaim(match[0])
      if (!claim) continue
      const resolved = this.match(claim, { evidenceText: claim, rawText: raw })
      const distance = distanceFromText(claim)
      mentions.push({ ...resolved, relationType: relationFromText(claim), ...distance })
    }
    const verified = dedupeMentions(mentions)
      .filter((item) => item.status === 'matched' && item.stationId && item.canonicalNameTh)
      .sort(comparePrimaryStation)
    return verified.slice(0, 1)
  }

  listStations({ system = '', q = '' } = {}) {
    const params = []
    const where = ['s.active = 1']
    if (system) { where.push('sys.code = ?'); params.push(String(system).toUpperCase()) }
    if (q) { where.push('(s.canonical_name_th LIKE ? OR s.canonical_name_en LIKE ?)'); params.push(`%${q}%`, `%${q}%`) }
    return this.db.prepare(`SELECT s.id, sys.code systemCode, s.canonical_name_th canonicalNameTh, s.canonical_name_en canonicalNameEn, group_concat(sl.station_code) stationCodes FROM transit_stations s JOIN transit_systems sys ON sys.id=s.system_id LEFT JOIN transit_station_lines sl ON sl.station_id=s.id WHERE ${where.join(' AND ')} GROUP BY s.id ORDER BY sys.code, s.canonical_name_en`).all(...params)
  }

  #directory(systemCode) {
    const params = []
    const filter = systemCode ? 'AND sys.code = ?' : ''
    if (systemCode) params.push(systemCode)
    return this.db.prepare(`SELECT a.alias, a.normalized_alias, a.alias_type, s.id station_id, s.canonical_name_th, s.canonical_name_en, sys.code system_code, group_concat(DISTINCT l.code) line_codes, group_concat(DISTINCT sl.station_code) station_codes FROM transit_station_aliases a JOIN transit_stations s ON s.id=a.station_id JOIN transit_systems sys ON sys.id=s.system_id LEFT JOIN transit_station_lines sl ON sl.station_id=s.id LEFT JOIN transit_lines l ON l.id=sl.line_id WHERE a.active=1 AND s.active=1 ${filter} GROUP BY a.id`).all(...params)
  }
}

function systemFromMention(value) {
  const hit = String(value).match(/(BTS|MRT|ARL)|Airport\s+(?:Rail\s+)?Link/iu)?.[0]?.toUpperCase()
  return hit?.startsWith('AIRPORT') ? 'ARL' : hit || null
}
function contextAllows(row, mention, systemCode) {
  if (systemCode) return row.system_code === systemCode
  // Area names that commonly mean roads/neighbourhoods require an explicit system.
  return !['สุขุมวิท','sukhumvit','สีลม','silom','ลาดพร้าว','lat phrao','ladprao','บางซื่อ','bang sue','จตุจักร','chatuchak'].includes(row.normalized_alias)
}
function aliasInsideMention(mention, alias) { return alias.length >= 3 && (` ${mention} `).includes(` ${alias} `) }
function bestPerStation(rows) { const found = new Map(); for (const row of rows.sort((a, b) => (b.score || 0) - (a.score || 0))) if (!found.has(row.station_id)) found.set(row.station_id, row); return [...found.values()] }
function matched(row, originalMention, normalizedMention, evidenceText, method, confidence) { return result('matched', { stationId: row.station_id, canonicalNameTh: row.canonical_name_th, canonicalNameEn: row.canonical_name_en, systemCode: row.system_code, lineCode: row.line_codes?.split(',')[0] || null, stationCode: row.station_codes?.split(',')[0] || null, originalMention, normalizedMention, matchMethod: method, confidence, evidenceText }) }
function ambiguous(rows, originalMention, normalizedMention, evidenceText, method) { return result('ambiguous', { originalMention, normalizedMention, evidenceText, matchMethod: method, confidence: rows[0]?.score || 0.5, candidates: candidates(bestPerStation(rows).slice(0, 5)) }) }
function result(status, fields) { return { status, stationId: null, canonicalNameTh: null, canonicalNameEn: null, systemCode: null, lineCode: null, stationCode: null, originalMention: '', normalizedMention: '', matchMethod: 'none', confidence: 0, evidenceText: '', candidates: [], ...fields } }
function candidates(rows) { return rows.map((row) => ({ stationId: row.station_id, canonicalNameTh: row.canonical_name_th, canonicalNameEn: row.canonical_name_en, systemCode: row.system_code, confidence: row.score ?? 1 })) }
function similarity(a, b) { const distance = levenshtein(a, b); return 1 - distance / Math.max(a.length, b.length, 1) }
function levenshtein(a, b) { const row = [...Array(b.length + 1).keys()]; for (let i=1;i<=a.length;i++){ let prev=row[0]; row[0]=i; for(let j=1;j<=b.length;j++){ const old=row[j]; row[j]=Math.min(row[j]+1,row[j-1]+1,prev+(a[i-1]===b[j-1]?0:1)); prev=old } } return row[b.length] }
function trimClaim(value) { return String(value).replace(/\s+(?:ราคา|ค่าเช่า|ห้อง|ชั้น|ขนาด|พร้อมอยู่|เฟอร์|contact|โทร|line)\b.*$/iu, '').replace(/\s*#.*$/u, '').replace(/\s*(?:ดูเพิ่มเติม|ดูน้อยลง|see more|see less).*$/iu, '').replace(/[.,;|•]+$/u, '').trim() }
function relationFromText(value) { if (/ติด|connected|เชื่อม/iu.test(value)) return 'connected'; if (/เดิน|walk/iu.test(value)) return 'walkable'; if (/ใกล้|near|ห่าง/iu.test(value)) return 'nearby'; return 'mentioned' }
function distanceFromText(value) { const hit=String(value).match(/(\d+(?:\.\d+)?)\s*(เมตร|ม\.?|m\b|กม\.?|km\b|นาที|mins?|minutes?)/iu); if(!hit) return {distanceValue:null,distanceUnit:null}; const unit=/กม|km/iu.test(hit[2])?'km':/นาที|min/iu.test(hit[2])?'min_walk':'m'; return {distanceValue:Number(hit[1]),distanceUnit:unit} }
function dedupeMentions(items) { return [...new Map(items.map((item) => [`${item.originalMention}|${item.stationId || item.status}`, item])).values()] }
function comparePrimaryStation(a, b) {
  const distance = (item) => {
    if (!Number.isFinite(item.distanceValue)) return Number.POSITIVE_INFINITY
    if (item.distanceUnit === 'km') return item.distanceValue * 1000
    if (item.distanceUnit === 'm') return item.distanceValue
    return Number.POSITIVE_INFINITY
  }
  return distance(a) - distance(b) || b.confidence - a.confidence
}

export function isGenericTransitClaim(value) {
  return /^(?:(?:ใกล้|ติด|ห่าง(?:จาก)?|เดิน(?:ไป|ถึง)?|near|next\s+to|walk(?:ing)?\s+to)\s*)?(?:bts|mrt|arl|airport\s*(?:rail\s*)?link|รถไฟฟ้า(?:บีทีเอส|เอ็มอาร์ที)?|รถไฟฟ้าสายสี(?:เขียว|น้ำเงิน|ม่วง|เหลือง|ชมพู|ทอง))$/iu.test(String(value || '').trim())
}
