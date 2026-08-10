import { afterEach, describe, expect, it } from 'vitest'
import { openDatabase } from '../../server/db/index.js'
import { TransitStationMatcher } from '../../server/services/transitStationMatcher.js'

const databases = []
afterEach(() => databases.splice(0).forEach((db) => db.close()))
const matcher = () => { const db = openDatabase(':memory:'); databases.push(db); return new TransitStationMatcher(db) }

describe('TransitStationMatcher', () => {
  it.each([
    ['BTS Asok', 'BTS-ASOK'], ['BTS Asoke', 'BTS-ASOK'],
    ['BTS On Nut', 'BTS-ON_NUT'], ['BTS Onnut', 'BTS-ON_NUT'],
    ['BTS Phrom Phong', 'BTS-PHROM_PHONG'], ['BTS Promphong', 'BTS-PHROM_PHONG'],
    ['MRT Huay Khwang', 'MRT-HUAI_KHWANG'], ['MRT Rama IX', 'MRT-PHRA_RAM_9'],
  ])('maps %s to canonical %s', (mention, stationId) => {
    expect(matcher().match(mention)).toMatchObject({ status: 'matched', stationId })
  })

  it('uses system context and does not swap nearby BTS/MRT names', () => {
    const subject = matcher()
    expect(subject.match('BTS Asok').systemCode).toBe('BTS')
    expect(subject.match('MRT Sukhumvit').stationId).toBe('MRT-SUKHUMVIT')
    expect(subject.match('พญาไท').status).toBe('ambiguous')
  })

  it('never guesses when only a transit system is claimed', () => {
    expect(matcher().match('ใกล้ BTS')).toMatchObject({ status: 'not_found', stationId: null })
  })

  it('requires evidence to be an exact raw-post substring', () => {
    expect(matcher().match('BTS อ่อนนุช', { evidenceText: 'BTS อ่อนนุช', rawText: 'ไม่มีชื่อสถานี' }))
      .toMatchObject({ status: 'not_found', stationId: null })
  })

  it('selects only the closest verified station from one post', () => {
    const results = matcher().extract('คอนโดใกล้ BTS อ่อนนุช 300 เมตร และ MRT พระราม 9')
    expect(results.map((item) => item.stationId)).toEqual(['BTS-ON_NUT'])
    expect(results[0]).toMatchObject({ distanceValue: 300, distanceUnit: 'm' })
  })

  it('drops phrases after BTS/MRT that are not verified station names', () => {
    expect(matcher().extract('MRT รายละเอียดห้อง ชั้น 20')).toEqual([])
    expect(matcher().extract('ใกล้ BTS พร้อมอยู่ เฟอร์ครบ')).toEqual([])
  })
})
