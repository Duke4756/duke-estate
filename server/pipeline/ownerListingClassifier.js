// @ts-nocheck -- classifier output is a discriminated runtime payload.
import { contentHash } from './hash.js'
import { evaluateOwnerRules } from './ownerRuleEngine.js'

const cache = new Map()
const ACCEPTED = new Set(['owner_rent', 'owner_sale', 'agent_listing', 'co_agent_listing'])

export function classifyOwnerListingPost(post, rules = null) {
  const text = String(post.text || '')
  const key = `owner_listing:${rules?.loadedAt || 'defaults'}:${contentHash(text)}`
  const cached = cache.get(key)
  if (cached) return { ...post, ...cached, classificationCached: true }
  const ruleResult = evaluateOwnerRules(post, rules || {})
  const classification = classifyText(text)
  const result = {
    category: classification.value,
    confidence: classification.confidence,
    reason: classification.reason,
    classification: {
      value: classification.value,
      confidence: classification.confidence,
      evidence: classification.evidence,
      conflict: classification.conflict,
      ruleScore: ruleResult.score,
      ruleThreshold: ruleResult.threshold,
      ruleEvidence: ruleResult.evidence,
    },
    acceptedOwner: ACCEPTED.has(classification.value),
  }
  cache.set(key, result)
  return { ...post, ...result, classificationCached: false }
}

export function classifyOwnerListingPosts(posts, rules = null) {
  return { leads: posts.map((post) => classifyOwnerListingPost(post, rules)), classifier: 'rule_score+owner_listing' }
}

export function clearOwnerClassificationCache() {
  cache.clear()
}

function classifyText(text) {
  const evidence = (regex) => text.match(regex)?.[0] || null
  const many = evidence(/(?:หลายห้อง|หลายยูนิต|หลายรายการ|ห้องที่\s*\d|unit\s*\d)[\s\S]*(?:ห้องที่\s*\d|unit\s*\d)/iu)
  if (many) return hit('multiple_listings', 0.92, many, 'พบหลายทรัพย์ในโพสต์เดียว')
  const coAgent = evidence(/co[- ]?agent|รับเอเจนต์|รับนายหน้า|แบ่งคอม|ร่วมปล่อย|accept agents?/iu)
  if (coAgent) return hit('co_agent_listing', 0.9, coAgent, 'ประกาศเปิดรับเอเจนต์หรือแบ่งคอมมิชชัน')
  const agent = evidence(/agent\s*post|เอเจนต์โพสต์|นายหน้าโพสต์|ประกาศโดย(?:เอเจนต์|นายหน้า)/iu)
  if (agent) return hit('agent_listing', 0.9, agent, 'ระบุว่าเป็นประกาศจากเอเจนต์')
  const wantedRent = evidence(/(?:หา|ต้องการ|มองหา|อยาก|ขอ)เช่า|หาห้อง|หาคอนโด|looking\s+(?:to\s+rent|for.*rent)/iu)
  if (wantedRent) return hit('tenant_requirement', 0.88, wantedRent, 'เป็นความต้องการเช่า ไม่ใช่ห้องว่าง')
  const wantedBuy = evidence(/(?:หา|ต้องการ|มองหา|อยาก|รับ)ซื้อ|looking\s+(?:to\s+buy|for.*buy)/iu)
  if (wantedBuy) return hit('buyer_requirement', 0.88, wantedBuy, 'เป็นความต้องการซื้อ')
  const owner = evidence(/เจ้าของ(?:ห้อง|บ้าน|ทรัพย์)?(?:ปล่อย|ให้เช่า|ขาย)?เอง|เจ้าของโดยตรง|direct\s+owner|owner\s+post/iu)
  const rent = evidence(/ปล่อยเช่า|ให้เช่า|for\s+rent|available\s+for\s+rent|ค่าเช่า|ราคาเช่า/iu)
  const sale = evidence(/ขายคอนโด|ขายห้อง|ขายบ้าน|ขายที่ดิน|for\s+sale|ราคาขาย/iu)
  if (owner && rent && sale) return hit('multiple_listings', 0.72, `${owner} · ${rent} · ${sale}`, 'มีทั้งเช่าและขาย ต้องตรวจว่าเป็นหลายรายการ', 'rent_sale_ambiguity')
  if (owner && rent) return hit('owner_rent', 0.94, `${owner} · ${rent}`, 'เจ้าของเสนอทรัพย์ให้เช่า')
  if (owner && sale) return hit('owner_sale', 0.94, `${owner} · ${sale}`, 'เจ้าของเสนอทรัพย์ขาย')
  const listing = rent || sale
  if (listing) return hit('unknown', 0.55, listing, 'เป็นประกาศทรัพย์แต่ยังยืนยันผู้ประกาศไม่ได้')
  const irrelevant = evidence(/รับทำ|บริการ|สินเชื่อ|คอร์ส|สัมมนา|ข่าว|ประชุมลูกบ้าน/iu)
  if (irrelevant) return hit('irrelevant', 0.9, irrelevant, 'ไม่ใช่ประกาศทรัพย์จากเจ้าของ')
  return { value: 'unknown', confidence: 0.35, evidence: [], conflict: null, reason: 'หลักฐานไม่เพียงพอ' }
}

function hit(value, confidence, quote, reason, conflict = null) {
  return { value, confidence, evidence: [quote], conflict, reason }
}
