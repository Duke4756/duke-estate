import { describe, expect, it } from 'vitest'
import { deterministicExtract } from '../../server/pipeline/deterministicExtractor.js'
import { validateExtraction } from '../../server/pipeline/validator.js'

describe('known extraction regressions', () => {
  it('does not make pet policy a project or 180 sqm a price', () => {
    const raw = 'ปล่อยเช่า คอนโดเลี้ยงสัตว์ได้ 3 ห้องนอน ทองหล่อ 180 ตร.ม.'
    const result = deterministicExtract(raw)
    const property = result.properties[0]
    expect(property.project_name_raw).toBeNull()
    expect(property.project_id).toBeNull()
    expect(property.bedrooms).toBe(3)
    expect(property.area_sqm).toBe(180)
    expect(property.pet_policy).toBe('allowed')
    expect(property.rent_price_monthly).toBeNull()
    expect(property.sale_price).toBeNull()
    expect(property.warnings).toEqual(expect.arrayContaining(['project_name_missing', 'price_missing']))
    expect(validateExtraction(raw, result).valid).toBe(true)
  })

  it('does not create available inventory from a wanted post', () => {
    const result = deterministicExtract('หาคอนโดเช่า ทองหล่อ งบ 25,000 เลี้ยงสัตว์ได้')
    expect(result.post_intent).toBe('wanted_rent')
    expect(result.properties).toEqual([])
  })

  it('supports multiple properties in one post', () => {
    const raw = 'ปล่อยเช่า 2 ห้อง\nห้อง 1) 1 ห้องนอน 35 ตร.ม. ค่าเช่า 18,000 บาท/เดือน\nห้อง 2) 2 ห้องนอน 60 ตร.ม. ค่าเช่า 30,000 บาท/เดือน'
    const result = deterministicExtract(raw)
    expect(result.properties).toHaveLength(2)
    expect(result.properties.map((property) => property.area_sqm)).toEqual([35, 60])
  })

  it('does not split ordinary numbered feature lists into extra properties', () => {
    const raw = 'Manthana Onnut – Wongwaen 2 | Pet Friendly\n1. สัญญา 12 เดือน\n2. ประกัน 2 เดือน\nค่าเช่า 50,000 บาท/เดือน'
    const result = deterministicExtract(raw)
    expect(result.properties).toHaveLength(1)
    expect(result.properties[0].project_name_raw).toBe('Manthana Onnut – Wongwaen 2')
  })

  it('does not treat unit/type numbers as a sale price', () => {
    const result = deterministicExtract('The Strand Thonglor for sale, 1 Type 1 Price, 2 bedrooms')
    expect(result.properties[0].sale_price).toBeNull()
    expect(result.properties[0].project_name_raw).toBe('The Strand Thonglor')
  })

  it('uses a generic labelled amount as sale price only for a sale post', () => {
    const property = deterministicExtract('For Sale M Jatujak ราคา 3,800,000 บาท').properties[0]
    expect(property.sale_price).toBe(3800000)
    expect(property.rent_price_monthly).toBeNull()
  })

  it('extracts an English project heading before the offer phrase', () => {
    const result = deterministicExtract('The Strand Thonglor - For rent\n2 bedrooms 70 sqm\nRent 80,000 THB/month')
    expect(result.properties[0]).toMatchObject({
      project_name_raw: 'The Strand Thonglor',
      rent_price_monthly: 80000,
      area_sqm: 70,
    })
  })

  it('extracts a project after a Thai condo offer heading', () => {
    const result = deterministicExtract('ขาย/ให้เช่าคอนโด The Capital Ekamai-Thonglor ห้องกว้าง 1 ห้องนอน ชั้น 16 ราคาเช่า 35,000 บาท/เดือน')
    expect(result.properties[0].project_name_raw).toBe('The Capital Ekamai-Thonglor')
    expect(result.properties[0].rent_price_monthly).toBe(35000)
  })

  it('uses the project line instead of a generic marketing heading', () => {
    const raw = 'Brand New 1-Bedroom Condo for Rent |\nLife Rama 4 - Asoke\nRental Price\nTHB 26,000/month'
    const property = deterministicExtract(raw).properties[0]
    expect(property.project_name_raw).toBe('Life Rama 4 - Asoke')
    expect(property.rent_price_monthly).toBe(26000)
  })

  it('extracts a project before a colon-separated rent phrase', () => {
    const property = deterministicExtract(
      'Ideo Q Phyathai: For rent 1 bedroom, 35.5 sqm\n19,000 THB/month',
    ).properties[0]
    expect(property.project_name_raw).toBe('Ideo Q Phyathai')
    expect(property.rent_price_monthly).toBe(19000)
  })

  it('extracts projects after direct Thai and English rent headings', () => {
    const thai = deterministicExtract(
      'ให้เช่า Aspire Onnut Station | 18,000 /เดือน | 1 Bed 31.5 ตร.ม.',
    ).properties[0]
    const english = deterministicExtract(
      'For Rent\nM Jatujak (เอ็ม จตุจักร) 1 นอน 1 น้ำ 32ตรม. ราคา 19,000 บาท/เดือน',
    ).properties[0]
    expect(thai.project_name_raw).toBe('Aspire Onnut Station')
    expect(english.project_name_raw).toBe('M Jatujak (เอ็ม จตุจักร)')
  })

  it('supports unicode-styled project names and offer separators', () => {
    const styled = deterministicExtract(
      'ให้เช่า 𝐀𝐬𝐩𝐢𝐫𝐞 𝐎𝐧𝐧𝐮𝐭 𝐒𝐭𝐚𝐭𝐢𝐨𝐧 | 18,000 บาท/เดือน',
    ).properties[0]
    const separated = deterministicExtract(
      'For Rent | COCO PARC Rama 4\n2 Bedrooms\nRent: 75,000 THB/month',
    ).properties[0]
    expect(styled.project_name_raw).toBe('𝐀𝐬𝐩𝐢𝐫𝐞 𝐎𝐧𝐧𝐮𝐭 𝐒𝐭𝐚𝐭𝐢𝐨𝐧')
    expect(separated.project_name_raw).toBe('COCO PARC Rama 4')
  })

  it('extracts a project after a pet-friendly heading without using the policy as its name', () => {
    const property = deterministicExtract(
      'ปล่อยเช่า คอนโดเลี้ยงสัตว์ได้\nไซบิค รามคำแหง 24\nค่าเช่า 22,000 บาท/เดือน',
    ).properties[0]
    expect(property.project_name_raw).toBe('ไซบิค รามคำแหง 24')
  })

  it('trims pet policy and developer attribution from a project candidate', () => {
    const property = deterministicExtract(
      'ให้เช่า Aspire Onnut Station by AP Thai | Pet Friendly | ค่าเช่า 18,000 บาท/เดือน',
    ).properties[0]
    expect(property.project_name_raw).toBe('Aspire Onnut Station')
  })
})
