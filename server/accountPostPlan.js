const DAY = 86_400_000

export function validateAccountPlan(rule, { allowIncomplete = false } = {}) {
  const legacySlots = !Array.isArray(rule.slots) && Array.isArray(rule.postSetIds) && Array.isArray(rule.groups)
    ? rule.postSetIds.flatMap((postSetId) => rule.groups.map((group, groupIndex) => ({ postSetId, group, time: legacyTime(rule.time || '09:00', (rule.postSetIds.indexOf(postSetId) * rule.groups.length + groupIndex) * Number(rule.intervalMinutes || 30)) })))
    : []
  const slots = Array.isArray(rule.slots) ? rule.slots : legacySlots
  if (!allowIncomplete && !slots.length) throw new Error('เพิ่มรายการโพสต์เฉพาะอย่างน้อย 1 รายการ')
  if (slots.some((slot) => !slot.postSetId || !slot.group || !/^([01]\d|2[0-3]):[0-5]\d$/.test(slot.time || ''))) throw new Error('แต่ละรายการต้องมีทรัพย์ กลุ่ม และเวลาโพสต์')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(rule.startDate || '')) throw new Error('ระบุวันที่โพสต์ให้ครบทุกบัญชี')
  const firstTime = rule.time || slots[0]?.time || '09:00'
  const start = Date.parse(`${rule.startDate}T${firstTime}:00+07:00`)
  if (!Number.isFinite(start) || new Date(start + 7 * 3600000).toISOString().slice(0, 10) !== rule.startDate) throw new Error('วันที่โพสต์ไม่ถูกต้อง')
  if (!Array.isArray(rule.slots) && rule.intervalMinutes != null && (Number(rule.intervalMinutes) < 30 || Number(rule.intervalMinutes) > 1440 || Number(rule.intervalMinutes) * Math.max(0, slots.length - 1) > 1440)) throw new Error('ระยะห่างระหว่างโพสต์ต้องอยู่ระหว่าง 30–1,440 นาที')
  const normalized = { slots: slots.map((slot) => ({ postSetId: String(slot.postSetId), group: String(slot.group), time: slot.time })), startDate: rule.startDate, time: firstTime, repeatDaily: rule.repeatDaily === true, intervalMinutes: Number(rule.intervalMinutes) || 30 }
  if (Array.isArray(rule.postSetIds)) Object.assign(normalized, { postSetIds: rule.postSetIds, groups: rule.groups || [] })
  return normalized
}

function legacyTime(base, offsetMinutes) {
  const [h, m] = base.split(':').map(Number)
  const total = h * 60 + m + offsetMinutes
  return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

// Dates always mean Bangkok time, regardless of the server's local timezone.
export function nextAccountOccurrence(rule, lastOccurrence, now = Date.now()) {
  const firstTime = rule.time || rule.slots?.[0]?.time || '09:00'
  const start = Date.parse(`${rule.startDate}T${firstTime}:00+07:00`)
  if (!Number.isFinite(start)) return null
  if (!rule.repeatDaily) return lastOccurrence ? null : start
  const today = new Date(now + 7 * 3600000).toISOString().slice(0, 10)
  let next = Math.max(start, Date.parse(`${today}T${firstTime}:00+07:00`))
  if (lastOccurrence) next = Math.max(next, Date.parse(lastOccurrence) + DAY)
  else if (next < now) next += DAY
  return next
}

export function accountPlanEntries(rule, occurrence) {
  const slots = rule.slots || (rule.postSetIds || []).flatMap((postSetId, propertyIndex) => (rule.groups || []).map((group, groupIndex) => ({ postSetId, group, time: legacyTime(rule.time || '09:00', (propertyIndex * (rule.groups || []).length + groupIndex) * Number(rule.intervalMinutes || 30)) })))
  return slots.map((slot) => {
    const [hours, minutes] = slot.time.split(':').map(Number)
    const dayStart = new Date(occurrence)
    dayStart.setUTCHours(0, 0, 0, 0)
    const { time, ...entry } = slot
    return { ...entry, runAt: new Date(dayStart.getTime() + (hours - 7) * 3600000 + minutes * 60000).toISOString() }
  })
}
