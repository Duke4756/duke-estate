import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { openDatabase } from '../db/index.js'
import { createRawPostRepository } from '../db/repositories/rawPosts.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const LEGACY_FILE = path.join(__dirname, '..', 'owner-posts.json')

/** @param {{db?: import('better-sqlite3').Database, sourceFile?: string}} [options] */
export function importLegacyOwnerPosts({ db, sourceFile = LEGACY_FILE } = {}) {
  const database = db || openDatabase()
  const ownsDb = !db
  const repository = createRawPostRepository(database)
  const data = JSON.parse(fs.readFileSync(sourceFile, 'utf8'))
  const posts = Array.isArray(data.posts) ? data.posts : []
  let imported = 0
  const transaction = database.transaction(() => {
    for (const post of posts) {
      const before = repository.count()
      repository.upsert({
        source_adapter: 'legacy_owner_json',
        source_post_id: post.id || null,
        source_url: post.permalink || null,
        source_group_name: post.group || null,
        author_name: post.author || null,
        raw_text: post.text || '',
        source_created_at: post.createdAt || null,
        collected_at: post.firstSavedAt || new Date().toISOString(),
        collector_version: 'legacy-json-v1',
        collection_warnings: ['legacy_fields_unverified'],
        legacy_identity: post.identity,
      })
      if (repository.count() > before) imported++
    }
  })
  transaction()
  const result = { source: posts.length, imported, total: repository.count() }
  if (ownsDb) database.close()
  return result
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify(importLegacyOwnerPosts(), null, 2))
}
