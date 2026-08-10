import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { openDatabase } from '../db/index.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** @param {{db?: import('better-sqlite3').Database, sourceFile?: string}} [options] */
export function verifyOwnerImport({ db, sourceFile = path.join(__dirname, '..', 'owner-posts.json') } = {}) {
  const database = db || openDatabase()
  const ownsDb = !db
  const source = JSON.parse(fs.readFileSync(sourceFile, 'utf8')).posts || []
  const imported = /** @type {{count: number}} */ (database.prepare(`SELECT COUNT(*) AS count FROM raw_posts WHERE source_adapter = 'legacy_owner_json'`).get()).count
  const result = { valid: source.length === imported, source: source.length, imported }
  if (ownsDb) database.close()
  return result
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify(verifyOwnerImport(), null, 2))
}
