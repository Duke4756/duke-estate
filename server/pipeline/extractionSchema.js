export const POST_INTENTS = ['offer_rent', 'offer_sale', 'offer_rent_and_sale', 'wanted_rent', 'wanted_buy', 'co_agent_request', 'service_or_spam', 'other']
export const NULLABLE_FIELDS = [
  'property_type', 'project_name_raw', 'project_id', 'project_name_canonical',
  'rent_price_monthly', 'sale_price', 'currency', 'bedrooms', 'bathrooms',
  'area_sqm', 'floor', 'building', 'zone', 'subdistrict', 'district', 'province',
  'nearby_transit', 'transit_distance_m', 'pet_policy', 'furnishing',
  'available_date', 'contact_name', 'contact_phone', 'source_role', 'room_type',
]

const nullableString = { anyOf: [{ type: 'string' }, { type: 'null' }] }
const nullableNumber = { anyOf: [{ type: 'number' }, { type: 'null' }] }
const evidenceItem = {
  type: 'object',
  additionalProperties: false,
  required: ['field', 'quote', 'confidence'],
  properties: {
    field: { type: 'string' },
    quote: { type: 'string', minLength: 1 },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
  },
}

export const extractionSchema = {
  $id: 'property-extraction-v1',
  type: 'object',
  additionalProperties: false,
  required: ['post_intent', 'post_confidence', 'properties', 'warnings'],
  properties: {
    post_intent: { enum: POST_INTENTS },
    post_confidence: { type: 'number', minimum: 0, maximum: 1 },
    warnings: { type: 'array', items: { type: 'string' } },
    properties: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'transaction_type', ...NULLABLE_FIELDS, 'project_match_method',
          'project_match_score', 'project_verified', 'evidence', 'field_confidence', 'warnings',
        ],
        properties: {
          transaction_type: { enum: ['rent', 'sale', 'rent_and_sale', 'wanted_rent', 'wanted_buy'] },
          property_type: nullableString,
          room_type: nullableString,
          project_name_raw: nullableString,
          project_id: nullableString,
          project_name_canonical: nullableString,
          project_match_method: { enum: ['alias_exact', 'canonical_exact', 'fuzzy', 'unverified', 'none'] },
          project_match_score: { type: 'number', minimum: 0, maximum: 1 },
          project_verified: { type: 'boolean' },
          rent_price_monthly: nullableNumber,
          sale_price: nullableNumber,
          currency: nullableString,
          bedrooms: nullableNumber,
          bathrooms: nullableNumber,
          area_sqm: nullableNumber,
          floor: nullableNumber,
          building: nullableString,
          zone: nullableString,
          subdistrict: nullableString,
          district: nullableString,
          province: nullableString,
          nearby_transit: nullableString,
          transit_distance_m: nullableNumber,
          pet_policy: { anyOf: [{ enum: ['allowed', 'not_allowed', 'conditional', 'unknown'] }, { type: 'null' }] },
          furnishing: nullableString,
          available_date: nullableString,
          contact_name: nullableString,
          contact_phone: nullableString,
          source_role: nullableString,
          evidence: { type: 'array', items: evidenceItem },
          field_confidence: {
            type: 'object',
            additionalProperties: { type: 'number', minimum: 0, maximum: 1 },
          },
          warnings: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  },
}
