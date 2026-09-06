export function isMembershipUnavailableError(error = '') {
  return /^(?:ยังไม่ได้เข้าร่วมกลุ่ม|กลุ่มกำลังรออนุมัติ)/.test(String(error))
}

export function shouldTryNextRandomGroup(result = {}) {
  // Once Facebook accepted the composer submission, never submit the same
  // room to another fallback group merely because indexing/permalink lookup
  // is slow. Only failures proven to happen before submission are safe to
  // retry elsewhere.
  if (result.submitted === true) return false
  const safePreSubmitFailure = /page\.goto|navigation|Timeout \d+ms exceeded|เปิดกลุ่ม.*ไม่สำเร็จ|composer|ช่องเขียนโพสต์/i.test(String(result.error || ''))
  return result.ok !== true && (isMembershipUnavailableError(result.error) || safePreSubmitFailure)
}
