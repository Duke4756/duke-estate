import { describe, expect, it } from 'vitest'
import { resolveProject } from '../../server/pipeline/projectResolver.js'

const projects = [
  { id: 'p1', canonical_name: 'The Esse Sukhumvit 36', aliases: ['ดิ เอส สุขุมวิท 36', 'Esse 36'] },
  { id: 'p2', canonical_name: 'Ideo Q Thonglor', aliases: ['ไอดีโอ คิว ทองหล่อ'] },
]

describe('project resolver', () => {
  it('resolves an exact alias', () => {
    expect(resolveProject('ดิ เอส สุขุมวิท 36', projects)).toMatchObject({
      project_id: 'p1', project_match_method: 'alias_exact', project_verified: true,
    })
  })

  it('does not verify an unknown or generic phrase', () => {
    expect(resolveProject('เลี้ยงสัตว์ได้', projects)).toMatchObject({
      project_id: null, project_match_method: 'unverified', project_verified: false,
    })
  })
})
