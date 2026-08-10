import { describe, expect, it } from 'vitest'
import { preparePostText, removeFloorDetails } from '../../server/postText.js'

describe('removeFloorDetails', () => {
  it('removes standalone Thai floor lines', () => {
    expect(removeFloorDetails('ให้เช่า คอนโด A\n• ชั้น 16\n• ขนาด 35 ตร.ม.'))
      .toBe('ให้เช่า คอนโด A\n• ขนาด 35 ตร.ม.')
  })

  it('removes inline Thai and English floor details but keeps other facts', () => {
    expect(removeFloorDetails('1 ห้องนอน ชั้นที่ 24 ขนาด 40 ตร.ม.\nHigh floor, วิวเมือง\nFloor: 18 | พร้อมอยู่'))
      .toBe('1 ห้องนอน ขนาด 40 ตร.ม.\nวิวเมือง\nพร้อมอยู่')
  })

  it('also removes vague floor hints', () => {
    expect(removeFloorDetails('ห้องสวย ชั้นสูง\nพร้อมเข้าอยู่')).toBe('ห้องสวย\nพร้อมเข้าอยู่')
  })

  it('uses phone or Line contact only and removes Facebook chat prompts', () => {
    const text = preparePostText('📩 สนใจนัดชมห้อง หรือสอบถามรายละเอียดเพิ่มเติม\nทักแชท Inbox ได้เลย\n📞 Tel: 064-542-5959\n💬 Line: @duke.estate')
    expect(text).toContain('สนใจนัดชมห้อง ติดต่อ Line หรือโทรเท่านั้น (ไม่เห็นแชท Facebook)')
    expect(text).not.toContain('Inbox')
    expect(text).toContain('Tel: 064-542-5959')
    expect(text).toContain('Line: @duke.estate')
  })
})
