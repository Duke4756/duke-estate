export function normalizeFacebookGroupUrl(value) {
  let url
  try { url = new URL(String(value || '').trim()) } catch { throw new Error('ลิงก์กลุ่ม Facebook ไม่ถูกต้อง') }
  if (!/(^|\.)facebook\.com$/i.test(url.hostname)) throw new Error('รองรับเฉพาะลิงก์กลุ่ม Facebook')
  const match = url.pathname.match(/^\/groups\/([^/]+)/i)
  if (!match) throw new Error('ลิงก์นี้ไม่ใช่ลิงก์กลุ่ม Facebook')
  return `https://www.facebook.com/groups/${match[1]}/`
}

export async function detectGroupMembership(page) {
  if (!page || page.isClosed()) return 'unknown'
  const visible = async (locator) => {
    try { return (await locator.count()) > 0 && await locator.first().isVisible().catch(() => false) } catch { return false }
  }
  if (await visible(page.getByText(/^(เข้าร่วมแล้ว|Joined|สมาชิก|Member)$/i))) return 'MEMBER'
  if (await visible(page.getByRole('button', { name: /^(เข้าร่วมแล้ว|Joined|จัดการการเป็นสมาชิก|Manage membership)$/i }))) return 'MEMBER'
  if (await visible(page.getByRole('button', { name: /^(ยกเลิกคำขอ|Cancel request)$/i }))) return 'REQUESTED'
  if (await visible(page.getByText(/^(รอการอนุมัติ|Pending)$/i))) return 'REQUESTED'
  if (await visible(page.getByRole('button', { name: /^(เข้าร่วมกลุ่ม|Join group)$/i }))) return 'NOT_MEMBER'
  return 'UNKNOWN'
}
