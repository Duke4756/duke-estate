import { describe, expect, it } from 'vitest'
import { classifyGroup, findEligibleGroups } from '../../server/groupClassification.js'
describe('simple group classification', () => {
  it('maps aliases and keeps category boundaries', () => {
    expect(classifyGroup({ name: 'คอนโด อโศก พระราม9 รัชดา' })).toMatchObject({ category: 'CONDO', zone_tags: ['RAMA9_RATCHADA'] })
    expect(findEligibleGroups({ category: 'CONDO', zone_tags: ['RAMA9_RATCHADA'] }, [{ name: 'บ้านอโศก', category: 'HOUSE' }, { name: 'คอนโดอโศก พระราม9', category: 'CONDO' }])).toHaveLength(1)
  })
  it('does not guess unclear groups', () => { expect(classifyGroup({ name: 'Owner Post Bangkok' }).needsReview).toBe(true) })
  it('requires exact project for project-specific groups', () => {
    const groups = [{ name: 'The Line Sukhumvit 101 Buy Sell Rent', category: 'CONDO', project_specific: true, project_name: 'The Line Sukhumvit 101' }]
    expect(findEligibleGroups({ category: 'CONDO', project: 'Other' }, groups)).toHaveLength(0)
  })
})
