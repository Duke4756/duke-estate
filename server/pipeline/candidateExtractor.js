import { evidence } from './evidence.js'
import { CANDIDATE_VERSION } from './versions.js'

const numberValue = (raw) => {
  const compact = String(raw).replace(/,/g, '').trim().toLowerCase()
  const value = Number.parseFloat(compact)
  return Number.isFinite(value) ? value : null
}

function collect(text, regex, map) {
  const found = []
  for (const match of text.matchAll(regex)) {
    const value = map(match)
    if (value != null) found.push(evidence(text, match, value))
  }
  return found
}

export function extractCandidates(rawText) {
  const text = String(rawText || '')
  const areas = collect(
    text,
    /(\d[\d,]*(?:\.\d+)?)\s*(ตร\.?\s*ม\.?|ตารางเมตร|ตรม\.?|sqm|sq\.?\s*m\.?|m²)/giu,
    (match) => numberValue(match[1]),
  )
  const budgets = collect(
    text,
    /(?:งบ(?:ประมาณ)?|budget)\s*(?:ไม่เกิน|ประมาณ|ราว|:|=|-)?\s*(?:฿\s*)?(\d[\d,]*(?:\.\d+)?)\s*(ล้าน|หมื่น|k|บาท|thb)?/giu,
    (match) => monetaryValue(match[1], match[2]),
  )
  const rentPrices = collect(
    text,
    /(?:ปล่อยเช่า|ให้เช่า|ค่าเช่า|ราคาเช่า|rent(?:al)?(?:\s*price)?|for rent)\s*(?:@|:|=|-)?\s*(?:฿|\$)?\s*(\d[\d,]*(?:\.\d+)?)\s*(ล้าน|หมื่น|k|บาท|thb|usd)?(?:\s*(?:\/|ต่อ)\s*(?:เดือน|month|mth)|\s*(?:บาท|thb|usd)\s*\/?\s*(?:เดือน|month))?/giu,
    (match) => hasMoneyEvidence(match[0]) ? monetaryValue(match[1], match[2]) : null,
  )
  rentPrices.push(...collect(
    text,
    /(?:฿|\$)?\s*(\d[\d,]*(?:\.\d+)?)\s*(บาท|thb|usd)?\s*(?:\/|ต่อ)\s*(?:เดือน|month|mth)/giu,
    (match) => hasMoneyEvidence(match[0]) ? monetaryValue(match[1], match[2]) : null,
  ))
  rentPrices.unshift(...collect(
    text,
    /(?:ค่าเช่า|ราคาเช่า|rental?\s*price)?\s*(?:[:：-]\s*)?(?:THB|บาท|฿|USD|\$)\s*(\d[\d,]*(?:\.\d+)?)\s*(?:\/\s*(?:เดือน|month|mth))?/giu,
    (match) => monetaryValue(match[1]),
  ))
  const salePrices = collect(
    text,
    /(?:ราคาขาย|ขาย(?:เพียง|ที่)?|sale(?:\s*price)?|for sale)\s*(?:@|:|=|-)?\s*(?:฿|\$)?\s*(\d[\d,]*(?:\.\d+)?)\s*(ล้าน|หมื่น|k|บาท|thb|usd)?/giu,
    (match) => hasMoneyEvidence(match[0]) ? monetaryValue(match[1], match[2]) : null,
  )
  const moneyAmounts = extractGenericMoney(text)
  const bedrooms = collect(
    text,
    /(?:^|[^\d])(\d+(?:\.\d+)?)\s*(ห้องนอน|bed(?:room)?s?|br)/giu,
    (match) => numberValue(match[1]),
  )
  const studios = collect(text, /สตูดิโอ|studio(?:\s*room)?/giu, () => 0)
  const roomTypes = [
    ...collect(text, /\bdouble[- ]?volume\b|ดับเบิลวอลุ่ม|เพดานสูงสองชั้น/giu, () => 'double_volume'),
    ...collect(text, /\bduplex\b|ดูเพล็กซ์|ดูเพลกซ์/giu, () => 'duplex'),
    ...collect(text, /\bpenthouse\b|เพนต์เฮาส์|เพนท์เฮาส์/giu, () => 'penthouse'),
    ...collect(text, /\bloft\b|ห้องลอฟท์|ห้องลอฟต์/giu, () => 'loft'),
    ...collect(text, /สตูดิโอ|studio(?:\s*room)?/giu, () => 'studio'),
  ]
  const bathrooms = collect(text, /(\d+)\s*(ห้องน้ำ|bath(?:room)?s?)/giu, (match) => numberValue(match[1]))
  const floors = collect(text, /(?:ชั้น|floor)\s*(\d{1,3})/giu, (match) => numberValue(match[1]))
  const petPolicies = [
    ...collect(text, /เลี้ยงสัตว์ได้|รับสัตว์เลี้ยง|pet[- ]?friendly|pets?\s+allowed/giu, () => 'allowed'),
    ...collect(text, /ห้ามเลี้ยงสัตว์|ไม่(?:รับ|อนุญาต)(?:ให้)?เลี้ยงสัตว์|no\s+pets?|pets?\s+not\s+allowed/giu, () => 'not_allowed'),
  ]
  const phones = collect(text, /(?:\+66|0)\d[\d -]{7,12}\d/g, (match) => match[0].replace(/[ -]/g, ''))
  const transit = collect(text, /\b(?:BTS|MRT|ARL|Airport Rail Link)\s*[-:]?\s*[A-Za-zก-๙][A-Za-zก-๙0-9 -]{1,40}/giu, (match) => match[0].trim())
  const projectNames = extractProjectCandidates(text)
  const sourceRoles = extractSourceRoleCandidates(text)
  return {
    version: CANDIDATE_VERSION,
    areas,
    budgets,
    rentPrices: uniqueEvidence(rentPrices),
    salePrices,
    moneyAmounts,
    bedrooms: [...studios, ...bedrooms],
    roomTypes,
    bathrooms,
    floors,
    petPolicies,
    phones,
    transit,
    projectNames,
    sourceRoles,
  }
}

