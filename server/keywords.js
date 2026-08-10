// Persistent keyword lists for the rule-based classifier. Editable from the
// UI (🏷️ Keywords modal) and saved to server/keywords.json.
//
// Default keywords live in keywords.defaults.json — edit that file to change
// the built-in list that ships with the project. User customisations are saved
// on top in keywords.json (gitignored) and take precedence per-category.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const KW_PATH      = path.join(__dirname, 'keywords.json')
const DEFAULT_PATH = path.join(__dirname, 'keywords.defaults.json')

// Load the defaults file. This is the single source of truth for built-ins.
function loadDefaults() {
  try {
    return JSON.parse(fs.readFileSync(DEFAULT_PATH, 'utf8'))
  } catch {
    // Fallback in case someone deletes the file
    return { renter: [], owner: [], seller: [] }
  }
}

export function loadKeywords() {
  const defaults = loadDefaults()
  try {
    if (fs.existsSync(KW_PATH)) {
      const data = JSON.parse(fs.readFileSync(KW_PATH, 'utf8'))
      if (data && typeof data === 'object') {
        // Current format stores the complete editable list. Keep reading the
        // old "extras" format so existing users don't lose custom words.
        if (data.keywords) return normalize(data.keywords)
        // Merge: defaults are always included; user extras are appended & deduped.
        return {
          renter: mergeUnique(defaults.renter, data.renter),
          owner:  mergeUnique(defaults.owner,  data.owner),
          seller: mergeUnique(defaults.seller, data.seller),
        }
      }
    }
  } catch {
    /* fall through to defaults only */
  }
  return { renter: [...defaults.renter], owner: [...defaults.owner], seller: [...defaults.seller] }
}

// Save the complete list edited in the UI. This makes every chip—including a
// formerly built-in one—editable without modifying a tracked source file.
export function saveKeywords(data) {
  const clean = normalize(data)
  fs.writeFileSync(KW_PATH, JSON.stringify({ keywords: clean, updatedAt: new Date().toISOString() }, null, 2))
  return clean
}

// Return the full merged list (defaults + extras) for a given saved extras object.
export function resolvedKeywords(extras) {
  const defaults = loadDefaults()
  return {
    renter: mergeUnique(defaults.renter, extras?.renter),
    owner:  mergeUnique(defaults.owner,  extras?.owner),
    seller: mergeUnique(defaults.seller, extras?.seller),
  }
}

export function getDefaults() {
  return loadDefaults()
}

// Load only the user-saved extras (without merging defaults in).
export function loadExtras() {
  try {
    if (fs.existsSync(KW_PATH)) {
      const data = JSON.parse(fs.readFileSync(KW_PATH, 'utf8'))
      if (data?.keywords) return { renter: [], owner: [], seller: [] }
      if (data && typeof data === 'object') return data
    }
  } catch { /* ignore */ }
  return { renter: [], owner: [], seller: [] }
}

// helpers
function dedupe(arr) {
  if (!Array.isArray(arr)) return []
  return [...new Set(arr.map((s) => String(s).trim().toLowerCase()).filter(Boolean))]
}
function normalize(data = {}) {
  return {
    renter: dedupe(data.renter),
    owner: dedupe(data.owner),
    seller: dedupe(data.seller),
  }
}
function mergeUnique(base, extra) {
  return dedupe([...(base || []), ...(extra || [])])
}
function extraOnly(base, full) {
  const baseSet = new Set((base || []).map((s) => s.toLowerCase()))
  return dedupe((full || []).filter((s) => !baseSet.has(s.toLowerCase())))
}
