import { describe, expect, it } from 'vitest'
import { analyzeSalesDeal, salesWorkflowBucket, scoreSalesDeal } from '../../server/salesCrm.js'

describe('sales CRM priority score', () => {
  const now = Date.parse('2026-08-24T00:00:00.000Z')

  it('prioritizes an imminent, high-budget active case', () => {
    const urgent = scoreSalesDeal({ status: 'ระหว่างดำเนินการ', project: 'Ashton', budgetMax: 70000, moveInDate: '2026-08-28' }, now)
    const vague = scoreSalesDeal({ status: 'ระหว่างดำเนินการ' }, now)
    expect(urgent.score).toBeGreaterThan(vague.score)
    expect(urgent.level).toBe('hot')
  })

  it('raises overdue follow-up and manual critical cases', () => {
    const normal = scoreSalesDeal({ status: 'ระหว่างดำเนินการ' }, now)
    const critical = scoreSalesDeal({ status: 'ระหว่างดำเนินการ', manualPriority: 'critical', nextFollowUpAt: '2026-08-23T00:00:00Z' }, now)
    expect(critical.score).toBeGreaterThan(normal.score)
    expect(critical.reasons).toContain('ผู้ใช้ปักด่วน')
  })

  it('turns missing move-in data into a concrete next action', () => {
    const analysis = analyzeSalesDeal({ status: 'เสนอห้อง Offered', project: 'Siri', budgetMax: 50000, documents: [] }, now)
    expect(analysis.stage).toBe('Property Matching')
    expect(analysis.nextAction).toMatch(/ย้ายเข้า/)
    expect(analysis.risks).toContain('ยังไม่ทราบกำหนดย้ายเข้า')
  })

  it('separates active, booked and completed work without trusting one JSA status', () => {
    expect(salesWorkflowBucket({ status: 'Potential' })).toBe('active')
    expect(salesWorkflowBucket({ status: 'close won', documents: [] })).toBe('booked')
    expect(salesWorkflowBucket({ status: 'close lost' })).toBe('completed')
    expect(salesWorkflowBucket({ status: 'Potential', workflowCompleted: true })).toBe('completed')
  })
})
