import { describe, expect, it } from 'vitest'
import { groupSetLabel, selectGroupSet } from '../../src/groupSets.js'

const groups = [
  { url: 'general-1', category: 'general', active: true },
  { url: 'pet-1', category: 'pet', active: true },
  { url: 'pet-2', category: 'pet', active: false },
  { url: 'pet-3', category: 'pet', active: true },
  { url: 'pet-4', category: 'pet', active: true },
  { url: 'pet-5', category: 'pet', active: true },
]

describe('reusable group sets', () => {
  it('uses only active groups from the shared library', () => {
    expect(selectGroupSet(groups, 'pet', 'random')).toEqual(['pet-1', 'pet-3', 'pet-4', 'pet-5'])
  })

  it('keeps selected mode within its three-group limit', () => {
    expect(selectGroupSet(groups, 'pet', 'selected')).toEqual(['pet-1', 'pet-3', 'pet-4'])
  })

  it('provides the saved set label', () => {
    expect(groupSetLabel('owner')).toBe('เจ้าของโดยตรง')
  })
})
