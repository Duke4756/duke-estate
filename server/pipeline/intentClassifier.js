import { CLASSIFIER_VERSION } from './versions.js'

const RULES = [
  ['service_or_spam', /รับทำ|บริการ|ยิงแอด|สินเชื่อ|รับฝากขาย|นายหน้ารับทรัพย์|คอร์ส|สัมมนา/iu],
  ['co_agent_request', /co[- ]?agent|รับนายหน้า|รับเอเจนต์|accept agents?|แบ่งคอม|ร่วมขาย|ร่วมปล่อย/iu],
  ['wanted_buy', /(?:หา|ต้องการ|มองหา|อยาก|รับ)ซื้อ|งบซื้อ|looking\s+(?:to\s+buy|for.*buy)/iu],
  ['wanted_rent', /(?:หา|ต้องการ|มองหา|อยาก|ขอ)เช่า|หาห้อง|หาคอนโด|งบเช่า|ใครมีห้องว่าง|looking\s+(?:to\s+rent|for.*rent)/iu],
]

export function classifyIntent(rawText) {
  const text = String(rawText || '')
  const serviceMatch = text.match(RULES[0][1])
  const hasPricedOffer = /(?:thb|฿)?\s*\d[\d,.]*\s*(?:บาท|thb)?\s*(?:\/|ต่อ)\s*(?:เดือน|month)|(?:ขาย|sale|ราคา)[^\n]{0,120}?\d[\d,.]*\s*(?:m|mb|ล้าน|บาท|thb|k)/iu.test(text)
  if (serviceMatch && !hasPricedOffer) return result('service_or_spam', 0.88, serviceMatch[0])
  const hasRentOffer = /ปล่อยเช่า|ให้เช่า|ว่างให้เช่า|for rent|available for rent|ราคาเช่า|ค่าเช่า|rental?\s*price|(?:เช่า|rent(?:al)?)\s*[:：-]?\s*(?:thb|฿)?\s*\d[\d,.]*|(?:thb|฿)?\s*\d[\d,.]*\s*(?:บาท|thb)?\s*(?:\/|ต่อ)\s*(?:เดือน|month)/iu.test(text)
  const hasSaleOffer = /ขายคอนโด|ขายห้อง|ขายบ้าน|ขายที่ดิน|ขายดาวน์|for sale|quick sale|ราคาขาย|sale\s*(?:price\s*)?[:：-]?\s*(?:thb|฿)?\s*\d[\d,.]*\s*(?:m|mb|ล้าน|บาท|thb)?|ขาย[^\n]{0,120}?\d[\d,.]*\s*(?:ล้าน|บาท|thb|k)/iu.test(text)
  if (hasRentOffer && hasSaleOffer) return result('offer_rent_and_sale', 0.96, text)
  if (hasRentOffer) return result('offer_rent', 0.94, text)
  if (hasSaleOffer) return result('offer_sale', 0.94, text)
  // Service words inside a concrete priced listing (for example assistance
  // with financing) must not erase the inventory. Only service-only posts
  // reach this branch.
  if (serviceMatch) return result('service_or_spam', 0.88, serviceMatch[0])
  // A cooperation-only request has no available property. A co-agent post
  // containing a concrete rent/sale offer was already classified above and
  // is saved as inventory with source_role=co_agent.
  const coAgentMatch = text.match(RULES[1][1])
  if (coAgentMatch) return result('co_agent_request', 0.88, coAgentMatch[0])
  for (const [intent, regex] of RULES.slice(2)) {
    const match = text.match(regex)
    if (match) return result(intent, 0.88, match[0])
  }
  return { intent: 'other', confidence: 0.45, evidence: [], version: CLASSIFIER_VERSION }
}

function result(intent, confidence, quote) {
  return { intent, confidence, evidence: [{ quote }], version: CLASSIFIER_VERSION }
}

export const OFFER_INTENTS = new Set(['offer_rent', 'offer_sale', 'offer_rent_and_sale'])
