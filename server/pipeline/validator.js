import AjvModule from 'ajv'
import { extractionSchema, NULLABLE_FIELDS } from './extractionSchema.js'

const Ajv = /** @type {typeof import('ajv').default} */ (/** @type {unknown} */ (AjvModule))
const ajv = new Ajv({ allErrors: true, strict: true })
const validateSchema = ajv.compile(extractionSchema)

export function validateExtraction(rawText, result) {
  const errors = []
  if (!validateSchema(result)) errors.push(...(validateSchema.errors || []).map((error) => `${error.instancePath || '/'} ${error.message}`))
  if (!result || !Array.isArray(result.properties)) return { valid: false, errors }
  for (const [index, property] of result.properties.entries()) {
    const evidenceByField = new Map()
    for (const item of property.evidence || []) {
      if (!String(rawText).includes(item.quote)) errors.push(`/properties/${index}/evidence quote not found in RAW_POST: ${item.quote}`)
      const list = evidenceByField.get(item.field) || []
      list.push(item)
      evidenceByField.set(item.field, list)
    }
    for (const field of NULLABLE_FIELDS) {
      if (property[field] != null && !(evidenceByField.get(field)?.length)) {
        errors.push(`/properties/${index}/${field} has value without evidence`)
      }
    }
    if (property.project_id && property.project_match_method === 'unverified') {
      errors.push(`/properties/${index}/project_id must be null when project is unverified`)
    }
    if (property.room_type === 'studio' && property.bedrooms !== 0) {
      errors.push(`/properties/${index}/bedrooms must be 0 for studio`)
    }
  }
  return { valid: errors.length === 0, errors }
}

export function assertValidExtraction(rawText, result) {
  const validation = validateExtraction(rawText, result)
  if (!validation.valid) {
    const error = new Error(`ผลการสกัดไม่ผ่าน schema/หลักฐาน: ${validation.errors.join('; ')}`)
    Object.assign(error, { validationErrors: validation.errors })
    throw error
  }
  return result
}
