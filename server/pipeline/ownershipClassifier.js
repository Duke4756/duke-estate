import { extractSourceRoleCandidates } from './candidateExtractor.js'
import { classifyIntent, OFFER_INTENTS } from './intentClassifier.js'

export function classifyOwnership(rawText, { trustedOwnerProfile = false } = {}) {
  const text = String(rawText || '')
  const roles = extractSourceRoleCandidates(text)
  const values = new Set(roles.map((item) => item.value))
  const owner = roles.find((item) => item.value === 'owner')
  const agent = roles.find((item) => item.value === 'agent' || item.value === 'co_agent')
  const intent = classifyIntent(text)

  // Direct owner authorship wins over phrases such as "ยินดีรับ Agent" or
  // "ไม่รับ Agent". Those phrases describe cooperation policy, not poster
  // identity.
  if (owner) return decision('owner', 0.99, owner.quote, 'explicit_owner')
  if (agent && !values.has('owner')) return decision(agent.value, 0.99, agent.quote, 'explicit_agent')
  if (['wanted_rent', 'wanted_buy', 'service_or_spam', 'co_agent_request'].includes(intent.intent)) {
    return decision('not_owner_listing', intent.confidence, intent.evidence[0]?.quote || '', 'intent_rule')
  }
  if (trustedOwnerProfile && OFFER_INTENTS.has(intent.intent)) {
    return decision('owner', 0.9, 'โปรไฟล์เดียวกับโพสต์ Owner ที่ยืนยันแล้ว', 'trusted_owner_profile')
  }
  return decision('uncertain', OFFER_INTENTS.has(intent.intent) ? 0.5 : 0.3, '', 'insufficient_evidence')
}

function decision(value, confidence, evidence, method) { return { value, confidence, evidence, method } }
