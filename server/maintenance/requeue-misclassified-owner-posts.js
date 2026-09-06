import { openDatabase } from '../db/index.js'
import { classifyIntent, OFFER_INTENTS } from '../pipeline/intentClassifier.js'

const apply = process.argv.includes('--apply')
const db = openDatabase()
const rows = db.prepare(`
  SELECT r.id,r.source_url,r.raw_text,c.post_intent old_intent
  FROM raw_posts r
  JOIN processing_runs pr ON pr.id=(SELECT pr2.id FROM processing_runs pr2 WHERE pr2.raw_post_id=r.id ORDER BY pr2.id DESC LIMIT 1)
  JOIN post_classifications c ON c.processing_run_id=pr.id
  WHERE r.deleted_at IS NULL AND r.source_url IS NOT NULL
    AND c.post_intent IN ('other','service_or_spam')
    AND (r.raw_text LIKE '%เจ้าของ%เอง%' OR r.raw_text LIKE '%เจ้าของ%ปล่อย%' OR lower(r.raw_text) LIKE '%owner post%')
`).all()
const candidates = rows
  .map((row) => ({ ...row, newIntent: classifyIntent(row.raw_text).intent }))
  .filter((row) => OFFER_INTENTS.has(row.newIntent))

let queued = 0
if (apply) {
  const now = new Date().toISOString()
  const insert = db.prepare(`INSERT OR IGNORE INTO post_processing_jobs(raw_post_id,job_type,status,created_at,updated_at) VALUES (?,'PROCESS_RAW_POST','PENDING',?,?)`)
  const transaction = db.transaction(() => {
    for (const row of candidates) {
      queued += insert.run(row.id, now, now).changes
      if (queued) db.prepare("UPDATE raw_posts SET ingestion_status='QUEUED' WHERE id=?").run(row.id)
    }
  })
  transaction()
}
console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', found: candidates.length, queued, examples: candidates.slice(0, 15).map((row) => ({ id: row.id, sourceUrl: row.source_url, oldIntent: row.old_intent, newIntent: row.newIntent, text: row.raw_text.slice(0, 120) })) }, null, 2))
db.close()
