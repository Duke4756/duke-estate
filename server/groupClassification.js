const ZONES = {
  SUKHUMVIT: ['สุขุมวิท', 'sukhumvit', 'ทองหล่อ', 'thonglor', 'thong lo', 'เอกมัย', 'ekkamai', 'พร้อมพงษ์', 'phrom phong', 'phromphong', 'อ่อนนุช', 'on nut', 'onnut'],
  RAMA9_RATCHADA: ['พระราม 9', 'พระราม9', 'rama 9', 'rama ix', 'รัชดา', 'รัชดาภิเษก', 'ratchada', 'ห้วยขวาง', 'huai khwang'],
  LADPRAO_RATCHAYOTHIN: ['ลาดพร้าว', 'ladprao', 'รัชโยธิน', 'ratchayothin', 'จตุจักร', 'chatuchak'],
  CHULA_SIAM_PHAYATHAI: ['จุฬา', 'chula', 'สามย่าน', 'samyan', 'สยาม', 'siam', 'พญาไท', 'phayathai', 'ราชเทวี', 'ratchathewi'],
  SATHORN_SILOM: ['สาทร', 'sathorn', 'สีลม', 'silom', 'ช่องนนทรี', 'chong nonsi'],
  BANGNA_EAST: ['บางนา', 'bangna', 'ศรีนครินทร์', 'srinakarin', 'แบริ่ง', 'bearing', 'ลาซาล', 'lasalle'],
  GENERAL: [],
}
const normalize = (value) => String(value || '').toLowerCase().replace(/[–—-]/g, ' ').replace(/\s+/g, ' ').trim()
const canonicalZone = (zone = '') => ({ SATHORN: 'SATHORN_SILOM', SILOM: 'SATHORN_SILOM', ASOKE: 'SUKHUMVIT', THONGLOR: 'SUKHUMVIT', EKKAMAI: 'SUKHUMVIT', PHROMPHONG: 'SUKHUMVIT', ONNUT: 'SUKHUMVIT', RAMA9: 'RAMA9_RATCHADA', RATCHADA: 'RAMA9_RATCHADA', LADPRAO: 'LADPRAO_RATCHAYOTHIN', BANGNA: 'BANGNA_EAST', SRINAKARIN: 'BANGNA_EAST' }[String(zone).toUpperCase()] || String(zone).toUpperCase())
export const zoneAliases = Object.fromEntries(Object.entries(ZONES).flatMap(([zone, aliases]) => aliases.map((alias) => [normalize(alias), zone])))
export function classifyGroup(group = {}) {
  if (group.manualCategory || group.manualZoneTags) return { ...group, category: group.manualCategory || group.category, zone_tags: group.manualZoneTags || group.zone_tags || [], needsReview: false }
  const text = normalize(`${group.name || ''} ${group.url || ''} ${(group.marketingTags || []).join(' ')}`)
  const house = /บ้านเดี่ยว|ทาวน์โฮม|ทาวน์เฮาส์|house|townhome|town house|villa/i.test(text)
  const condo = /คอนโด|condo|apartment|คอนโดมิเนียม/i.test(text)
  const category = house && !condo ? 'HOUSE' : condo && !house ? 'CONDO' : null
  const zone_tags = Object.entries(ZONES).filter(([, aliases]) => aliases.some((alias) => text.includes(normalize(alias)))).map(([zone]) => zone)
  const project_specific = Boolean(/\b(buy sell rent|ซื้อขายเช่า|for rent|ปล่อยเช่า)\b/i.test(text) && /(?:^|\s)(?:the|life|ideo|ashton|noble|supalai|maestro|คอนโด|บ้านกลางเมือง)\b/i.test(text) && !/bangkok|กรุงเทพ|sukhumvit|สุขุมวิท|owner post/i.test(text))
  const project_name = project_specific ? String(group.name || '').replace(/\b(?:buy|sell|rent|for|sale)\b/gi, '').replace(/ซื้อขายเช่า|ปล่อยเช่า/gi, '').trim() : null
  return { ...group, category: category || (['CONDO', 'HOUSE'].includes(String(group.category || '').toUpperCase()) ? String(group.category).toUpperCase() : null), zone_tags: group.zone_tags?.length ? group.zone_tags : zone_tags, project_specific: group.project_specific === true || project_specific, project_name: group.project_name || project_name, project_aliases: group.project_aliases || [], manual_tags: group.manual_tags || [], needsReview: !(category || ['CONDO', 'HOUSE'].includes(String(group.category || '').toUpperCase())) }
}
export function classifyGroups(groups = []) { return groups.map(classifyGroup) }
export function findEligibleGroups(property = {}, groups = []) {
  const category = String(property.category || property.kind || '').toUpperCase(); const zones = new Set((property.zone_tags || property.zones || []).map(canonicalZone)); const project = normalize(property.project_name || property.project || '');
  return groups.map((group) => { const g = classifyGroup(group); if (g.needsReview || g.category !== category || (g.project_specific && normalize(g.project_name) !== project && !(g.project_aliases || []).some((a) => normalize(a) === project))) return null; const exact = g.project_specific && (normalize(g.project_name) === project || (g.project_aliases || []).some((a) => normalize(a) === project)); const matched = (g.zone_tags || []).map(canonicalZone).filter((z) => zones.has(z)); const score = exact ? 100 : matched.length ? 40 : g.project_specific ? -1 : 10; return score < 0 ? null : { ...g, score, zoneMatch: matched } }).filter(Boolean).sort((a, b) => b.score - a.score)
}
