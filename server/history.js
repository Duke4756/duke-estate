// Search-round history, persisted locally as real Excel files.
// Each completed search is written to server/history/<id>.xlsx (one sheet of
// leads), with a small index.json for fast listing. Rounds can be listed,
// re-loaded (parsed back from the .xlsx), downloaded, and deleted.

import ExcelJS from 'exceljs'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DIR = path.join(__dirname, 'history')
const INDEX = path.join(DIR, 'index.json')

const COLUMNS = [
  { header: 'หมวด', key: 'category', width: 12 },
  { header: 'ผู้โพสต์', key: 'author', width: 22 },
  { header: 'กลุ่ม', key: 'group', width: 20 },
  { header: 'ข้อความ', key: 'text', width: 60 },
  { header: 'ทำเล', key: 'location', width: 20 },
  { header: 'งบ', key: 'budget', width: 14 },
  { header: 'ประเภทห้อง', key: 'roomType', width: 14 },
  { header: 'ติดต่อ', key: 'contact', width: 18 },
  { header: 'เวลาโพสต์', key: 'createdAt', width: 22 },
  { header: 'ลิงก์', key: 'permalink', width: 50 },
  { header: 'เหตุผล AI', key: 'reason', width: 40 },
]

function readIndex() {
  try {
    return JSON.parse(fs.readFileSync(INDEX, 'utf8'))
  } catch {
    return []
  }
}
function writeIndex(list) {
  fs.mkdirSync(DIR, { recursive: true })
  fs.writeFileSync(INDEX, JSON.stringify(list, null, 2))
}

export async function saveRound(leads, meta = {}) {
  fs.mkdirSync(DIR, { recursive: true })
  const id = 'hist_' + Date.now()
  const file = id + '.xlsx'

  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('leads')
  ws.columns = COLUMNS
  ws.getRow(1).font = { bold: true }
  for (const l of leads) {
    const x = l.extracted || {}
    ws.addRow({
      category: l.category || '',
      author: l.author || '',
      group: l.group || '',
      text: l.text || '',
      location: x.location || '',
      budget: x.budget || '',
      roomType: x.roomType || '',
      contact: x.contact || '',
      createdAt: l.createdAt || '',
      permalink: l.permalink || '',
      reason: l.reason || '',
    })
  }
  await wb.xlsx.writeFile(path.join(DIR, file))

  const entry = {
    id,
    file,
    savedAt: new Date().toISOString(),
    minutes: meta.minutes ?? null,
    mode: meta.mode || '',
    classifier: meta.classifier || '',
    groups: meta.groups || [],
    total: leads.length,
    renters: leads.filter((l) => l.category === 'renter').length,
  }
  const list = readIndex()
  list.unshift(entry)
  writeIndex(list)
  return entry
}

export function listRounds() {
  return readIndex()
}

export async function getRound(id) {
  const entry = readIndex().find((e) => e.id === id)
  if (!entry) return null
  const file = path.join(DIR, entry.file)
  if (!fs.existsSync(file)) return null

  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(file)
  const ws = wb.getWorksheet('leads') || wb.worksheets[0]
  // Reading an xlsx doesn't restore column keys, so address cells by 1-based
  // index matching COLUMNS order.
  const COL = {
    category: 1, author: 2, group: 3, text: 4, location: 5, budget: 6,
    roomType: 7, contact: 8, createdAt: 9, permalink: 10, reason: 11,
  }
  const cell = (row, key) => {
    const v = row.getCell(COL[key]).value
    if (v == null) return ''
    if (typeof v === 'object' && 'text' in v) return String(v.text) // hyperlink cell
    return String(v)
  }
  const leads = []
  ws.eachRow((row, i) => {
    if (i === 1) return // header
    leads.push({
      id: entry.id + '_' + i,
      category: cell(row, 'category') || 'other',
      author: cell(row, 'author'),
      group: cell(row, 'group'),
      text: cell(row, 'text'),
      createdAt: cell(row, 'createdAt'),
      permalink: cell(row, 'permalink'),
      reason: cell(row, 'reason'),
      extracted: {
        location: cell(row, 'location') || null,
        budget: cell(row, 'budget') || null,
        roomType: cell(row, 'roomType') || null,
        contact: cell(row, 'contact') || null,
      },
    })
  })
  return { meta: entry, leads }
}

export function roundFilePath(id) {
  const entry = readIndex().find((e) => e.id === id)
  if (!entry) return null
  const file = path.join(DIR, entry.file)
  return fs.existsSync(file) ? file : null
}

export function deleteRound(id) {
  const list = readIndex()
  const entry = list.find((e) => e.id === id)
  if (entry) {
    try {
      fs.unlinkSync(path.join(DIR, entry.file))
    } catch {
      /* file already gone */
    }
  }
  writeIndex(list.filter((e) => e.id !== id))
  return true
}
