import { describe, expect, it } from 'vitest'
import { isPublishableRentalPostSet, isRentalPostSet, postSetDeal, postSetReference } from '../../server/postsets.js'

describe('rent-only post sets', () => {
  it('uses explicit JSA deal metadata', () => {
    expect(isRentalPostSet({ deal: 'rent', name: 'ห้องใหม่' })).toBe(true)
    expect(isRentalPostSet({ deal: 'sale', name: 'ให้เช่า (ข้อมูลผิด)' })).toBe(false)
  })

  it('classifies legacy Thai post sets conservatively', () => {
    expect(postSetDeal({ name: 'ให้เช่า ไอดีโอ', text: 'ราคาเช่า 18,000 บาท' })).toBe('rent')
    expect(postSetDeal({ name: 'ขาย คอนโด', text: 'ราคาขาย 4,000,000 บาท' })).toBe('sale')
    expect(isRentalPostSet({ name: 'ห้องใหม่ที่ไม่ระบุประเภท' })).toBe(false)
  })

  it('requires a real Ref/CD before an automatic rental can publish', () => {
    expect(postSetReference({ text: 'Ref No.: CD-129334' })).toBe('CD-129334')
    expect(isPublishableRentalPostSet({ deal: 'rent', name: 'ให้เช่า · 155303', text: 'Ref No.: -' })).toBe(false)
    expect(isPublishableRentalPostSet({ deal: 'rent', text: 'Ref No.: SH-005924' })).toBe(true)
  })
})
