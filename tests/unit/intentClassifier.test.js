import { describe, expect, it } from 'vitest'
import { classifyIntent } from '../../server/pipeline/intentClassifier.js'

describe('intent classifier', () => {
  it.each([
    ['ปล่อยเช่าคอนโด ราคาเช่า 20,000 บาท', 'offer_rent'],
    ['ขายคอนโด ราคาขาย 3.5 ล้านบาท', 'offer_sale'],
    ['ขาย 4 ล้าน ปล่อยเช่า 20,000 บาท', 'offer_rent_and_sale'],
    ['หาคอนโดเช่า งบ 20,000', 'wanted_rent'],
    ['ต้องการซื้อคอนโด งบ 4 ล้าน', 'wanted_buy'],
    ['รับ co-agent แบ่งคอม', 'co_agent_request'],
    ['บริการรับทำความสะอาดคอนโด', 'service_or_spam'],
    ['บริการ Big Cleaning ก่อนปล่อยเช่าคอนโด', 'service_or_spam'],
    ['Owner Post | Price THB 19,000/month | 1 bedroom 32 sqm', 'offer_rent'],
    ['เจ้าของขายเอง ขาย 2 ห้องนอน ราคา 7.75 ล้านบาท', 'offer_sale'],
    ['เจ้าของขายเอง 2.09 ล้านบาท พร้อมบริการดำเนินเรื่องสินเชื่อ', 'offer_sale'],
    ['[Owner POST] ขาย 1.88 ล้าน หรือเช่า 9,500 บาทต่อเดือน', 'offer_rent_and_sale'],
  ])('%s → %s', (text, expected) => {
    expect(classifyIntent(text).intent).toBe(expected)
  })
})
