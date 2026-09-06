import { describe, expect, it } from 'vitest'
import { parseMarketingPlan, previewMarketingPlan, distributePlacements, parseTimeWindows, buildPlanPlacements, resolveProjectId } from '../../server/aiMarketingPlan.js'

describe('AI marketing plan', () => {
  it('validates and normalizes CD/tag input', () => {
    const plan = parseMarketingPlan({ version: 1, properties: [{ cd: ' cd-069308 ', groupTags: ['expat', 'EXPAT'] }] })
    expect(plan.properties[0]).toMatchObject({ cd: 'CD-069308', groupTags: ['EXPAT'], placements: 1, rounds: 1 })
  })
  it('resolves existing post set and tagged groups', () => {
    const plan = previewMarketingPlan({ version: 1, properties: [{ cd: 'CD-069308', groupTags: ['AC'], placements: 2 }] }, { sets: [{ id: 'p1', name: 'CD-069308' }], groups: [{ url: 'g1', marketingTags: ['AC'] }, { url: 'g2', marketingTags: ['AC'] }] })
    expect(plan.properties[0]).toMatchObject({ status: 'READY', postSetId: 'p1' })
    expect(plan.properties[0].resolvedGroups).toHaveLength(2)
  })
  it('rejects invalid schema and CD', () => {
    expect(() => parseMarketingPlan({ version: 2, properties: [] })).toThrow()
    expect(() => parseMarketingPlan({ version: 1, properties: [{ cd: 'ABC' }] })).toThrow()
  })
  it('distributes placements across rounds and parses full time windows', () => {
    expect(distributePlacements(6, 3)).toEqual([2, 2, 2])
    expect(distributePlacements(7, 3)).toEqual([3, 2, 2])
    expect(parseTimeWindows(['12:00-14:00', '18:00-21:00'])[1]).toMatchObject({ start: '18:00', end: '21:00' })
  })
  it('creates one account per placement and prioritizes project groups', () => {
    const item = parseMarketingPlan({ version: 1, properties: [{ cd: 'CD-069308', projectId: 'p1', projectSpecific: true, groupTags: ['EXPAT'], placements: 3, rounds: 2 }] }).properties[0]
    const groups = [{ id: 'project', url: 'https://facebook.com/groups/project', projectIds: ['p1'], marketingTags: ['PROJECT_SPECIFIC'] }, { id: 'tag', url: 'https://facebook.com/groups/tag', marketingTags: ['EXPAT'] }]
    const result = buildPlanPlacements({ ...item, postSetId: 'set1' }, groups, ['a1', 'a2'], () => 'MEMBER')
    expect(result.placements).toHaveLength(3)
    expect(result.placements.every((placement) => placement.accountId)).toBe(true)
    expect(result.placements[0].groupId).toBe('project')
    expect(result.rounds).toEqual([2, 1])
  })
  it('resolves project aliases without changing canonical ids', () => {
    expect(resolveProjectId({ projectId: 'p1' }, [{ id: 'p1', aliases: ['Siri Residence'] }], '')).toBe('p1')
    expect(resolveProjectId({}, [{ id: 'p1', canonical_name: 'Siri Residence', aliases: ['สิริ เรสซิเดนซ์'] }], 'ให้เช่า สิริ เรสซิเดนซ์ ห้องสวย')).toBe('p1')
  })
})
