import { extractCandidates } from './candidateExtractor.js'
import { classifyIntent, OFFER_INTENTS } from './intentClassifier.js'
import { splitPropertySegments } from './propertySegments.js'

export function deterministicExtract(rawText) {
  const classification = classifyIntent(rawText)
  if (!OFFER_INTENTS.has(classification.intent)) {
    return {
      post_intent: classification.intent,
      post_confidence: classification.confidence,
      properties: [],
      warnings: classification.confidence < 0.7 ? ['intent_confidence_low'] : [],
    }
  }
  const segments = splitPropertySegments(rawText)
  const properties = segments.map((segment) => propertyFromCandidates(segment, classification.intent))
  return {
    post_intent: classification.intent,
    post_confidence: classification.confidence,
    properties,
    warnings: properties.some((property) => property.warnings.length) ? ['property_requires_review'] : [],
  }
}

function propertyFromCandidates(segment, intent) {
  const candidates = extractCandidates(segment)
  const studio = candidates.bedrooms.find((item) => /studio|สตูดิโอ/iu.test(item.quote))
  const project = candidates.projectNames[0]
  const roleCandidates = candidates.sourceRoles || []
  const roleValues = new Set(roleCandidates.map((item) => item.value))
  const sourceRole = roleValues.size === 1 ? roleCandidates[0] : null
  const fallbackMoney = candidates.moneyAmounts[0]
  const bedroomConflict = distinctValues(candidates.bedrooms).length > 1
  // A surprising number of copied listings contain both "Studio" and a
  // numbered bedroom count. Preserve the record, but leave only the
  // conflicting fields unknown instead of producing an invalid extraction.
  const roomType = bedroomConflict ? null : candidates.roomTypes?.[0] || (studio ? { ...studio, value: 'studio' } : null)
  const bathroomConflict = distinctValues(candidates.bathrooms).length > 1
  const rentConflict = distinctValues(candidates.rentPrices).length > 1
  const saleConflict = distinctValues(candidates.salePrices).length > 1
  const rentCandidate = rentConflict ? null : candidates.rentPrices[0]
    || (intent !== 'offer_sale' ? fallbackMoney : null)
  const saleCandidate = saleConflict ? null : candidates.salePrices[0]
    || (intent === 'offer_sale' ? fallbackMoney : null)
  const priceCandidate = rentCandidate || saleCandidate
  const fieldEntries = [
    ['area_sqm', candidates.areas[0]],
    ['rent_price_monthly', rentCandidate],
    ['sale_price', saleCandidate],
    ['bedrooms', bedroomConflict ? null : studio || candidates.bedrooms[0]],
    ['room_type', roomType],
    ['bathrooms', bathroomConflict ? null : candidates.bathrooms[0]],
    ['floor', candidates.floors[0]],
    ['pet_policy', candidates.petPolicies[0]],
    ['contact_phone', candidates.phones[0]],
    ['nearby_transit', candidates.transit[0]],
    ['project_name_raw', project],
    ['source_role', sourceRole],
    ['currency', priceCandidate ? { ...priceCandidate, value: currencyFromQuote(priceCandidate.quote) } : null],
  ]
  const values = Object.fromEntries(fieldEntries.map(([field, item]) => [field, item?.value ?? null]))
  const evidence = fieldEntries
    .filter(([, item]) => item)
    .map(([field, item]) => ({ field, quote: item.quote, confidence: field === 'project_name_raw' ? 0.65 : 0.95 }))
  const warnings = []
  if (!project) warnings.push('project_name_missing')
  if (!values.rent_price_monthly && !values.sale_price) warnings.push('price_missing')
  if (roleValues.size > 1) warnings.push('source_role_conflict')
  if (bedroomConflict) warnings.push('BEDROOM_CONFLICT')
  if (bathroomConflict) warnings.push('BATHROOM_CONFLICT')
  if (rentConflict || saleConflict) warnings.push('PRICE_CONFLICT')
  return {
    transaction_type: intent === 'offer_rent_and_sale' ? 'rent_and_sale' : intent === 'offer_sale' ? 'sale' : 'rent',
    property_type: null,
    room_type: values.room_type,
    project_name_raw: values.project_name_raw,
    project_id: null,
    project_name_canonical: null,
    project_match_method: project ? 'unverified' : 'none',
    project_match_score: 0,
    project_verified: false,
    rent_price_monthly: values.rent_price_monthly,
    sale_price: values.sale_price,
    currency: values.currency,
    bedrooms: values.bedrooms,
    bathrooms: values.bathrooms,
    area_sqm: values.area_sqm,
    floor: values.floor,
    building: null,
    zone: null,
    subdistrict: null,
    district: null,
    province: null,
    nearby_transit: values.nearby_transit,
    transit_distance_m: null,
    pet_policy: values.pet_policy,
    furnishing: null,
    available_date: null,
    contact_name: null,
    contact_phone: values.contact_phone,
    source_role: values.source_role,
    evidence,
    field_confidence: Object.fromEntries(evidence.map((item) => [item.field, item.confidence])),
    warnings,
  }
}

function distinctValues(items) { return [...new Set((items || []).map((item) => item.value).filter((value) => value != null))] }

function currencyFromQuote(quote) {
  if (/\$|\busd\b/iu.test(quote)) return 'USD'
  if (/฿|บาท|\bthb\b/iu.test(quote)) return 'THB'
  return null
}
