import { describe, expect, it } from 'vitest'
import {
  isSafeProjectBackfill,
  isSuspiciousStoredProject,
} from '../../server/migrations/backfill-project-names.js'

describe('project-name backfill safety', () => {
  it('recognizes missing and clearly polluted stored names', () => {
    expect(isSuspiciousStoredProject(null)).toBe(true)
    expect(isSuspiciousStoredProject('#CondoForRent ดูน้อยลง')).toBe(true)
    expect(isSuspiciousStoredProject('Maestro 39 Sukhumvit')).toBe(false)
  })

  it('accepts an evidenced project heading and rejects marketing/location guesses', () => {
    const raw = 'For Rent | COCO PARC Rama 4\nRent 75,000 THB/month'
    expect(isSafeProjectBackfill(raw, {
      project_name_raw: 'COCO PARC Rama 4',
      evidence: [{ field: 'project_name_raw', quote: 'COCO PARC Rama 4' }],
    })).toBe(true)
    expect(isSafeProjectBackfill('For Rent\nM Jatujak', {
      project_name_raw: 'M Jatujak',
      evidence: [{ field: 'project_name_raw', quote: 'M Jatujak' }],
    })).toBe(true)
    expect(isSafeProjectBackfill('Stu | Yen-Akat | 35K', {
      project_name_raw: 'Yen-Akat',
      evidence: [{ field: 'project_name_raw', quote: 'Yen-Akat' }],
    })).toBe(false)
    expect(isSafeProjectBackfill('Owner Post | 35,000 THB', {
      project_name_raw: 'Owner Post',
      evidence: [{ field: 'project_name_raw', quote: 'Owner Post' }],
    })).toBe(false)
  })
})
