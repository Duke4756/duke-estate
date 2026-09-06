import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const LOG_FILE = path.join(__dirname, 'autopost', 'supervisor.log')
const PORT = Number(process.env.PORT) || 8787
const SUPERVISOR_LOCK_PORT = Number(process.env.AUTOPOST_SUPERVISOR_LOCK_PORT) || 18787
const HEALTH_INTERVAL_MS = 15_000
const HEALTH_TIMEOUT_MS = 5_000
// /api/health is deliberately browser-free and must remain responsive during
// a Facebook publish. Waiting ten minutes left the UI unable to import rooms;
// recover a wedged event loop within two minutes instead.
const MAX_FAILURES = 8
const CONNECTION_FAILURES = 3

let child = null
let stopping = false
let failures = 0
let startedAt = 0
let restartTimer = null

function log(message) {
  const line = `${new Date().toISOString()} ${message}`
  console.log(`  [watchdog] ${message}`)
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true })
  fs.appendFileSync(LOG_FILE, `${line}\n`)
}

function startBackend() {
  if (stopping || child) return
  startedAt = Date.now()
  failures = 0
  child = spawn(process.execPath, [path.join(__dirname, 'index.js')], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, APP_ROLE: 'autopost', PORT: String(PORT) },
    stdio: 'inherit',
  })
  log(`เปิด backend PID ${child.pid} ที่พอร์ต ${PORT}`)
  child.once('exit', (code, signal) => {
    const lifetime = Date.now() - startedAt
    log(`backend หยุด (code=${code ?? '-'}, signal=${signal ?? '-'}, อายุ=${Math.round(lifetime / 1000)} วินาที)`)
    child = null
    if (stopping) return process.exit(0)
    restartTimer = setTimeout(startBackend, lifetime < 10_000 ? 5_000 : 1_000)
  })
}

function healthCheck() {
  if (!child || stopping || Date.now() - startedAt < 20_000) return
  const request = http.get({ hostname: '127.0.0.1', port: PORT, path: '/api/health', timeout: HEALTH_TIMEOUT_MS }, (response) => {
    response.resume()
    if (response.statusCode === 200) {
      failures = 0
      return
    }
    recordFailure(`HTTP ${response.statusCode}`)
  })
  request.once('timeout', () => request.destroy(new Error('health timeout')))
  request.once('error', (error) => recordFailure(error.message))
}

function recordFailure(reason) {
  failures += 1
  // Posting is not a reason to tolerate an unresponsive API. The publisher
  // persists a submitted receipt before verification, so restarting is safe:
  // pre-submit work is requeued and post-submit work is never published twice.
  const limit = /ECONNREFUSED|socket hang up|connect/i.test(reason) ? CONNECTION_FAILURES : MAX_FAILURES
  log(`health ไม่ตอบ ${failures}/${limit}: ${reason}`)
  if (failures < limit || !child) return
  failures = 0
  const stuck = child
  log(`รีสตาร์ต backend PID ${stuck.pid} เพราะค้าง`)
  stuck.kill('SIGTERM')
  setTimeout(() => {
    if (child === stuck) stuck.kill('SIGKILL')
  }, 5_000).unref()
}

function shutdown(signal) {
  if (stopping) return
  stopping = true
  if (restartTimer) clearTimeout(restartTimer)
  log(`ปิด watchdog ด้วย ${signal}`)
  if (!child) return process.exit(0)
  const closingChild = child
  closingChild.kill('SIGTERM')
  // Keep this timer referenced. launchd may terminate the supervisor while
  // Playwright has wedged Node's normal signal handling; leaving early orphaned
  // the backend and kept port 8787 occupied forever.
  setTimeout(() => {
    if (child === closingChild) closingChild.kill('SIGKILL')
  }, 2_000)
  // launchd's ExitTimeOut is five seconds. Finish before that deadline so it
  // cannot kill the supervisor first and orphan the listening backend.
  setTimeout(() => process.exit(0), 3_000)
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('uncaughtException', (error) => log(`watchdog error: ${error.stack || error.message}`))

// A TCP lock has no stale-file failure mode: the OS releases it automatically
// when the process exits. This prevents a terminal-launched watchdog and the
// launchd watchdog from repeatedly starting competing backends.
const instanceLock = net.createServer()
instanceLock.once('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    log(`มี watchdog ตัวอื่นทำงานอยู่แล้วที่ lock port ${SUPERVISOR_LOCK_PORT} · ปิดตัวซ้ำ`)
    process.exit(0)
  }
  log(`เปิด watchdog lock ไม่สำเร็จ: ${error.message}`)
  process.exit(1)
})
instanceLock.listen(SUPERVISOR_LOCK_PORT, '127.0.0.1', () => {
  startBackend()
  setInterval(healthCheck, HEALTH_INTERVAL_MS).unref()
})
