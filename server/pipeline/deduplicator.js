import { contentHash } from './hash.js'

export function propertyFingerprint(property) {
  return [
    property.project_id || property.project_name_raw || '',
    property.transaction_type || '',
    property.area_sqm ?? '',
    property.floor ?? '',
    property.rent_price_monthly ?? property.sale_price ?? '',
    String(property.contact_phone || '').replace(/\D/g, ''),
  ].join('|').toLowerCase()
}

export function duplicateSignals(candidate, existing) {
  const reasons = []
  if (candidate.source_post_id && candidate.source_post_id === existing.source_post_id) reasons.push('source_post_id')
  if (candidate.source_url_normalized && candidate.source_url_normalized === existing.source_url_normalized) reasons.push('source_url')
  if (candidate.raw_text && existing.raw_text && contentHash(candidate.raw_text) === contentHash(existing.raw_text)) reasons.push('content_hash')
  if (hasUsefulFingerprint(candidate) && hasUsefulFingerprint(existing)
    && propertyFingerprint(candidate) === propertyFingerprint(existing)) reasons.push('property_fingerprint')
  return { duplicate: reasons.length > 0, reasons, score: Math.min(1, reasons.length * 0.3 + (reasons.includes('source_post_id') ? 0.4 : 0)) }
}

function hasUsefulFingerprint(property) {
  const hasProject = Boolean(property.project_id || property.project_name_raw)
  const discriminatorCount = [
    property.area_sqm,
    property.floor,
    property.rent_price_monthly ?? property.sale_price,
    String(property.contact_phone || '').replace(/\D/g, '') || null,
  ].filter((value) => value !== null && value !== undefined && value !== '').length
  return hasProject && discriminatorCount >= 2
}
