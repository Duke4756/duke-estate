import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import Database from 'better-sqlite3'

const ROOT = path.resolve(import.meta.dirname, '../..')
const BACKUP_ROOT = path.join(ROOT, 'server/backups')
const SQLITE_SOURCE = path.join(ROOT, 'server/data/condo-leads.sqlite')
const COPY_SOURCES = [
  'server/owner-posts.json',
  'server/groups.json',
  'server/keywords.json',
  'server/history',
  'server/autopost',
]
const SECRET_PATTERNS = [
  /(^|\/)\.env(?:\.|$)/i,
  /(^|\/)fb-session\.json$/i,
  /(^|\/)session-[^/]+\.json$/i,
]

function isSecret(relativePath) {
  return SECRET_PATTERNS.some((pattern) => pattern.test(relativePath))
}

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

async function copyTree(sourcePath, destinationPath, relativePath, copied, excluded) {
  if (isSecret(relativePath)) {
    excluded.push({ path: relativePath, reason: 'secret_or_session' })
    return
  }

  const stat = await fs.stat(sourcePath)
  if (stat.isDirectory()) {
    await fs.mkdir(destinationPath, { recursive: true })
    const entries = await fs.readdir(sourcePath, { withFileTypes: true })
    for (const entry of entries) {
      await copyTree(
        path.join(sourcePath, entry.name),
        path.join(destinationPath, entry.name),
        path.posix.join(relativePath, entry.name),
        copied,
        excluded,
      )
    }
    return
  }

  if (!stat.isFile()) return
  await fs.mkdir(path.dirname(destinationPath), { recursive: true })
  await fs.copyFile(sourcePath, destinationPath)
  copied.push(relativePath)
}

async function fileRecord(backupDir, relativePath) {
  const filePath = path.join(backupDir, relativePath)
  const stat = await fs.stat(filePath)
  return {
    path: relativePath,
    bytes: stat.size,
    sha256: await sha256(filePath),
  }
}

async function sqliteSnapshot(destination) {
  try {
    await fs.access(SQLITE_SOURCE)
  } catch {
    return false
  }

  await fs.mkdir(path.dirname(destination), { recursive: true })
  const db = new Database(SQLITE_SOURCE, { readonly: true, fileMustExist: true })
  try {
    await db.backup(destination)
  } finally {
    db.close()
  }
  return true
}

function timestampName(now = new Date()) {
  return now.toISOString().replace(/[:.]/g, '-')
}

export async function createLocalBackup({ now = new Date() } = {}) {
  const backupName = timestampName(now)
  const temporaryDir = path.join(BACKUP_ROOT, `.${backupName}.tmp`)
  const backupDir = path.join(BACKUP_ROOT, backupName)
  const copied = []
  const excluded = [
    { path: '.env', reason: 'secret' },
    { path: 'server/fb-session.json', reason: 'facebook_session' },
  ]

  await fs.mkdir(BACKUP_ROOT, { recursive: true, mode: 0o700 })
  await fs.mkdir(temporaryDir, { recursive: true, mode: 0o700 })

  try {
    const sqliteRelative = 'server/data/condo-leads.sqlite'
    if (await sqliteSnapshot(path.join(temporaryDir, sqliteRelative))) {
      copied.push(sqliteRelative)
    }

    for (const relativePath of COPY_SOURCES) {
      const sourcePath = path.join(ROOT, relativePath)
      try {
        await fs.access(sourcePath)
      } catch {
        continue
      }
      await copyTree(
        sourcePath,
        path.join(temporaryDir, relativePath),
        relativePath,
        copied,
        excluded,
      )
    }

    copied.sort()
    const files = []
    for (const relativePath of copied) {
      files.push(await fileRecord(temporaryDir, relativePath))
    }

    const packageJson = JSON.parse(await fs.readFile(path.join(ROOT, 'package.json'), 'utf8'))
    const manifest = {
      format_version: 1,
      created_at: now.toISOString(),
      app: { name: packageJson.name, version: packageJson.version },
      files,
      excluded,
      restore_note: 'Verify checksums before manually restoring. Stop the app before replacing live files.',
    }
    await fs.writeFile(
      path.join(temporaryDir, 'manifest.json'),
      `${JSON.stringify(manifest, null, 2)}\n`,
      { mode: 0o600 },
    )
    await fs.rename(temporaryDir, backupDir)
    return { backupDir, manifest }
  } catch (error) {
    await fs.rm(temporaryDir, { recursive: true, force: true })
    throw error
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  const { backupDir, manifest } = await createLocalBackup()
  process.stdout.write(`${JSON.stringify({
    ok: true,
    backup: path.relative(ROOT, backupDir),
    files: manifest.files.length,
    bytes: manifest.files.reduce((sum, file) => sum + file.bytes, 0),
    excluded: manifest.excluded.length,
  })}\n`)
}
