import { pathToFileURL } from 'node:url'
import { openDatabase } from '../db/index.js'

/** @param {{db?: import('better-sqlite3').Database}} [options] */
export function rollbackLegacyImport({ db } = {}) {
  const database = db || openDatabase()
  const ownsDb = !db
  const result = database.prepare(`DELETE FROM raw_posts WHERE source_adapter = 'legacy_owner_json'`).run()
  if (ownsDb) database.close()
  return { removed: result.changes }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify(rollbackLegacyImport(), null, 2))
}
