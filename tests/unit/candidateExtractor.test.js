import { describe, expect, it } from 'vitest'
import { extractCandidates } from '../../server/pipeline/candidateExtractor.js'
import { deterministicExtract } from '../../server/pipeline/deterministicExtractor.js'

describe('candidate extractor', () => {
  it('never treats an area as a price', () => {
    const result = extractCandidates('คอนโดเลี้ยงสัตว์ได้ 3 ห้องนอน ทองหล่อ 180 ตร.ม.')
    expect(result.areas.map((item) => item.value)).toEqual([180])
    expect(result.rentPrices).toEqual([])
    expect(result.salePrices).toEqual([])
    expect(result.budgets).toEqual([])
  })

  it('keeps the currency evidence instead of assuming every price is THB', () => {
    const usd = deterministicExtract('for rent condo Project: Test Residence $550/month')
    expect(usd.properties[0].rent_price_monthly).toBe(550)
    expect(usd.properties[0].currency).toBe('USD')

    const unspecified = deterministicExtract('for rent condo Project: Test Residence 550/month')
    expect(unspecified.properties[0].currency).toBeNull()
  })

  it('reads a currency prefix before a monthly price', () => {
    const result = deterministicExtract('Rental Price\nTHB 26,000/month (Negotiable)')
    expect(result.properties[0].rent_price_monthly).toBe(26000)
    expect(result.properties[0].currency).toBe('THB')
  })

  it.each([
    ['ให้เช่า6500ทาวน์โฮม', 6500],
    ['เดือนละ 9500', 9500],
    ['HOT DEAL 44,000 THB', 44000],
    ['Price: 88,000 Baht', 88000],
  ])('reads generic rent money: %s', (text, expected) => {
    const result = deterministicExtract(`For rent ${text}`)
    expect(result.properties[0].rent_price_monthly).toBe(expected)
  })

  it('recognises prices only with monetary context', () => {
    const result = extractCandidates('ค่าเช่า 18,000 บาท/เดือน ขาย 3.5 ล้าน พื้นที่ 42 sqm')
    expect(result.rentPrices.some((item) => item.value === 18000)).toBe(true)
    expect(result.salePrices.some((item) => item.value === 3500000)).toBe(true)
    expect(result.areas[0].value).toBe(42)
  })

  it('keeps wanted budget separate from offer prices', () => {
    const result = extractCandidates('หาคอนโดเช่า งบไม่เกิน 25,000 บาท')
    expect(result.budgets[0].value).toBe(25000)
    expect(result.rentPrices).toEqual([])
  })

  it('normalizes studio to zero bedrooms', () => {
    const result = extractCandidates('ห้องสตูดิโอ 28 ตร.ม.')
    expect(result.bedrooms[0].value).toBe(0)
  })

  it.each([
    ['Owner ปล่อยเช่าเอง คอนโด Test Residence ราคา 20,000 บาท/เดือน', 'owner'],
    ['เจ้าของปล่อยเช่าเอง คอนโด Test Residence ราคา 20,000 บาท/เดือน', 'owner'],
    ['ประกาศโดยเจ้าของห้อง ให้เช่า Test Residence 20,000 บาท/เดือน', 'owner'],
    ['Agent post ให้เช่า Test Residence ราคา 20,000 บาท/เดือน', 'agent'],
    ['โพสต์โดยนายหน้า ให้เช่า Test Residence ราคา 20,000 บาท/เดือน', 'agent'],
  ])('extracts an explicit source role: %s', (text, expected) => {
    const property = deterministicExtract(text).properties[0]
    expect(property.source_role).toBe(expected)
    expect(property.evidence.find((item) => item.field === 'source_role')?.quote).toBeTruthy()
  })

  it('does not guess a source role without explicit evidence', () => {
    const property = deterministicExtract('ให้เช่า Test Residence ราคา 20,000 บาท/เดือน').properties[0]
    expect(property.source_role).toBeNull()
  })

  it('sends conflicting source-role evidence to review', () => {
    const property = deterministicExtract('Owner post แต่ประกาศโดยนายหน้า ให้เช่า 20,000 บาท/เดือน').properties[0]
    expect(property.source_role).toBeNull()
    expect(property.warnings).toContain('source_role_conflict')
  })

  it('does not treat the first standalone line as a project name', () => {
    const result = deterministicExtract('ภาษาไทย\n(รับเอเจ้น)\nให้เช่า The Saint Residences\n2 ห้องนอน 70,000 บาท/เดือน')
    expect(result.properties[0].project_name_raw).toBe('The Saint Residences')
  })

  it('rejects promotional headings without a project name', () => {
    const result = deterministicExtract('คอนโดติด BTS รัชโยธิน ใกล้ ม.เกษตรศาสตร์\nให้เช่า 12,000 บาท/เดือน')
    expect(result.properties[0].project_name_raw).toBeNull()
  })

  it.each(['เอเจ้นท์โพสต์', 'ยินดีรับ เอเจ้นต์', 'คอนโดใกล้บีทีเอส', 'บ้านทาวน์โฮม 3'])(
    'rejects generic project label: %s',
    (heading) => {
      const result = deterministicExtract(`${heading}\nให้เช่า 12,000 บาท/เดือน`)
      expect(result.properties[0].project_name_raw).toBeNull()
    },
  )

  it.each([
    ['For Rent | The Address Siam\n2 Bedrooms | 50,000 บาท/เดือน', 'The Address Siam'],
    ['URBANO ABSOLUTE SATHON-TAKSIN — 2 Bed For Rent 35,000 บาท/เดือน', 'URBANO ABSOLUTE SATHON-TAKSIN'],
    ['หมู่บ้าน Indy4 บางนา\nให้เช่า 25,000 บาท/เดือน', 'Indy4 บางนา'],
  ])('extracts structured project heading: %s', (text, expected) => {
    expect(deterministicExtract(text).properties[0].project_name_raw).toBe(expected)
  })

  it('cleans repeated names and Facebook expansion text', () => {
    expect(deterministicExtract('ให้เช่า Aspire Sukhumvit - Onnut Aspire Sukhumvit - Onnut\n20,000 บาท/เดือน').properties[0].project_name_raw).toBe('Aspire Sukhumvit - Onnut')
    expect(deterministicExtract('ให้เช่า The Line Sukhumvit ดูน้อยลง\n20,000 บาท/เดือน').properties[0].project_name_raw).toBe('The Line Sukhumvit')
  })

  it.each([
    ['Duplex condo for rent 2 bedrooms 45,000 บาท/เดือน', 'duplex'],
    ['Penthouse for rent 3 bedrooms 120,000 บาท/เดือน', 'penthouse'],
    ['ห้องลอฟท์ให้เช่า 1 ห้องนอน 25,000 บาท/เดือน', 'loft'],
  ])('classifies room layout: %s', (text, expected) => {
    expect(deterministicExtract(text).properties[0].room_type).toBe(expected)
  })

  it('keeps a listing when studio and bedroom count conflict', () => {
    const property = deterministicExtract('ให้เช่า Studio room 23 sqm, 1 bedroom 1 bathroom 15,000 บาท/เดือน').properties[0]
    expect(property).toMatchObject({ room_type: null, bedrooms: null, bathrooms: 1, rent_price_monthly: 15000 })
    expect(property.warnings).toContain('BEDROOM_CONFLICT')
  })

  it('classifies double volume and co-agent from explicit evidence', () => {
    const property = deterministicExtract('Co-agent listing ให้เช่าห้อง Double Volume 45,000 บาท/เดือน').properties[0]
    expect(property).toMatchObject({ room_type: 'double_volume', source_role: 'co_agent' })
  })
})
