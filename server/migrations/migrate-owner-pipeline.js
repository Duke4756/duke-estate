import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createPropertyDataService } from '../db/service.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const LEGACY_FILE = path.join(__dirname, '..', 'owner-posts.json')

/** @param {{service?: ReturnType<typeof createPropertyDataService>, sourceFile?: string}} [options] */
export async function migrateOwnerPipeline({ service = createPropertyDataService(), sourceFile = LEGACY_FILE } = {}) {
  const ownsService = !arguments[0]?.service
  const posts = JSON.parse(fs.readFileSync(sourceFile, 'utf8')).posts || []
  let processed = 0
  let skipped = 0
  let properties = 0
  for (const post of posts) {
    const result = await service.ingest({
      source_adapter: 'legacy_owner_pipeline',
      source_post_id: post.id || post.identity,
      source_url: post.permalink || null,
      source_group_name: post.group || null,
      author_name: post.author || null,
      raw_text: post.text || '',
      source_created_at: post.createdAt || null,
      collected_at: post.firstSavedAt || null,
      collector_version: 'legacy-json-v1',
      collection_warnings: ['legacy_fields_unverified'],
    })
    if (result.duplicate) skipped++
    else {
      processed++
      properties += result.propertyIds.length
    }
  }
  const output = { source: posts.length, processed, skipped, properties }
  if (ownsService) service.close()
  return output
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify(await migrateOwnerPipeline(), null, 2))
}
