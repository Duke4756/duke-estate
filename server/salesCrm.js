// Deterministic prioritization only; these helpers never modify customer data.
export function salesWorkflowBucket(deal = {}) {
  const status = String(deal.status || '').trim().toLowerCase()
  if (deal.workflowCompleted === true || status === 'close lost') return 'completed'
  if (status === 'close won') return 'booked'
  return 'active'
}

export function scoreSalesDeal(deal = {}, now = Date.now()) {
  if (salesWorkflowBucket(deal) === 'completed') return { score: 0, level: 'cold', reasons: [] }
  let score = 10
  const reasons = []
  const add = (points, reason) => { score += points; reasons.push(reason) }
  if (deal.project) add(10, 'ระบุโครงการแล้ว')
  const budget = Number(deal.budgetMax)
  if (Number.isFinite(budget) && budget > 0) add(budget >= 50000 ? 20 : 10, 'ระบุงบประมาณแล้ว')
  const moveIn = Date.parse(deal.moveInDate)
  const days = (moveIn - now) / 86400000
  if (days >= 0 && days <= 7) add(35, 'ย้ายเข้าภายใน 7 วัน')
  else if (days > 7 && days <= 30) add(20, 'ย้ายเข้าภายใน 30 วัน')
  if (Date.parse(deal.nextFollowUpAt) < now) add(20, 'เลยกำหนดติดตาม')
  if (deal.manualPriority === 'critical') add(40, 'ผู้ใช้ปักด่วน')
  score = Math.min(100, score)
  return { score, level: score >= 60 ? 'hot' : score >= 30 ? 'warm' : 'cold', reasons }
}

export function analyzeSalesDeal(deal = {}, now = Date.now()) {
  const bucket = salesWorkflowBucket(deal)
  const risks = []
  let stage = bucket === 'completed' ? 'Completed' : bucket === 'booked' ? 'Booking' : 'Qualification'
  let nextAction = bucket === 'completed' ? 'ตรวจสอบสรุปผลเคส' : bucket === 'booked' ? 'ตรวจสอบเอกสารและกำหนดทำสัญญา' : 'ยืนยันความต้องการและงบประมาณ'
  if (bucket === 'active') {
    if (deal.project || /offered|เสนอห้อง/i.test(String(deal.status || ''))) {
      stage = 'Property Matching'
      nextAction = 'ติดตามผลห้องที่เสนอและนัดชมห้อง'
    }
    if (!Number.isFinite(Date.parse(deal.moveInDate))) {
      risks.push('ยังไม่ทราบกำหนดย้ายเข้า')
      nextAction = 'สอบถามและยืนยันกำหนดย้ายเข้า'
    } else if (Date.parse(deal.nextFollowUpAt) < now) {
      nextAction = 'ติดต่อลูกค้าตามนัดติดตามที่เลยกำหนด'
    }
  }
  return { ...scoreSalesDeal(deal, now), bucket, stage, nextAction, risks }
}
