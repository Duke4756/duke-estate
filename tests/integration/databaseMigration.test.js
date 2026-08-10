import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openDatabase } from '../../server/db/index.js'
import { importLegacyOwnerPosts } from '../../server/migrations/import-owner-posts-json.js'
import { verifyOwnerImport } from '../../server/migrations/verify-owner-import.js'
import { rollbackLegacyImport } from '../../server/migrations/rollback-owner-import.js'

const temporary = []
afterEach(() => {
  for (const dir of temporary.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('legacy database migration', () => {
  it('imports idempotently, verifies counts, and rolls back without changing source', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'condo-migration-'))
    temporary.push(dir)
    const sourceFile = path.join(dir, 'owner-posts.json')
    const source = {
      updatedAt: '2026-01-01T00:00:00.000Z',
      posts: [
        { identity: 'one', id: 'p1', text: 'ปล่อยเช่า 20,000 บาท/เดือน', permalink: 'https://facebook.com/groups/1/posts/1' },
        { identity: 'two', id: 'p2', text: 'ขาย 3 ล้านบาท', permalink: 'https://facebook.com/groups/1/posts/2' },
      ],
    }
    fs.writeFileSync(sourceFile, JSON.stringify(source))
    const sourceBefore = fs.readFileSync(sourceFile, 'utf8')
    const db = openDatabase(':memory:')
    expect(importLegacyOwnerPosts({ db, sourceFile })).toMatchObject({ source: 2, imported: 2, total: 2 })
    expect(importLegacyOwnerPosts({ db, sourceFile })).toMatchObject({ source: 2, imported: 0, total: 2 })
    expect(verifyOwnerImport({ db, sourceFile })).toEqual({ valid: true, source: 2, imported: 2 })
    expect(rollbackLegacyImport({ db })).toEqual({ removed: 2 })
    expect(fs.readFileSync(sourceFile, 'utf8')).toBe(sourceBefore)
    db.close()
  })
})
