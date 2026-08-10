import { describe, expect, it, vi } from 'vitest'
import { extractWithAI } from '../../server/pipeline/aiExtractor.js'
import { deterministicExtract } from '../../server/pipeline/deterministicExtractor.js'

const response = (value) => ({
  ok: true,
  json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(value) }] } }] }),
})

describe('AI extractor boundary', () => {
  it('accepts schema-valid JSON and sends candidates/dictionaries', async () => {
    const rawPost = 'ปล่อยเช่า 20,000 บาท/เดือน'
    const valid = deterministicExtract(rawPost)
    const fetchImpl = vi.fn(async () => response(valid))
    const output = await extractWithAI({
      rawPost,
      candidates: { rentPrices: [] },
      projectCandidates: [],
      transitDictionary: [],
      apiKey: 'test',
      fetchImpl,
    })
    expect(output.result).toEqual(valid)
    const request = JSON.parse(fetchImpl.mock.calls[0][1].body)
    expect(request.contents[0].parts[0].text).toContain('RAW_POST')
  })

  it('rejects unsupported values without evidence', async () => {
    const rawPost = 'ปล่อยเช่า'
    const invalid = deterministicExtract(rawPost)
    invalid.properties[0].project_name_raw = 'โครงการที่ AI เดา'
    const fetchImpl = vi.fn(async () => response(invalid))
    await expect(extractWithAI({ rawPost, candidates: {}, apiKey: 'test', fetchImpl }))
      .rejects.toThrow('ไม่ผ่าน schema/หลักฐาน')
  })
})
