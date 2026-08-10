import { describe, expect, it } from 'vitest'
import { parsePropertyHtml } from '../../server/propertyImporter.js'

describe('property URL importer parser', () => {
  it('extracts Open Graph text and deduplicates images', () => {
    const html = `<meta property="og:title" content="ขายคอนโด สุขุมวิท">
      <meta property="og:description" content="2 ห้องนอน &amp; ใกล้ BTS">
      <meta property="og:image" content="/images/room.jpg">
      <meta property="og:image" content="/images/room.jpg">`
    expect(parsePropertyHtml(html, 'https://example.com/listing/1')).toEqual({
      name: 'ขายคอนโด สุขุมวิท',
      text: 'ขายคอนโด สุขุมวิท\n\n2 ห้องนอน & ใกล้ BTS\n\nดูรายละเอียด: https://example.com/listing/1',
      imageUrls: ['https://example.com/images/room.jpg'],
    })
  })

  it('falls back to JSON-LD and skips malformed JSON-LD blocks', () => {
    const html = `<script type="application/ld+json">{broken}</script>
      <script type="application/ld+json">{"@type":"Product","name":"บ้านเดี่ยว","description":"พร้อมอยู่","image":["https://cdn.example/a.jpg"],"offers":{"price":4500000,"priceCurrency":"THB"}}</script>`
    const result = parsePropertyHtml(html, 'https://example.com/home')
    expect(result.name).toBe('บ้านเดี่ยว')
    expect(result.text).toContain('ราคา 4,500,000 บาท')
    expect(result.imageUrls).toEqual(['https://cdn.example/a.jpg'])
  })

  it('returns a usable source-only draft when optional metadata is missing', () => {
    const result = parsePropertyHtml('<html></html>', 'https://example.com/property/2')
    expect(result.name).toBe('example.com')
    expect(result.text).toContain('https://example.com/property/2')
    expect(result.imageUrls).toEqual([])
  })
})
