// @ts-nocheck -- AJV performs the authoritative runtime narrowing in this module.
import Ajv from 'ajv'

export const OWNER_POST_TYPES = [
  'owner_rent', 'owner_sale', 'agent_listing', 'co_agent_listing',
  'tenant_requirement', 'buyer_requirement', 'multiple_listings',
  'irrelevant', 'unknown',
]
export const OWNER_PROPERTY_TYPES = ['condominium', 'apartment', 'house', 'townhome', 'commercial', 'land', 'unknown']
export const ROOM_VARIANTS = ['studio', 'standard', 'plus', 'unknown']
export const LAYOUT_TYPES = ['standard', 'duplex', 'loft', 'double_volume', 'penthouse', 'unknown']
export const PET_STATUSES = [
  'allowed', 'not_allowed', 'case_by_case', 'owner_allowed_building_unknown',
  'needs_verification', 'unknown',
]

const nullableString = { anyOf: [{ type: 'string' }, { type: 'null' }] }
const nullableNumber = { anyOf: [{ type: 'number' }, { type: 'null' }] }
// Gemini requires an explicit scalar type for enum constraints to be enforced.
// AJV accepts an enum without it, but Gemini may otherwise return synonyms such
// as "owner" or "condo" instead of the canonical values below.
const enumValue = (values) => ({ type: 'string', enum: values })
const field = (value) => ({
  type: 'object',
  additionalProperties: false,
  required: ['value', 'confidence', 'evidence', 'conflict'],
  properties: {
    value,
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    evidence: { type: 'array', items: { type: 'string', minLength: 1 } },
    conflict: { anyOf: [{ type: 'string' }, { type: 'null' }] },
  },
})

export const ownerListingExtractionSchema = {
  $id: 'owner-listing-extraction-v1',
  type: 'object',
  additionalProperties: false,
  required: ['post_type', 'listing', 'warnings'],
  properties: {
    post_type: field(enumValue(OWNER_POST_TYPES)),
    listing: {
      anyOf: [
        { type: 'null' },
        {
          type: 'object',
          additionalProperties: false,
          required: [
            'property_type', 'project_name_raw', 'bedroom_count', 'bathroom_count',
            'room_variant', 'layout_type', 'area_sqm', 'rent_price_monthly',
            'sale_price', 'nearby_transit', 'pet_status', 'contact_name',
            'contact_phone',
          ],
          properties: {
            property_type: field(enumValue(OWNER_PROPERTY_TYPES)),
            project_name_raw: field(nullableString),
            bedroom_count: field(nullableNumber),
            bathroom_count: field(nullableNumber),
            room_variant: field(enumValue(ROOM_VARIANTS)),
            layout_type: field(enumValue(LAYOUT_TYPES)),
            area_sqm: field(nullableNumber),
            rent_price_monthly: field(nullableNumber),
            sale_price: field(nullableNumber),
            nearby_transit: field(nullableString),
            pet_status: field(enumValue(PET_STATUSES)),
            contact_name: field(nullableString),
            contact_phone: field(nullableString),
          },
        },
      ],
    },
    warnings: { type: 'array', items: { type: 'string' } },
  },
}

const ajv = new Ajv({ allErrors: true, strict: false })
const validate = ajv.compile(ownerListingExtractionSchema)

export function validateOwnerListingExtraction(rawText, result) {
  if (!validate(result)) {
    const error = new Error(`owner listing schema validation failed: ${ajv.errorsText(validate.errors)}`)
    error.code = 'SCHEMA_VALIDATION_FAILED'
    throw error
  }
  const postType = result.post_type.value
  if (postType === 'multiple_listings' && result.listing !== null) {
    throw validationError('multiple_listings must not contain a single listing')
  }
  if (['irrelevant', 'tenant_requirement', 'buyer_requirement', 'unknown'].includes(postType) && result.listing !== null) {
    throw validationError(`${postType} must not contain an available listing`)
  }
  for (const [name, item] of Object.entries(result.listing || {})) {
    for (const quote of item.evidence) {
      if (!String(rawText || '').includes(quote)) throw validationError(`${name} evidence is not present in source text`)
    }
    if ((item.value === null || item.value === 'unknown') && item.evidence.length > 0) {
      throw validationError(`${name} cannot have evidence when its value is unknown`)
    }
  }
  for (const quote of result.post_type.evidence) {
    if (!String(rawText || '').includes(quote)) throw validationError('post_type evidence is not present in source text')
  }
  return result
}

function validationError(message) {
  const error = new Error(message)
  error.code = 'SCHEMA_VALIDATION_FAILED'
  return error
}

export function emptyOwnerListingResult(postType = 'unknown') {
  return {
    post_type: { value: postType, confidence: 0, evidence: [], conflict: null },
    listing: null,
    warnings: [],
  }
}
