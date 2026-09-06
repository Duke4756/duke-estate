import { afterEach, describe, expect, it } from 'vitest'
import { AutopostReliability, classifyPostingError } from '../../server/autopostReliability.js'

describe('autopost reliability error taxonomy', () => {
  it('never allows blind resubmission after Facebook accepted a post', () => {
    const issue = classifyPostingError('Facebook รับคำสั่งโพสต์แล้ว แต่ยังไม่พบ permalink', { submitted: true })
    expect(issue).toMatchObject({ code: 'POST_ACCEPTED_NOT_DISCOVERED', safeToResubmit: false })
  })
  it('allows a pre-submit composer lookup to be retried safely', () => {
    expect(classifyPostingError('ไม่พบปุ่มเปิดช่องเขียนโพสต์ (composer)')).toMatchObject({ code: 'COMPOSER_NOT_FOUND', safeToResubmit: true })
  })
})

describe('autopost black box', () => {
  let reliability
  afterEach(() => reliability?.close())
  it('records attempts and groups recurring incidents', () => {
    reliability = new AutopostReliability(':memory:')
    const runId = reliability.startRun({ scheduleId: 'sch_1', accountId: 'primary' })
    for (const group of ['group-1', 'group-2']) {
      const attemptId = reliability.startAttempt(runId, group)
      reliability.finishAttempt(runId, attemptId, { ok: false, error: 'ไม่พบปุ่มเปิดช่องเขียนโพสต์ (composer)' })
    }
    reliability.finishRun(runId, 'FAILED')
    const summary = reliability.summary()
    expect(summary).toMatchObject({ attempts: 2, failed: 2 })
    expect(summary.incidents[0]).toMatchObject({ code: 'COMPOSER_NOT_FOUND', occurrences: 2 })
  })
  it('promotes an unconfirmed attempt when delayed verification finds a permalink', () => {
    reliability = new AutopostReliability(':memory:')
    const runId = reliability.startRun({ scheduleId: 'sch_2', accountId: 'primary' })
    const attemptId = reliability.startAttempt(runId, 'group-1')
    reliability.finishAttempt(runId, attemptId, { ok: false, pending: true, submitted: true, verified: 'unconfirmed', error: 'Facebook รับคำสั่งโพสต์แล้ว แต่ยังไม่พบ permalink' })
    reliability.recordVerification(attemptId, { postUrl: 'https://facebook.com/groups/1/posts/2' })
    expect(reliability.summary()).toMatchObject({ attempts: 1, verified: 1, unconfirmed: 0 })
  })
})
