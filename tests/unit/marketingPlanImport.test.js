import { describe, it, expect, vi } from 'vitest'
import { importMarketingProperty, marketingPropertyStatus } from '../../server/marketingPlanImport.js'
import { buildPlanPlacements, parseMarketingPlan } from '../../server/aiMarketingPlan.js'

function setup() {
  const stock = []
  const deps = {
    listSets: () => stock,
    resolveJsaPropertyUrlByCd: vi.fn(async (cd) => `https://www.jsa.co.th/admin/property/view/${cd}`),
    importPostSetFromUrl: vi.fn(async (url) => {
      const postset = { id: `ps_${stock.length}`, name: `ทรัพย์ ${url.split('/').pop()}`, sourceUrl: url }
      stock.push(postset)
      return { postset }
    }),
  }
  return deps
}
describe('NEED_IMPORT Apply flow', () => {
  it('resolves the URL, uses shared import/save, verifies stock and creates one placement', async () => {
    const deps = setup()
    const result = await importMarketingProperty('CD-128936', deps)
    expect(deps.resolveJsaPropertyUrlByCd).toHaveBeenCalledWith('CD-128936')
    expect(deps.importPostSetFromUrl).toHaveBeenCalledWith(result.jsaUrl)
    expect(result).toMatchObject({ resolve: 'OK', import: 'OK', error: null })
    expect(deps.listSets()).toContainEqual(result.postSet)
    const item = parseMarketingPlan({ version: 1, properties: [{ cd: 'CD-128936', groupTags: ['EXPAT'], placements: 1 }] }).properties[0]
    const placements = buildPlanPlacements({ ...item, postSetId: result.postSet.id }, [{ id: 'g', url: 'https://facebook.com/groups/g', marketingTags: ['EXPAT'] }], ['a'], () => 'MEMBER')
    expect(placements.placements).toHaveLength(1)
  })
  it('keeps partial success and reports the actual resolve failure without importing that CD', async () => {
    const deps = setup()
    deps.resolveJsaPropertyUrlByCd.mockRejectedValueOnce(Object.assign(new Error('JSA login required'), { code: 'JSA_LOGIN_REQUIRED' }))
    const failed = await importMarketingProperty('CD-128935', deps)
    const success = await importMarketingProperty('CD-128936', deps)
    expect(failed).toMatchObject({ postSet: null, resolve: 'FAILED', import: 'NOT_ATTEMPTED', error: { code: 'JSA_LOGIN_REQUIRED', message: 'JSA login required' } })
    expect(success.import).toBe('OK')
    expect(deps.importPostSetFromUrl).toHaveBeenCalledTimes(1)
  })
  it('reports importer failures and a saved record missing the requested CD', async () => {
    const deps = setup()
    deps.importPostSetFromUrl.mockRejectedValueOnce(new Error('download failed'))
    expect(await importMarketingProperty('CD-128936', deps)).toMatchObject({ resolve: 'OK', import: 'FAILED', postSet: null, error: { message: 'download failed' } })
    deps.importPostSetFromUrl.mockResolvedValueOnce({ postset: { id: 'not-saved' } })
    expect(await importMarketingProperty('CD-128936', deps)).toMatchObject({ postSet: null, error: { code: 'POST_SET_VERIFY_FAILED' } })
  })
})

it('reuses stock without resolving or importing', async () => {
  const deps = setup()
  deps.listSets().push({ id: 'existing', name: 'CD-128936' })
  expect((await importMarketingProperty('CD-128936', deps)).postSet.id).toBe('existing')
  expect(deps.resolveJsaPropertyUrlByCd).not.toHaveBeenCalled()
})
it.each(['CD_NOT_FOUND', 'MULTIPLE_MATCH'])('reports %s without importing', async code => {
  const deps = setup()
  deps.resolveJsaPropertyUrlByCd.mockRejectedValueOnce(Object.assign(new Error(code), { code }))
  expect((await importMarketingProperty('CD-128936', deps)).error.code).toBe(code)
  expect(deps.importPostSetFromUrl).not.toHaveBeenCalled()
})
it.each([
  [{ projectSpecific: true, resolvedProjectId: null }, 'PROJECT_UNRESOLVED'],
  [{ matchingGroups: [] }, 'NO_MATCHING_GROUP'],
  [{ placements: [] }, 'NO_MEMBER_ACCOUNT'],
])('classifies downstream failure', (patch, status) => {
  expect(marketingPropertyStatus({ postSet: { id: 'p' }, matchingGroups: [{}], placements: [{}], requested: 1, ...patch })).toBe(status)
})
