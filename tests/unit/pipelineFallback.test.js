import { describe, expect, it } from 'vitest'
import { processPost } from '../../server/pipeline/index.js'

describe('property extraction resilience', () => {
  it('falls back to deterministic extraction when Gemini is rate-limited', async () => {
    const output = await processPost({
      rawPost: { raw_text: 'XT Ekkamai ให้เช่า 1 ห้องนอน 30 ตร.ม. 18,500 บาท/เดือน' },
      useAI: true,
      aiOptions: {
        apiKey: 'test-key',
        fetchImpl: async () => new Response('quota exceeded', { status: 429 }),
      },
    })

    expect(output.metadata.model).toBe('deterministic-fallback')
    expect(output.result.properties).toHaveLength(1)
    expect(output.result.properties[0]).toMatchObject({ rent_price_monthly: 18500 })
    expect(output.result.properties[0].warnings).toContain('AI_FALLBACK')
  })
})
