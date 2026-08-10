import { NORMALIZER_VERSION } from './versions.js'

const THAI_DIGITS = { '๐': '0', '๑': '1', '๒': '2', '๓': '3', '๔': '4', '๕': '5', '๖': '6', '๗': '7', '๘': '8', '๙': '9' }

export function normalizeText(rawText) {
  const raw = String(rawText || '')
  const text = raw
    .normalize('NFKC')
    .replace(/[๐-๙]/g, (digit) => THAI_DIGITS[digit])
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return { raw, text, version: NORMALIZER_VERSION }
}

export function normalizeLookup(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[๐-๙]/g, (digit) => THAI_DIGITS[digit])
    .replace(/[^a-z0-9ก-๙]+/g, '')
}
