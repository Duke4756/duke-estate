import { describe, expect, it } from 'vitest'
import { parseCampaignCsv, previewCampaignCsv, campaignId } from '../../server/campaignCsv.js'

const csv = `cd,priority,group_tag,target_groups,rounds,time_start,time_end,language,hook\nCD-129325,1,EXPAT,2,2,09:00,18:00,en,"Near BTS, ready"\nCD-129325,2,EXPAT,1,1,10:00,12:00,en,Second`
describe('campaign CSV', () => {
  it('parses and groups duplicate CDs without side effects', () => {
    const parsed = parseCampaignCsv(csv)
    expect(parsed.rows).toHaveLength(2)
    const preview = previewCampaignCsv(parsed, { sets: [{ id: 'ps1', name: 'CD-129325' }], groups: [{ url: 'g', active: true, marketingTags: ['EXPAT'] }], accounts: [{ id: 'a', ready: false }] })
    expect(preview.properties[0]).toMatchObject({ cd: 'CD-129325', status: 'READY', existingPostSet: true, plannedPlacements: 4 })
  })
  it('reports invalid CD and unknown tag', () => {
    const preview = previewCampaignCsv('cd,priority,group_tag,target_groups,rounds,time_start,time_end,language,hook\nBAD,1,MISSING,1,1,09:00,10:00,en,x', { sets: [], groups: [], accounts: [] })
    expect(preview.errors.length).toBeGreaterThan(0)
    expect(preview.properties[0].status).toBe('IMPORT_FAILED')
  })
  it('creates stable id for normalized rows', () => { expect(campaignId(parseCampaignCsv(csv).rows)).toBe(campaignId(parseCampaignCsv(csv).rows)) })
})
