import { describe, expect, it } from 'vitest'
import { displayScheduleStatus, isOneTimePostComplete, scheduleStatusForResults } from '../../server/schedules.js'
import { facebookPostPermalink, isPostCardRecent, postVerificationMarkers } from '../../server/facebookPostMatch.js'

describe('Facebook feed content matching', () => {
  it('uses the property reference before formatted Facebook text', () => {
    expect(postVerificationMarkers('🔥 ให้เช่า เดอะ วอเตอร์ฟอร์ด 🔥\n• Ref No.: CD-010098\n📞 Tel: 064'))
      .toEqual(['CD-010098', '🔥 ให้เช่า เดอะ วอเตอร์ฟอร์ด 🔥', '• Ref No.: CD-010098', '📞 Tel: 064'])
  })

  it('extracts the hidden post id from a Facebook photo pcb link', () => {
    expect(facebookPostPermalink(
      ['https://www.facebook.com/photo/?fbid=99&set=pcb.123456789'],
      'https://www.facebook.com/groups/820669979671477/',
    )).toBe('https://www.facebook.com/groups/820669979671477/posts/123456789/')
  })

  it('normalizes direct and story_fbid post links', () => {
    expect(facebookPostPermalink([
      'https://www.facebook.com/groups/abc/permalink/777/?__cft__=x',
    ])).toBe('https://www.facebook.com/groups/abc/posts/777/')
    expect(facebookPostPermalink([
      'https://www.facebook.com/permalink.php?story_fbid=888&id=123',
    ])).toBe('https://www.facebook.com/groups/123/posts/888/')
    expect(facebookPostPermalink([
      'https://www.facebook.com/groups/123/?multi_permalinks=999&ref=share',
    ])).toBe('https://www.facebook.com/groups/123/posts/999/')
  })
})

describe('Facebook group-card verification', () => {
  it('counts a real permalink as published', () => {
    expect(scheduleStatusForResults([{ ok: true, verified: 'permalink', postUrl: 'https://facebook.com/groups/1/posts/2' }])).toBe('done')
  })

  it('keeps a group-card-only result pending because it is not delivery proof', () => {
    const found = { ok: true, submitted: true, verified: 'group_card', postUrl: null }
    expect(scheduleStatusForResults([found])).toBe('unconfirmed')
    expect(isOneTimePostComplete({}, [found])).toBe(false)
  })

  it('rejects a group card without evidence that this run submitted it', () => {
    const oldCard = { ok: true, verified: 'group_card', postUrl: null }
    expect(scheduleStatusForResults([oldCard])).toBe('failed')
    expect(isOneTimePostComplete({}, [oldCard])).toBe(false)
  })

  it('does not accept a composer photo pcb id as a published permalink', () => {
    expect(facebookPostPermalink(
      ['https://www.facebook.com/photo/?fbid=99&set=pcb.123456789'],
      'https://www.facebook.com/groups/820669979671477/',
      { allowPhotoFallback: false },
    )).toBeNull()
  })

  it('does not accept a group tracking link as proof of publication', () => {
    const submitted = { ok: true, verified: 'submitted', postUrl: 'https://facebook.com/groups/1/' }
    expect(scheduleStatusForResults([submitted])).toBe('failed')
    expect(isOneTimePostComplete({}, [submitted])).toBe(false)
  })

  it('does not count the old accepted group-url fallback as success', () => {
    expect(scheduleStatusForResults([{ ok: true, verified: 'accepted', postUrl: 'https://facebook.com/groups/1' }])).toBe('unconfirmed')
  })

  it('keeps pending approval separate from a hard failure', () => {
    expect(scheduleStatusForResults([{ ok: false, pending: true, verified: 'unconfirmed' }])).toBe('unconfirmed')
    expect(scheduleStatusForResults([{ ok: false, error: 'composer missing' }])).toBe('failed')
  })

  it('keeps a partial run successful only when at least one group has a permalink', () => {
    expect(scheduleStatusForResults([
      { ok: true, verified: 'permalink', postUrl: 'https://facebook.com/groups/1/posts/2' },
      { ok: false, pending: true, verified: 'unconfirmed' },
    ])).toBe('done')
  })
})

describe('delayed Facebook post verification', () => {
  const submittedAt = '2026-08-10T07:00:00.000Z'
  const now = new Date('2026-08-10T07:10:00.000Z').getTime()

  it('accepts a Facebook unix timestamp close to submission time', () => {
    expect(isPostCardRecent({ unixTimes: ['1786345380'], submittedAt, now })).toBe(true)
  })

  it('accepts a recent relative timestamp but rejects an old card', () => {
    expect(isPostCardRecent({ cardText: 'โพสต์นี้ 8 นาที', submittedAt, now })).toBe(true)
    expect(isPostCardRecent({ cardText: 'โพสต์นี้ 2 ชั่วโมง', submittedAt, now })).toBe(false)
  })

  it('accepts a timestamp exposed through Facebook accessibility labels', () => {
    expect(isPostCardRecent({
      cardText: 'CD-100152\n17 สิงหาคม เวลา 14:05 น.\nโพสต์เมื่อ 5 นาทีที่แล้ว',
      submittedAt,
      now,
    })).toBe(true)
  })

  it('allows Facebook rounded hour labels for a post submitted in that hour', () => {
    const hourNow = new Date('2026-08-10T08:10:00.000Z').getTime()
    expect(isPostCardRecent({ cardText: 'CD-100152 · 1 ชั่วโมง', submittedAt, now: hourNow })).toBe(true)
  })

  it('rejects cards without trustworthy time evidence', () => {
    expect(isPostCardRecent({ cardText: 'CD-100152 ห้องสวย', submittedAt, now })).toBe(false)
  })
})

describe('one-time post set lifecycle', () => {
  const ok = { ok: true, verified: 'permalink', postUrl: 'https://facebook.com/groups/1/posts/2' }
  it('consumes a random-mode set after its one successful post', () => {
    expect(isOneTimePostComplete({ groupMode: 'random' }, [ok])).toBe(true)
  })
  it('consumes a selected-mode set after any verified post', () => {
    expect(isOneTimePostComplete({ groupMode: 'selected' }, [ok, { ok: false }])).toBe(true)
    expect(isOneTimePostComplete({ groupMode: 'selected' }, [ok, ok])).toBe(true)
  })
  it('keeps a set when Facebook has not returned a real permalink', () => {
    expect(isOneTimePostComplete({ groupMode: 'selected' }, [
      { ok: false, pending: true, verified: 'unconfirmed' },
    ])).toBe(false)
  })
})

describe('unconfirmed flow', () => {
  it('turns an old unconfirmed result into a non-blocking skipped display state', () => {
    const now = Date.parse('2026-08-01T14:30:00Z')
    expect(displayScheduleStatus({ status: 'unconfirmed', finishedAt: '2026-08-01T14:19:00Z' }, now)).toBe('skipped')
    expect(displayScheduleStatus({ status: 'unconfirmed', finishedAt: '2026-08-01T14:25:00Z' }, now)).toBe('unconfirmed')
  })
})