function extractSourceRoleCandidates(text) {
  const owners = collect(
    text,
    /เจ้าของ(?:ห้อง|บ้าน|ทรัพย์)?\s*(?:ปล่อย(?:เช่า|ขาย)\s*)?เอง|เจ้าของโดยตรง|ปล่อย(?:เช่า|ขาย)โดยเจ้าของ|ประกาศ(?:โดย|จาก)เจ้าของ(?:ห้อง|บ้าน|ทรัพย์)?|\b(?:direct\s+)?owner(?:\s+post)?\b/giu,
    () => 'owner',
  )
  const agents = collect(
    text,
    /\bagent\s+post\b|โพสต์(?:โดย)?\s*(?:เอเจนต์|เอเจ้นต์|เอเจ้นท์|นายหน้า)|(?:เอเจนต์|เอเจ้นต์|เอเจ้นท์|นายหน้า)\s*(?:โพสต์|ประกาศ)|ประกาศ(?:โดย|จาก)(?:เอเจนต์|เอเจ้นต์|เอเจ้นท์|นายหน้า)/giu,
    () => 'agent',
  )
  const coAgents = collect(text, /\bco[- ]?agent\s+(?:post|listing|request)\b|โพสต์ร่วม(?:เอเจนต์|นายหน้า)|ร่วมปล่อย|แบ่งคอม/giu, () => 'co_agent')
  return uniqueEvidence([...owners, ...agents, ...coAgents])
}

function extractGenericMoney(text) {
  const found = [
    ...collect(
      text,
      /(?:THB|USD|฿|\$)\s*(\d[\d,]*(?:\.\d+)?)\s*(ล้าน|หมื่น|k)?/giu,
      (match) => monetaryValue(match[1], match[2]),
    ),
    ...collect(
      text,
      /(\d[\d,]*(?:\.\d+)?)\s*(ล้าน|หมื่น|k|บาท|บ\.|baht|thb|usd)\b/giu,
      (match) => monetaryValue(match[1], match[2]),
    ),
    ...collect(
      text,
      /(?:เดือนละ|monthly)\s*(?:THB|USD|฿|\$)?\s*(\d[\d,]*(?:\.\d+)?)/giu,
      (match) => plausibleUnscaledMoney(match[1]),
    ),
    ...collect(
      text,
      /(?:ราคา|price)\s*(?:แค่|เพียง|only|:|=|-)?\s*(?:THB|USD|฿|\$)?\s*(\d[\d,]*(?:\.\d+)?)\s*(ล้าน|หมื่น|k|บาท|บ\.|baht|thb|usd)?/giu,
      (match) => {
        const value = monetaryValue(match[1], match[2])
        return value != null && value >= 1_000 ? value : null
      },
    ),
    ...collect(
      text,
      /(?:ให้เช่า|ปล่อยเช่า|for\s+rent)\s*[:：=@-]?\s*(?:THB|USD|฿|\$)?\s*(\d[\d,]*(?:\.\d+)?)/giu,
      (match) => plausibleUnscaledMoney(match[1]),
    ),
  ]
  return uniqueEvidence(found)
}

