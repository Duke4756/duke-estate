import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { listSets } from './postsets.js'
import { loadGroupsFull } from './groups.js'
import { listAccounts } from './accounts.js'
import { groupMembershipFor } from './groupMembershipStore.js'

const HEADERS = ['cd', 'priority', 'group_tag', 'target_groups', 'rounds', 'time_start', 'time_end', 'language', 'hook']
const CD = /^CD-\d{6}$/
const STATE_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'autopost', 'campaign-csv.json')

function fields(line) {
  const out = []; let value = ''; let quoted = false
  for (let i = 0; i < line.length; i += 1) { const c = line[i]; if (c === '"' && line[i + 1] === '"') { value += '"'; i += 1 } else if (c === '"') quoted = !quoted; else if (c === ',' && !quoted) { out.push(value.trim()); value = '' } else value += c }
  out.push(value.trim()); return out
}
export function parseCampaignCsv(input) {
  const lines = String(input || '').replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.trim())
  if (!lines.length) throw new Error('CSV ว่างเปล่า')
  const header = fields(lines[0]).map((x) => x.toLowerCase())
  if (HEADERS.some((key) => !header.includes(key))) throw new Error(`CSV ต้องมีคอลัมน์: ${HEADERS.join(',')}`)
  const rows = []; const errors = []
  for (let i = 1; i < lines.length; i += 1) {
    const values = fields(lines[i]); const row = Object.fromEntries(HEADERS.map((key) => [key, values[header.indexOf(key)] || '']))
    row.cd = row.cd.toUpperCase(); row.group_tag = row.group_tag.toUpperCase(); row.priority = Number(row.priority || 999); row.target_groups = Number(row.target_groups || 1); row.rounds = Number(row.rounds || 1)
    if (!CD.test(row.cd)) errors.push(`แถว ${i + 1}: CD ไม่ถูกต้อง`)
    if (!Number.isInteger(row.target_groups) || row.target_groups < 1) errors.push(`แถว ${i + 1}: target_groups ต้องเป็นจำนวนเต็มบวก`)
    if (!Number.isInteger(row.rounds) || row.rounds < 1) errors.push(`แถว ${i + 1}: rounds ต้องเป็นจำนวนเต็มบวก`)
    rows.push(row)
  }
  return { rows, errors }
}

function normalized(rows) { return JSON.stringify(rows.map((row) => HEADERS.map((key) => row[key]))) }
function existingSet(cd, sets) { return sets.find((set) => `${set.name || ''}\n${set.text || ''}`.toUpperCase().includes(cd)) || null }
export function campaignId(rows) { return `csv_${crypto.createHash('sha256').update(normalized(rows)).digest('hex').slice(0, 16)}` }

export function previewCampaignCsv(input, { sets = listSets(), groups = loadGroupsFull(), accounts = listAccounts() } = {}) {
  const parsed = typeof input === 'object' && input.rows ? input : parseCampaignCsv(input)
  const byCd = new Map(); parsed.rows.forEach((row) => { const list = byCd.get(row.cd) || []; list.push(row); byCd.set(row.cd, list) })
  const readyAccounts = accounts.filter((account) => account.ready)
  const result = [...byCd.entries()].map(([cd, rows]) => {
    const first = rows.sort((a, b) => a.priority - b.priority)[0]; const tag = first.group_tag
    const tagExists = !tag || groups.some((group) => (group.marketingTags || []).includes(tag))
    const eligibleGroups = groups.filter((group) => group.active !== false && group.enabled !== false && (!tag || (group.marketingTags || []).includes(tag)))
    const eligibleAccounts = readyAccounts.filter((account) => eligibleGroups.some((group) => groupMembershipFor(account.id, group.url) === 'MEMBER'))
    const set = existingSet(cd, sets); const plannedPlacements = first.target_groups * first.rounds
    const status = !CD.test(cd) ? 'IMPORT_FAILED' : !tagExists ? 'NO_MATCHING_GROUP' : set ? 'READY' : 'NEED_IMPORT'
    return { cd, rows, status, postSetId: set?.id || null, existingPostSet: Boolean(set), eligibleGroups: eligibleGroups.length, eligibleAccounts: eligibleAccounts.map((a) => a.id), plannedPlacements }
  })
  return { campaignId: campaignId(parsed.rows), rows: parsed.rows, errors: parsed.errors, properties: result, summary: { rows: parsed.rows.length, cds: result.length, placements: result.reduce((n, x) => n + x.plannedPlacements, 0), ready: result.filter((x) => x.status === 'READY').length, failed: result.filter((x) => !['READY', 'NEED_IMPORT'].includes(x.status)).length } }
}

export function readAppliedCampaigns() { try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) } catch { return {} } }
export function saveAppliedCampaign(id, value) { fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true }); const all = readAppliedCampaigns(); all[id] = value; fs.writeFileSync(STATE_FILE, JSON.stringify(all, null, 2)) }
