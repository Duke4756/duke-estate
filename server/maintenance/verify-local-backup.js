import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const ROOT = path.resolve(import.meta.dirname, '../..')
const BACKUP_ROOT = path.join(ROOT, 'server/backups')

async function sha256(filePath) {
  const hash = crypto.createHash('sha256')
  const handle = await fs.open(filePath, 'r')
  try {
    for await (const chunk of handle.createReadStream()) hash.update(chunk)
  } finally {
    await handle.close()
  }
  return hash.digest('hex')
}

function assertInsideBackupRoot(candidate) {
  const relative = path.relative(BACKUP_ROOT, candidate)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Backup path must be a directory inside server/backups')
  }
}

async function latestBackup() {
  const entries = await fs.readdir(BACKUP_ROOT, { withFileTypes: true })
  const names = entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => entry.name)
    .sort()
  if (names.length === 0) throw new Error('No backup found')
  return path.join(BACKUP_ROOT, names.at(-1))
}

export async function verifyLocalBackup(requestedPath) {
  const backupDir = requestedPath
    ? path.resolve(ROOT, requestedPath)
    : await latestBackup()
  assertInsideBackupRoot(backupDir)

  const manifest = JSON.parse(await fs.readFile(path.join(backupDir, 'manifest.json'), 'utf8'))
  const failures = []
  let bytes = 0

  for (const file of manifest.files) {
    const filePath = path.resolve(backupDir, file.path)
    const relative = path.relative(backupDir, filePath)
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      failures.push({ path: file.path, reason: 'unsafe_path' })
      continue
    }
    try {
      const stat = await fs.stat(filePath)
      const checksum = await sha256(filePath)
      bytes += stat.size
      if (stat.size !== file.bytes || checksum !== file.sha256) {
        failures.push({ path: file.path, reason: 'checksum_or_size_mismatch' })
      }
    } catch {
      failures.push({ path: file.path, reason: 'missing' })
    }
  }

  return {
    ok: failures.length === 0,
    backup: path.relative(ROOT, backupDir),
    files: manifest.files.length,
    bytes,
    failures,
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  const result = await verifyLocalBackup(process.argv[2])
  process.stdout.write(`${JSON.stringify(result)}\n`)
  if (!result.ok) process.exitCode = 1
}
