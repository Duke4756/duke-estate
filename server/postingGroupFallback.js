export function isMembershipUnavailableError(error = '') {
  return /^(?:ยังไม่ได้เข้าร่วมกลุ่ม|กลุ่มกำลังรออนุมัติ)/.test(String(error))
}

export function shouldTryNextRandomGroup(result = {}) {
  return result.ok !== true && (
    isMembershipUnavailableError(result.error)
    || result.pending === true
    || result.verified === 'unconfirmed'
  )
}