function plausibleUnscaledMoney(raw) {
  const value = monetaryValue(raw)
  return value != null && value >= 1_000 ? value : null
}

function monetaryValue(raw, scaleRaw = '') {
  const base = numberValue(raw)
  if (base == null) return null
  const scale = String(scaleRaw || '').toLowerCase()
  if (scale === 'ล้าน') return Math.round(base * 1_000_000)
  if (scale === 'หมื่น') return Math.round(base * 10_000)
  if (scale === 'k') return Math.round(base * 1_000)
  return Math.round(base)
}

function hasMoneyEvidence(quote) {
  return /฿|\$|บาท|\b(?:thb|usd)\b|ล้าน|หมื่น|\d\s*k\b|(?:\/|ต่อ)\s*(?:เดือน|month|mth)/iu.test(quote)
}

function extractProjectCandidates(text) {
  const forbidden = /^(?:เลี้ยงสัตว์ได้|รับสัตว์เลี้ยง|ห้องสวย|พร้อมอยู่|ราคาดี|ใกล้\s*(?:bts|mrt)|ทองหล่อ|สุขุมวิท)$/iu
  const patterns = [
    // A standalone first line is not evidence of a project name. Facebook
    // posts commonly start with language labels, agent notes, or promotional
    // copy. Require a project/property context or a structured heading.
    /^([^|\n]{2,100}?)\s*\|/gimu,
    /(?:^|\|)\s*([^|\n]{2,100}?)\s*(?=\|)/gimu,
    // Common marketplace headings: "For Rent | Project Name" and
    // "PROJECT NAME — 2 bed ...".  These require structure; a bare first
    // line is still deliberately not accepted.
    /(?:for\s+(?:rent|sale)|ให้เช่า|ขาย)\s*\|\s*([^|\n]{2,100})/gimu,
    /^([\p{L}][\p{L}\p{M}\p{N} '@&().\- ]{2,80}?)\s+[–—]\s*(?=(?:\d+(?:\.\d+)?\s*(?:bed|ห้องนอน)|for\s+(?:rent|sale)|ให้เช่า|ขาย|ราคา))/gimu,
    /pet[- ]?friendly\s+(?:condo|apartment|residence)\s*[-–—:]\s*([^|\n]{2,100})/gimu,
    /(?:หมู่บ้าน|โครงการ)\s*[:：-]?\s*([^\n|•]{2,80})/gimu,
    /^(?:pet[- ]?friendly\s+)?(?:condo|apartment|house)?\s*for\s+rent\s*[-–—:|]\s*([^|\n]{2,100})/gimu,
    /(?:โครงการ|project)\s*[:：-]\s*([^\n|•]{2,80})/giu,
    /(?:ให้เช่า|ปล่อยเช่า|for\s+rent)\s*(?:[,：:|–—-]\s*)?([\p{L}][\p{L}\p{M}\p{N} '&().–—-]{2,100}?)(?=\s*(?:\||ราคา|ค่าเช่า|rent|pet[- ]?friendly|ห้อง|ชั้น|ขนาด|\d+\s*(?:นอน|น้ำ|bed|ห้องนอน|ตร\.?\s*ม|sqm))|[.\n]|$)/gimu,
    /(?:คอนโด)?(?:เลี้ยงสัตว์ได้|pet[- ]?friendly)[^\n]*\n\s*([\p{L}][\p{L}\p{M}\p{N} '&().–—-]{2,80})/gimu,
    /(?:condo\s+for\s+rent|คอนโด(?:ให้เช่า|ปล่อยเช่า))[^\n]*\n\s*([^\n|•]{2,80})/giu,
    /(?:brand\s+new[^\n]*\bfor\s+rent)[^\n]*\n\s*([^\n|•]{2,80})/giu,
    /(?:ขาย\/ให้เช่าคอนโด|ปล่อย(?:ขาย|เช่า)คอนโด|ให้เช่าคอนโด|คอนโด|condo)\s+([^\n|•]{2,100}?)(?=\s+(?:ห้อง|ชั้น|ราคา|ค่าเช่า|ขนาด|พร้อม|ใกล้|studio|\d+\s*(?:bed|ห้องนอน|ตร\.?\s*ม|sqm))|$)/giu,
    /^([\p{L}][\p{L}\p{M}\p{N} '&().–—-]{2,100}?)\s*(?:[:：|,-]|–|—)?\s*(?=for\s+(?:rent|sale)|ปล่อย(?:เช่า|ขาย)|ขาย|ให้เช่า)/gimu,
    /(?:for\s+(?:rent|sale))\s*[,：:|–—-]?\s*([\p{L}][\p{L}\p{M}\p{N} '&().–—-]{2,100}?)(?=\s+(?:ห้อง|ชั้น|ราคา|price|size|studio|\d+\s*(?:นอน|น้ำ|bed|ห้องนอน|sqm))|[.\n]|$)/gimu,
    /(?:ให้เช่าคอนโด|ปล่อยเช่าคอนโด)[^#\n]{0,80}#([\p{L}][\p{L}\p{M}\p{N}_-]{3,60})/gimu,
  ]
  const found = []
  for (const regex of patterns) {
    for (const match of text.matchAll(regex)) {
      const value = cleanProjectCandidate(match[1])
      if (
        !value
        || forbidden.test(value)
        || /เลี้ยงสัตว์ได้|รับสัตว์เลี้ยง|pet[- ]?friendly|pets?\s+allowed/iu.test(value)
        || isGenericProjectCandidate(value)
      ) continue
      const start = match.index + match[0].lastIndexOf(match[1])
      found.push({
        quote: match[1],
        start,
        end: start + match[1].length,
        value,
        source: 'rule',
        rank: projectCandidateRank(value, start),
      })
    }
  }
  return uniqueEvidence(found)
    .sort((a, b) => b.rank - a.rank || a.start - b.start)
    .map(({ rank: _rank, ...item }) => item)
}

function cleanProjectCandidate(raw) {
  return String(raw || '')
    .trim()
    .replace(/\s{2,}/g, ' ')
    .replace(/\s*\|.*$/u, '')
    .replace(/\s*\.{2,}\s*(?:ดูเพิ่มเติม|ดูน้อยลง).*$/iu, '')
    .replace(/\s+(?:by|จาก)\s+[\p{L}\p{N} .&'-]+$/iu, '')
    .replace(/\s*\((?:pet[- ]?friendly|เลี้ยงสัตว์ได้)[^)]*\)\s*$/iu, '')
    .replace(/\s+#(?:PF)?\d+\b.*$/iu, '')
    .replace(/\s+#?pet[- ]?friendly\b.*$/iu, '')
    .replace(/\s+(?:เลี้ยงสัตว์(?:ได้|เปิดเผย)|สามารถเลี้ยงสัตว์ได้).*$/iu, '')
    .replace(/\s+(?:bts|mrt|arl)\b.*$/iu, '')
    .replace(/(?<=\d)\s?(?:bts|mrt|arl)\s+.*$/iu, '')
    .replace(/\s+ถนน.*$/iu, '')
    .replace(/,\s*[A-Za-zก-๙].*$/u, '')
    .replace(/\s+(?:ready\s+to\s+move\s+in|beautiful\s+\d|on\s+the\s+\d|near\b|\(owner\s+post\)).*$/iu, '')
    .replace(/\s*[-:：–—]\s*for\s+(?:rent|sale)\b.*$/iu, '')
    .replace(/\s+(?:pet[- ]?friendly|ราคา|ค่าเช่า|rent)\b.*$/iu, '')
    .replace(/^(?:ให้เช่า|ปล่อยเช่า|for\s+rent)\s*[,：:|–—-]?\s*/iu, '')
    .replace(/^(?:for\s+(?:rent|sale)|ให้เช่า|ขาย)\s*\|\s*/iu, '')
    .replace(/^rent\s+condo\s*[:：-]?\s*/iu, '')
    .replace(/^บ้านเดี่ยว\s+โครงการ\s*/iu, '')
    .replace(/^หมู่บ้าน\s*/iu, '')
    .replace(/^(?:โครงการ|project)\s*[:：-]\s*/iu, '')
    .replace(/^คอนโด\s+/iu, '')
    .replace(/^[#|:：–—-]+\s*|\s*[|:：–—-]+$/gu, '')
    .trim()
}

export function isGenericProjectCandidate(value) {
  const normalized = value.normalize('NFKC')
  if (/^(?:ภาษาไทย|english|รับ(?:เอเจนต์|เอเจ้น|นายหน้า)|รับ\s*co[- ]?agent|เจ้าของโพสต์|owner\s+post)$/iu.test(normalized.replace(/[()[\]]/gu, '').trim())) return true
  if (/^(?:คอนโด)?(?:ติด|ใกล้)(?:\s*(?:bts|mrt|arl)\b)?$/iu.test(value)) return true
  if (/^(?:คอนโด)?(?:ติด|ใกล้)\s*(?:bts|mrt|arl|บีทีเอส|เอ็มอาร์ที|รถไฟฟ้า)/iu.test(value)) return true
  if (/^(?:รับ|ยินดีรับ|เราคือ)?\s*(?:เอเจนต์|เอเจ้นต์|เอเจ้น|เอเจ้นท์|นายหน้า)(?:โพสต์|\s|\(|$)/iu.test(value)) return true
  if (/^(?:บ้าน)?ทาวน์โฮม\s*\d*$/iu.test(value)) return true
  if (/^(?:brand\s+new\b|for\s+(?:rent|sale)|เลี้ยงสัตว์|ห้อง|พร้อม|ราคา|ใกล้|ชั้น|\d)/iu.test(value)) return true
  if (/^(?:home(?:\s|$)|house(?:\s|$)|chat(?:\s|$)|foreigner\s+welcome|maid(?:[’']s)?\s+room|location\s*:|highlights?(?:\s|$)|property\s+details?(?:\s|$))/iu.test(normalized)) return true
  if (/^(?:หาก|กรณี|หมายเหตุ|เงื่อนไข|รายละเอียด|ทำเล|ข้อมูลทรัพย์|ซอย)/u.test(normalized)) return true
  if (/\b(?:inspired apartment|in the heart of|ready to move|welcome pets?)\b/iu.test(value) && !/\b(?:residence|condo|tower|place|park|maestro|ideo|metris|life|origin)\b/iu.test(value)) return true
  if (!/\p{L}/u.test(normalized)) return true
  if (/^(?:for|rent|rental(?:\s*\(baht\))?|sale|price|location|type|code|available|now|agent\s+post|property\s+details|highlights?|hot\s+(?:deal|unit)|condo|stu|คอนโด|ประกอบด้วย|รับต่างชาติ|โครงการ)$/iu.test(normalized)) return true
  if (/^#|(?:#\p{L}[\p{L}\p{M}\p{N}_-]*\s*){2,}$/u.test(value)) return true
  if (/(?:บาท|thb|usd|\/\s*month|\/\s*เดือน|\d[\d,.]*\s*(?:ตร\.?\s*ม|sqm|bedroom|ห้องนอน))/iu.test(normalized)) return true
  if (/^(?:pet[- ]?friendly|cat[- ]?friendly|luxury|beautiful|ready|next\s+to|located|looking|fully\s+furnished|new(?:ly)?\b|owner\b|spacious\b)\b/iu.test(normalized)) return true
  if (/^(?:bts|mrt|arl)\b/iu.test(normalized)) return true
  if (/^[•*#]|(?:contact|line|โทร|สนใจ|รายละเอียด|เฟอร์นิเจอร์|เครื่องใช้ไฟฟ้า)\b/iu.test(normalized)) return true
  return false
}

function projectCandidateRank(value, start) {
  let rank = Math.max(0, 60 - Math.min(start, 60))
  if (start === 0) rank += 45
  if (/\b(?:condo|residence|tower|place|park|parc|maestro|ideo|metris|life|origin)\b/iu.test(value)) rank += 12
  if (/คอนโด|โครงการ|เรสซิเดนซ์|เรสซิเดนท์/iu.test(value)) rank += 10
  if (value.length > 70) rank -= 20
  if (/\b(?:located|next to|ready|move|beautiful|luxury|home|house)\b/iu.test(value)) rank -= 12
  return rank
}

function uniqueEvidence(items) {
  const seen = new Set()
  return items.filter((item) => {
    const key = `${item.start}:${item.end}:${item.value}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
