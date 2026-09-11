import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DEFAULT_FILE = path.join(__dirname, 'autopost', 'reliability.sqlite')

const RULES = [
  ['AUTH_SESSION_EXPIRED', /session Facebook.*หมดอายุ|checkpoint|ล็อกอินใหม่/i, false, false],
  ['GROUP_PENDING_APPROVAL', /รอการอนุมัติ|pending approval/i, false, false],
  ['GROUP_NOT_JOINED', /ยังไม่ได้เข้าร่วมกลุ่ม|not (?:a )?member/i, false, false],
  ['GROUP_POSTING_RESTRICTED', /ไม่เปิดให้.*สร้างโพสต์|only admins can post|group is paused|posting.*disabled/i, false, false],
  ['COMPOSER_NOT_FOUND', /composer|ช่องเขียน|ปุ่มเปิดช่องเขียน/i, true, true],
  ['MEDIA_UPLOAD_TIMEOUT', /รูป.*อัปโหลดไม่เสร็จ|posting.*2 นาที|ยังโพสต์ไม่เสร็จ/i, true, false],
  ['SUBMIT_BUTTON_NOT_FOUND', /ไม่พบปุ่ม ["“]?โพสต์/i, true, true],
  ['SUBMIT_BUTTON_DISABLED', /ปุ่มโพสต์ยังไม่พร้อม/i, true, true],
  ['FACEBOOK_REJECTED', /Facebook ปฏิเสธ|couldn.t post|failed to post/i, true, false],
  ['POST_ACCEPTED_NOT_DISCOVERED', /รับคำสั่งโพสต์แล้ว.*ไม่พบ permalink/i, true, false],
  ['POST_VERIFICATION_FAILED', /รับคำสั่งโพสต์แล้ว.*ตรวจไม่พบการ์ด/i, true, false],
  ['NAVIGATION_TIMEOUT', /navigation|page\.goto|timeout.*(?:เปิด|โหลด|navigation)/i, true, true],
  ['PROCESS_INTERRUPTED', /ถูกขัดจังหวะ/i, true, false],
]

export function classifyPostingError(message = '', { submitted = false } = {}) {
  const text = String(message || '')
  const rule = RULES.find(([, pattern]) => pattern.test(text))
  const [code, , retryable, safeBeforeSubmit] = rule || ['UNKNOWN_UI_STATE', null, true, true]
  return {
    code,
    retryable,
    safeToResubmit: !submitted && safeBeforeSubmit,
    fingerprint: `${code}:${text.toLowerCase().replace(/https?:\/\/\S+/g, '<url>').replace(/\d+/g, '#').replace(/\s+/g, ' ').trim().slice(0, 180)}`,
  }
}

export class AutopostReliability {
  constructor(filename = process.env.AUTOPOST_RELIABILITY_DB || DEFAULT_FILE) {
    if (filename !== ':memory:') fs.mkdirSync(path.dirname(filename), { recursive: true })
    this.db = new Database(filename)
    this.db.pragma('journal_mode = WAL')
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS posting_runs (id TEXT PRIMARY KEY,schedule_id TEXT NOT NULL,account_id TEXT NOT NULL,post_set_id TEXT,status TEXT NOT NULL,code_version TEXT,started_at TEXT NOT NULL,finished_at TEXT);
      CREATE TABLE IF NOT EXISTS posting_attempts (id TEXT PRIMARY KEY,run_id TEXT NOT NULL REFERENCES posting_runs(id) ON DELETE CASCADE,group_url TEXT NOT NULL,status TEXT NOT NULL,stage TEXT NOT NULL,submitted INTEGER NOT NULL DEFAULT 0,verified TEXT,post_url TEXT,error_code TEXT,error_message TEXT,fingerprint TEXT,retryable INTEGER,safe_to_resubmit INTEGER,started_at TEXT NOT NULL,finished_at TEXT);
      CREATE INDEX IF NOT EXISTS idx_posting_attempts_run ON posting_attempts(run_id,started_at);
      CREATE INDEX IF NOT EXISTS idx_posting_attempts_problem ON posting_attempts(fingerprint,started_at);
      CREATE TABLE IF NOT EXISTS posting_events (id INTEGER PRIMARY KEY,run_id TEXT NOT NULL,attempt_id TEXT,stage TEXT NOT NULL,status TEXT NOT NULL,message TEXT,metadata_json TEXT NOT NULL DEFAULT '{}',occurred_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_posting_events_run ON posting_events(run_id,occurred_at);
    `)
  }

  startRun({ scheduleId, accountId, postSetId = null, codeVersion = process.env.VERCEL_GIT_COMMIT_SHA || process.env.GIT_COMMIT || null }) {
    const id = `run_${randomUUID()}`
    this.db.prepare('INSERT INTO posting_runs(id,schedule_id,account_id,post_set_id,status,code_version,started_at) VALUES (?,?,?,?,?,?,?)').run(id, scheduleId, accountId, postSetId, 'RUNNING', codeVersion, new Date().toISOString())
    return id
  }
  finishRun(id, status) { this.db.prepare('UPDATE posting_runs SET status=?,finished_at=? WHERE id=?').run(status, new Date().toISOString(), id) }
  startAttempt(runId, groupUrl) {
    const id = `attempt_${randomUUID()}`
    this.db.prepare('INSERT INTO posting_attempts(id,run_id,group_url,status,stage,started_at) VALUES (?,?,?,?,?,?)').run(id, runId, groupUrl, 'RUNNING', 'STARTED', new Date().toISOString())
    this.event(runId, id, 'STARTED')
    return id
  }
  event(runId, attemptId, stage, status = 'PASSED', message = null, metadata = {}) {
    this.db.prepare('INSERT INTO posting_events(run_id,attempt_id,stage,status,message,metadata_json,occurred_at) VALUES (?,?,?,?,?,?,?)').run(runId, attemptId, stage, status, message, JSON.stringify(metadata || {}), new Date().toISOString())
    if (attemptId) this.db.prepare('UPDATE posting_attempts SET stage=? WHERE id=?').run(stage, attemptId)
  }
  finishAttempt(runId, attemptId, result = {}) {
    const status = result.ok ? 'VERIFIED' : result.pending ? 'UNCONFIRMED' : 'FAILED'
    const failure = result.ok ? null : classifyPostingError(result.error, { submitted: result.submitted === true })
    const stage = result.ok ? 'CONTENT_VERIFIED' : result.submitted ? 'VERIFICATION_PENDING' : 'FAILED'
    this.db.prepare(`UPDATE posting_attempts SET status=?,stage=?,submitted=?,verified=?,post_url=?,error_code=?,error_message=?,fingerprint=?,retryable=?,safe_to_resubmit=?,finished_at=? WHERE id=?`).run(status, stage, result.submitted ? 1 : 0, result.verified || null, result.postUrl || null, failure?.code || null, result.error || null, failure?.fingerprint || null, failure == null ? null : Number(failure.retryable), failure == null ? null : Number(failure.safeToResubmit), new Date().toISOString(), attemptId)
    this.event(runId, attemptId, stage, status, result.error || null, { errorCode: failure?.code || null, postUrl: result.postUrl || null })
    return { ...result, errorCode: failure?.code || null, safeToResubmit: failure?.safeToResubmit ?? false, attemptId }
  }
  recordVerification(attemptId, { postUrl = null, verified = null, error = null } = {}) {
    if (!attemptId) return false
    const attempt = this.db.prepare('SELECT run_id FROM posting_attempts WHERE id=?').get(attemptId)
    if (!attempt) return false
    const now = new Date().toISOString()
    if (verified === 'permalink' || postUrl) {
      const method = verified || 'permalink'
      this.db.prepare(`UPDATE posting_attempts SET status='VERIFIED',stage='CONTENT_VERIFIED',verified=?,post_url=?,error_code=NULL,error_message=NULL,fingerprint=NULL,retryable=NULL,safe_to_resubmit=0,finished_at=? WHERE id=?`).run(method, postUrl, now, attemptId)
      this.event(attempt.run_id, attemptId, 'CONTENT_VERIFIED', 'VERIFIED', null, { postUrl, verified: method, delayed: true })
    } else {
      this.event(attempt.run_id, attemptId, 'VERIFICATION_CHECKED', 'UNCONFIRMED', error)
    }
    return true
  }
  summary({ hours = 168 } = {}) {
    const parsedHours = Number(hours)
    const since = new Date(Date.now() - (Number.isFinite(parsedHours) && parsedHours > 0 ? parsedHours : 168) * 3600000).toISOString()
    const totals = this.db.prepare(`SELECT COUNT(*) attempts,SUM(status='VERIFIED') verified,SUM(status='UNCONFIRMED') unconfirmed,SUM(status='FAILED') failed FROM posting_attempts WHERE started_at>=?`).get(since)
    const incidents = this.db.prepare(`SELECT error_code code,fingerprint,COUNT(*) occurrences,MAX(error_message) message,MIN(started_at) firstSeenAt,MAX(started_at) lastSeenAt FROM posting_attempts WHERE started_at>=? AND fingerprint IS NOT NULL GROUP BY fingerprint ORDER BY occurrences DESC,lastSeenAt DESC LIMIT 20`).all(since)
    const attempts = Number(totals.attempts || 0)
    return { since, ...totals, verifiedRate: attempts ? Number(totals.verified || 0) / attempts : null, incidents }
  }
  close() { this.db.close() }
}

let singleton
export function autopostReliability() { singleton ||= new AutopostReliability(); return singleton }
