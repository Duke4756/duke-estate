import { describe, expect, it } from 'vitest'
import { isMembershipUnavailableError, shouldTryNextRandomGroup } from '../../server/postingGroupFallback.js'

describe('posting group membership fallback', () => {
  it('continues through not-joined and pending-approval groups', () => {
    expect(shouldTryNextRandomGroup({ ok: false, error: 'ยังไม่ได้เข้าร่วมกลุ่ม abc — ข้าม' })).toBe(true)
    expect(shouldTryNextRandomGroup({ ok: false, error: 'กลุ่มกำลังรออนุมัติ abc — ข้าม' })).toBe(true)
    expect(isMembershipUnavailableError('กลุ่มกำลังรออนุมัติ abc')).toBe(true)
    expect(shouldTryNextRandomGroup({ ok: false, pending: true, submitted: true, verified: 'unconfirmed' })).toBe(false)
  })

  it('never posts to another group after Facebook accepted the submission', () => {
    expect(shouldTryNextRandomGroup({ ok: false, pending: true, submitted: true })).toBe(false)
  })

  it('uses another random group after a navigation timeout before submission', () => {
    expect(shouldTryNextRandomGroup({
      ok: false,
      submitted: false,
      error: 'page.goto: Timeout 45000ms exceeded while navigating',
    })).toBe(true)
    expect(shouldTryNextRandomGroup({
      ok: false,
      submitted: false,
      error: 'ไม่พบปุ่มเปิดช่องเขียนโพสต์ (composer)',
    })).toBe(true)
  })

  it('stops after success or a non-membership posting failure', () => {
    expect(shouldTryNextRandomGroup({ ok: true })).toBe(false)
    expect(shouldTryNextRandomGroup({ ok: false, error: 'Session หมดอายุ' })).toBe(false)
  })
})
