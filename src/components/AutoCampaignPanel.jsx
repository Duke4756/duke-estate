import { useEffect, useState } from 'react'
import { GROUP_SETS, groupSetLabel, selectGroupSet } from '../groupSets'
import { mergeAutoCampaignRuntime } from '../autoCampaignState'
import {
  getAccounts,
  getAutoCampaign,
  getAutoCampaignStatus,
  getGroups,
  getPostSets,
  startGroupMembership,
  finishGroupMembership,
  cancelGroupMembership,
  updateAutoCampaign,
} from '../api'

const isFacebookPostPermalink = (value = '') =>
  /^https?:\/\/(?:www\.|web\.)?facebook\.com\/groups\/[^/]+\/(?:posts|permalink)\/\d+/i.test(String(value))

export default function AutoCampaignPanel({ onOpenAccounts = () => {} }) {
  const [campaign, setCampaign] = useState(null)
  const [accounts, setAccounts] = useState([])
  const [sets, setSets] = useState([])
  const [groups, setGroups] = useState([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [saved, setSaved] = useState(false)
  const [runtime, setRuntime] = useState({ runs: [], plans: [], serverTime: null })
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [joining, setJoining] = useState(null)
  const [membershipClearedAt, setMembershipClearedAt] = useState(() => Number(localStorage.getItem('membershipIssuesClearedAt') || 0))

  useEffect(() => {
    Promise.allSettled([getAutoCampaign(), getAccounts(), getPostSets(), getGroups()])
      .then(([autoResult, accountResult, setResult, groupResult]) => {
        const auto = autoResult.status === 'fulfilled' ? autoResult.value : null
        const accountData = accountResult.status === 'fulfilled' ? accountResult.value : null
        const setData = setResult.status === 'fulfilled' ? setResult.value : null
        const groupData = groupResult.status === 'fulfilled' ? groupResult.value : null
        if (groupData) {
        const activeGroups = (groupData.groups || []).filter((group) => group.active !== false)
        const activeUrls = new Set(activeGroups.map((group) => group.url))
          setGroups(activeGroups)
          if (auto) {
        setCampaign({
          ...auto.campaign,
          groups: (auto.campaign.groups || []).filter((url) => activeUrls.has(url)),
        })
          }
        } else if (auto) {
          setCampaign(auto.campaign)
        }
        // Keep every configured account visible. A temporary verification
        // timeout must not make an actively posting account disappear.
        if (accountData) setAccounts(accountData.accounts || [])
        if (setData) setSets(setData.postsets || [])
        if (!auto && !accountData && !setData && !groupData) setError('โหลดข้อมูลโพสต์อัตโนมัติไม่สำเร็จ กรุณาลองใหม่')
      })
  }, [])

  useEffect(() => {
    let stopped = false
    const refreshStatus = () => getAutoCampaignStatus()
      .then((data) => {
        if (stopped) return
        setRuntime(data)
        setCampaign((current) => mergeAutoCampaignRuntime(current, data.campaign))
        setAccounts((current) => {
          const byId = new Map(current.map((account) => [account.id, account]))
          for (const plan of data.plans || []) {
            if (!byId.has(plan.accountId)) {
              byId.set(plan.accountId, {
                id: plan.accountId,
                name: plan.accountName,
                ready: null,
                sessionStatus: 'checking',
              })
            }
          }
          return [...byId.values()]
        })
      })
      .catch(() => {})
    void refreshStatus()
    const timer = setInterval(refreshStatus, 5000)
    return () => { stopped = true; clearInterval(timer) }
  }, [])

  function toggle(field, value) {
    setCampaign((current) => {
      const values = new Set(current[field] || [])
      if (values.has(value)) values.delete(value)
      else values.add(value)
      return { ...current, [field]: [...values] }
    })
  }

  function updateAccountRule(accountId, field, value) {
    setCampaign((current) => ({
      ...current,
      accountRules: {
        ...(current.accountRules || {}),
        [accountId]: {
          burstSize: current.accountRules?.[accountId]?.burstSize ?? current.burstSize ?? 2,
          intervalMinutes: current.accountRules?.[accountId]?.intervalMinutes ?? current.intervalMinutes ?? 30,
          [field]: Number(value),
        },
      },
    }))
    setSaved(false)
  }

  function applyGroupSet(setId) {
    const selected = selectGroupSet(groups, setId, campaign.groupMode)
    setCampaign((current) => ({ ...current, groups: selected }))
    setError(selected.length
      ? (campaign.groupMode === 'selected' && groups.filter((group) => group.category === setId).length > 3
        ? `เลือก 3 กลุ่มแรกจากชุด “${groupSetLabel(setId)}” ตามข้อจำกัดโหมดเลือกเอง`
        : null)
      : `ชุด “${groupSetLabel(setId)}” ยังไม่มีกลุ่มที่เปิดใช้งาน`)
  }

  async function submit(event) {
    event.preventDefault()
    setSaving(true)
    setSaved(false)
    setError(null)
    try {
      const requested = campaign
      const result = await updateAutoCampaign(requested)
      const missingAccountRules = (requested.accountIds || []).filter((accountId) =>
        !result.campaign?.accountRules?.[accountId])
      if (missingAccountRules.length) {
        throw new Error('API ออโต้โพสยังเป็นเวอร์ชันเก่า จึงยังไม่บันทึกค่ารายบัญชี กรุณาปิดโปรแกรมแล้วเปิดใหม่ด้วย npm run autopost-app')
      }
      setCampaign(result.campaign)
      setSaved(true)
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  async function quickStart() {
    if (!accounts.length || !groups.length || !sets.length) {
      setError('ต้องมีบัญชีพร้อมใช้ ชุดโพสต์ และกลุ่มเป้าหมายก่อนเปิดระบบ')
      return
    }
    const recommended = {
      ...campaign,
      enabled: true,
      accountIds: accounts.filter((account) => account.ready !== false || campaign.accountIds.includes(account.id)).map((account) => account.id),
      postSetMode: 'all',
      postSetIds: [],
      groups: groups.map((group) => group.url),
      groupMode: 'random',
      intervalMinutes: 30,
      burstSize: 2,
      accountRules: Object.fromEntries(accounts
        .filter((account) => account.ready !== false || campaign.accountIds.includes(account.id))
        .map((account) => [account.id, { burstSize: 2, intervalMinutes: 30 }])),
      priorityNewHours: 72,
    }
    setSaving(true)
    setSaved(false)
    setError(null)
    try {
      const result = await updateAutoCampaign(recommended)
      setCampaign(result.campaign)
      setSaved(true)
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  async function setEnabled(enabled) {
    if (saving) return
    const next = { ...campaign, enabled }
    setCampaign(next)
    setSaving(true)
    setSaved(false)
    setError(null)
    try {
      const result = await updateAutoCampaign(next)
      setCampaign(result.campaign)
      setSaved(true)
      // The server schedules its next check immediately after this request;
      // refresh the runtime now instead of waiting for the 5-second poll.
      const status = await getAutoCampaignStatus()
      setRuntime(status)
      setCampaign((current) => mergeAutoCampaignRuntime(current, status.campaign))
    } catch (e) {
      setCampaign(campaign)
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  async function restartNow() {
    if (saving) return
    if (!window.confirm('ล้างคิว/ประวัติรอบอัตโนมัติเก่า และเริ่มคิวคู่ใหม่ทันที?')) return
    setSaving(true)
    setSaved(false)
    setError(null)
    try {
      const result = await updateAutoCampaign({ ...campaign, enabled: true, restartNow: true })
      setCampaign(result.campaign)
      setSaved(true)
      const status = await getAutoCampaignStatus()
      setRuntime(status)
      setCampaign((current) => mergeAutoCampaignRuntime(current, status.campaign))
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  function applyPreset(intervalMinutes) {
    setCampaign((current) => ({
      ...current,
      intervalMinutes,
      accountRules: Object.fromEntries((current.accountIds || []).map((accountId) => [
        accountId,
        {
          burstSize: current.accountRules?.[accountId]?.burstSize ?? current.burstSize ?? 2,
          intervalMinutes,
        },
      ])),
      postSetMode: 'all',
      groupMode: 'random',
      priorityNewHours: 72,
    }))
    setSaved(false)
  }

  async function openGroupMembership(issue) {
    setError(null)
    try {
      const result = await startGroupMembership(issue.accountId, issue.group)
      setJoining({ ...issue, membership: result.membership })
    } catch (e) { setError(e.message) }
  }

  async function saveGroupMembership() {
    if (!joining) return
    try {
      const result = await finishGroupMembership(joining.accountId)
      setJoining(null)
      if (result.membership === 'joined') setSaved(true)
      else if (result.membership === 'requested') setError('ส่งคำขอเข้าร่วมแล้ว ระบบจะยังไม่โพสต์จนกว่าแอดมินกลุ่มจะอนุมัติ')
      else setError('ยังตรวจไม่พบว่าเข้าร่วมกลุ่มแล้ว กรุณากดเข้าร่วมใน Facebook ให้เสร็จก่อน')
    } catch (e) { setError(e.message) }
  }

  async function closeGroupMembership() {
    if (joining) await cancelGroupMembership(joining.accountId).catch(() => {})
    setJoining(null)
  }

  function confirmAllGroupsJoined() {
    const clearedAt = Date.now()
    localStorage.setItem('membershipIssuesClearedAt', String(clearedAt))
    setMembershipClearedAt(clearedAt)
    setError(null)
  }

  if (!campaign) return <div className="py-12 text-center text-sm text-slate-400">{error ? `⚠️ ${error}` : 'กำลังโหลด...'}</div>
  const latestByAccount = new Map()
  for (const run of runtime.runs || []) {
    if (!latestByAccount.has(run.accountId)) latestByAccount.set(run.accountId, run)
  }
  const statusLabel = (run) => {
    if (!run) return 'รอสร้างคิวแรก'
    if (run.status === 'posting') return 'กำลังโพสต์อยู่'
    if (run.status === 'pending') return 'อยู่ในคิวรอโพสต์'
    const sentCount = (run.successCount || 0) + (run.unconfirmedCount || 0) + (run.skippedCount || 0)
    if (sentCount > 0) return `ส่งโพสต์แล้ว ${sentCount}/${run.attemptCount} กลุ่ม`
    if (run.status === 'failed') return 'โพสต์ไม่สำเร็จ'
    return run.status
  }
  const recentRuns = runtime.runs || []
  const reviewItems = recentRuns.flatMap((run) => (run.reviewResults || run.unconfirmedResults || [])
    .map((result) => ({ ...result, run })))
  const sentTotal = recentRuns.reduce((sum, run) => sum + (run.successCount || 0) + (run.unconfirmedCount || 0) + (run.skippedCount || 0), 0)
  const failedTotal = recentRuns.filter((run) => run.status === 'failed').length
  const activeTotal = recentRuns.filter((run) => ['pending', 'posting'].includes(run.status)).length
  const membershipIssues = [...new Map(recentRuns.flatMap((run) => (run.membershipResults || [])
    .filter((result) => new Date(result.at || run.finishedAt || run.createdAt || 0).getTime() > membershipClearedAt)
    .map((result) => ({ accountId: run.accountId, accountName: run.accountName, group: result.group })))
    .map((item) => [`${item.accountId}:${item.group}`, item])).values()]
  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="rounded-3xl bg-gradient-to-br from-emerald-600 via-teal-600 to-cyan-700 p-5 text-white shadow-lg">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-emerald-100">Full Autopilot</p>
            <h2 className="mt-1 text-2xl font-bold">โพสต์ให้อัตโนมัติทั้งหมด</h2>
            <p className="mt-1 text-sm text-emerald-100">กำหนดจำนวนโพสต์ต่อรอบและเวลาพักแยกแต่ละบัญชีได้ ระบบจัดห้องที่เหลือเข้าคิวต่อให้อัตโนมัติ</p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <label className="flex cursor-pointer items-center gap-2 rounded-2xl bg-white/15 px-4 py-3">
              <input type="checkbox" checked={campaign.enabled} disabled={saving} onChange={(e) => setEnabled(e.target.checked)} className="h-5 w-5 accent-emerald-500 disabled:opacity-50" />
              <b>{saving ? 'กำลังเปลี่ยนสถานะ…' : campaign.enabled ? 'เปิดใช้งาน' : 'ปิดอยู่'}</b>
            </label>
            <button type="button" onClick={quickStart} disabled={saving} className="rounded-xl bg-white px-4 py-2 text-xs font-black text-emerald-700 shadow-sm hover:bg-emerald-50 disabled:opacity-50">
              ⚡ เปิดแบบแนะนำในคลิกเดียว
            </button>
          </div>
        </div>
      </div>

      <section className={`rounded-2xl border p-4 ${campaign.enabled ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200 bg-white'}`}>
        <div className="flex items-center justify-between gap-3">
          <div><h3 className="font-bold text-slate-800">{campaign.enabled ? '● ระบบกำลังทำงาน' : '○ ระบบยังปิดอยู่'}</h3><p className="mt-1 text-xs text-slate-500">สถานะอัปเดตอัตโนมัติทุก 5 วินาที · ไม่ต้องเปิดหน้านี้ค้างไว้</p></div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={restartNow} disabled={saving} className="rounded-xl bg-indigo-600 px-4 py-2 text-xs font-black text-white shadow-sm disabled:opacity-50">▶ เริ่มรอบใหม่ทันที</button>
            {campaign.enabled && <span className="rounded-full bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white">ตั้งค่าแยก {campaign.accountIds.length} บัญชี · สุ่มเวลา ±3–5 นาที</span>}
          </div>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2">
          <div className="rounded-xl border border-emerald-200 bg-white p-3"><p className="text-[10px] font-semibold text-slate-500">ส่งโพสต์แล้ว</p><p className="mt-1 text-xl font-black text-emerald-600">{sentTotal}</p><p className="text-[10px] text-slate-400">Facebook รับคำสั่งโพสต์แล้ว</p></div>
          <div className="rounded-xl border border-indigo-200 bg-white p-3"><p className="text-[10px] font-semibold text-slate-500">กำลังทำงาน</p><p className="mt-1 text-xl font-black text-indigo-600">{activeTotal}</p><p className="text-[10px] text-slate-400">คิวที่กำลังโพสต์หรือรอรัน</p></div>
          <div className="rounded-xl border border-rose-200 bg-white p-3"><p className="text-[10px] font-semibold text-slate-500">ต้องแก้ไข</p><p className="mt-1 text-xl font-black text-rose-600">{failedTotal + membershipIssues.length}</p><p className="text-[10px] text-slate-400">บัญชีหรือกลุ่มที่ต้องตรวจสอบ</p>{(failedTotal > 0 || membershipIssues.length > 0) && <div className="mt-2 flex flex-wrap gap-1.5">{failedTotal > 0 && <button type="button" onClick={onOpenAccounts} className="rounded-lg bg-rose-600 px-2.5 py-1 text-[10px] font-bold text-white hover:bg-rose-700">แก้ไขบัญชี →</button>}{membershipIssues.length > 0 && <button type="button" onClick={() => document.getElementById('membership-issues')?.scrollIntoView({ behavior: 'smooth', block: 'center' })} className="rounded-lg border border-rose-300 bg-rose-50 px-2.5 py-1 text-[10px] font-bold text-rose-700 hover:bg-rose-100">แก้ไขกลุ่ม ↓</button>}</div>}</div>
        </div>
        {campaign.accountIds.length > 0 && <div className="mt-3 grid gap-2 md:grid-cols-3">
          {campaign.accountIds.map((accountId) => {
            const account = accounts.find((item) => item.id === accountId)
            const run = latestByAccount.get(accountId)
            const nextAt = campaign.accountState?.[accountId]?.nextRunAt
            return <div key={accountId} className="rounded-xl border border-emerald-100 bg-white p-3">
              <p className="text-sm font-bold text-slate-700">👤 {account?.name || run?.accountName || accountId}</p>
              <p className={`mt-1 text-xs font-semibold ${run?.status === 'posting' ? 'text-indigo-600' : ((run?.successCount || 0) + (run?.unconfirmedCount || 0) + (run?.skippedCount || 0)) > 0 ? 'text-emerald-600' : run?.status === 'failed' ? 'text-rose-600' : 'text-indigo-600'}`}>{run?.status === 'posting' ? '● ' : ''}{statusLabel(run)}</p>
              {run?.lastError && run.status === 'failed' && <p className="mt-1 line-clamp-2 text-[10px] text-rose-500">{run.lastError}</p>}
              {nextAt && <p className="mt-1 text-[10px] text-slate-400">รอบถัดไปประมาณ {new Date(nextAt).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}</p>}
            </div>
          })}
        </div>}
      </section>

      {joining && <section className="rounded-2xl border-2 border-indigo-300 bg-indigo-50 p-4"><h3 className="font-bold text-indigo-900">🌐 เปิด Facebook สำหรับ {joining.accountName} แล้ว</h3><p className="mt-1 text-xs text-indigo-700">กด “เข้าร่วมกลุ่ม” และตอบคำถามใน Chrome จากนั้นกลับมากดตรวจและบันทึก หากต้องรอแอดมิน ระบบจะพักกลุ่มนี้ไว้ก่อน</p><div className="mt-3 flex gap-2"><button type="button" onClick={saveGroupMembership} className="rounded-xl bg-indigo-600 px-4 py-2 text-xs font-bold text-white">ตรวจและบันทึก</button><button type="button" onClick={closeGroupMembership} className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-slate-600">ยกเลิก</button></div></section>}

      {membershipIssues.length > 0 && <section id="membership-issues" className="scroll-mt-24 rounded-2xl border border-rose-200 bg-rose-50 p-4"><div className="flex items-start justify-between gap-3"><div><h3 className="font-bold text-rose-900">🚪 พบประวัติบัญชีที่ยังไม่ได้เข้าร่วมกลุ่ม</h3><p className="mt-1 text-xs text-rose-700">รายการนี้มาจากรอบโพสต์ก่อนหน้า หากเข้าร่วมครบแล้วให้ยืนยันเพื่อล้างคำเตือนเก่า รายการใหม่จะยังแจ้งเตือนตามปกติ</p></div><button type="button" onClick={confirmAllGroupsJoined} className="shrink-0 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white">✓ เข้าร่วมครบแล้ว</button></div><div className="mt-3 grid gap-2 md:grid-cols-2">{membershipIssues.slice(0, 12).map((issue) => <div key={`${issue.accountId}-${issue.group}`} className="flex items-center gap-3 rounded-xl border border-rose-100 bg-white p-3"><div className="min-w-0 flex-1"><p className="text-xs font-bold text-slate-700">👤 {issue.accountName}</p><p className="truncate text-[10px] text-slate-500">📁 {(issue.group.match(/groups\/([^/?]+)/) || [])[1] || issue.group}</p></div><button type="button" disabled={Boolean(joining)} onClick={() => openGroupMembership(issue)} className="shrink-0 rounded-lg bg-rose-600 px-3 py-2 text-[11px] font-bold text-white disabled:opacity-40">เปิดตรวจสอบ</button></div>)}</div></section>}

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-indigo-100 bg-white p-4">
          <div className="flex items-center justify-between"><div><h3 className="font-bold text-slate-800">⏭️ กำลังจะโพสต์</h3><p className="mt-1 text-xs text-slate-500">แผนรอบถัดไปของแต่ละบัญชี</p></div><span className="rounded-full bg-indigo-50 px-2.5 py-1 text-[10px] font-bold text-indigo-600">{(runtime.plans || []).length} บัญชี</span></div>
          <div className="mt-3 space-y-2">
            {(runtime.plans || []).map((plan) => {
              const set = sets.find((item) => item.id === plan.nextPostSetId)
              const activeRun = (runtime.runs || []).find((run) => run.accountId === plan.accountId && ['pending', 'posting'].includes(run.status))
              const activeSet = activeRun ? sets.find((item) => item.id === activeRun.postSetId) : null
              const displaySet = activeSet || set
              return <div key={plan.accountId} className="flex items-center gap-3 rounded-xl border border-slate-100 bg-slate-50 p-2.5">
                {displaySet?.images?.[0]?.url ? <img src={displaySet.images[0].url} alt="" className="h-11 w-11 rounded-lg object-cover" /> : <div className="grid h-11 w-11 place-items-center rounded-lg bg-white">📝</div>}
                <div className="min-w-0 flex-1"><p className="truncate text-sm font-bold text-slate-700">{activeRun?.name?.replace(/^อัตโนมัติ · /, '') || plan.nextPostSetName || (plan.randomPostSet ? 'สุ่มจากชุดโพสต์ทั้งหมด' : 'รอเลือกโพสต์')}</p><p className="text-[11px] text-slate-500">👤 {plan.accountName}</p></div>
                <div className="shrink-0 text-right"><p className={`text-[11px] font-bold ${activeRun?.status === 'posting' ? 'text-amber-600' : 'text-indigo-600'}`}>{activeRun?.status === 'posting' ? '● กำลังโพสต์' : activeRun?.status === 'pending' ? 'อยู่ในคิว' : 'รอบถัดไป'}</p>{plan.nextRunAt && !activeRun && <p className="text-[10px] text-slate-400">{new Date(plan.nextRunAt).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}</p>}</div>
              </div>
            })}
            {!(runtime.plans || []).length && <p className="py-6 text-center text-sm text-slate-400">เปิดระบบและเลือกบัญชีเพื่อสร้างแผนโพสต์</p>}
          </div>
        </div>

        <div className="rounded-2xl border border-emerald-100 bg-white p-4">
          <div className="flex items-center justify-between"><div><h3 className="font-bold text-slate-800">✅ ส่งโพสต์ล่าสุด</h3><p className="mt-1 text-xs text-slate-500">โพสต์ที่ยืนยันแล้ว และรายการที่ต้องเปิดกลุ่มตรวจสอบ</p></div>{reviewItems.length > 0 && <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[10px] font-bold text-amber-700">รอตรวจ {reviewItems.length}</span>}</div>
          <div className="mt-3 max-h-64 space-y-2 overflow-auto">
            {(runtime.runs || []).flatMap((run) => (run.successfulResults || [])
              .map((result) => ({ ...result, run }))).slice(0, 12).map(({ run, group, postUrl, at }, index) => <div key={`${run.id}-${group}-${index}`} className="flex items-center gap-3 rounded-xl border border-slate-100 p-2.5">
              {sets.find((item) => item.id === run.postSetId)?.images?.[0]?.url ? <img src={sets.find((item) => item.id === run.postSetId).images[0].url} alt="" className="h-10 w-10 rounded-lg object-cover" /> : <div className="grid h-10 w-10 place-items-center rounded-lg bg-slate-50">✓</div>}
              <div className="min-w-0 flex-1"><p className="truncate text-sm font-bold text-slate-700">{run.name.replace(/^อัตโนมัติ · /, '')}</p><p className="truncate text-[10px] text-slate-400">👤 {run.accountName} · 📁 {(group.match(/groups\/([^/?]+)/) || [])[1] || group}{at ? ` · ${new Date(at).toLocaleString('th-TH', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}` : ''}</p></div>
              <a href={isFacebookPostPermalink(postUrl) ? postUrl : group} target="_blank" rel="noopener noreferrer" title={isFacebookPostPermalink(postUrl) ? 'เปิดโพสต์จริงบน Facebook' : 'เปิดกลุ่ม Facebook'} aria-label="เปิดผลการโพสต์บน Facebook" className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-emerald-200 bg-emerald-50 text-sm text-emerald-700 transition hover:bg-emerald-100">{isFacebookPostPermalink(postUrl) ? '🔗' : '📁'}</a>
            </div>)}
            {reviewItems.slice(0, 12).map(({ run, group, at, verified }, index) => <div key={`review-${run.id}-${group}-${index}`} className="flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50/60 p-2.5">
              {sets.find((item) => item.id === run.postSetId)?.images?.[0]?.url ? <img src={sets.find((item) => item.id === run.postSetId).images[0].url} alt="" className="h-10 w-10 rounded-lg object-cover" /> : <div className="grid h-10 w-10 place-items-center rounded-lg bg-white">🕓</div>}
              <div className="min-w-0 flex-1"><p className="truncate text-sm font-bold text-slate-700">{run.name.replace(/^อัตโนมัติ · /, '')}</p><p className="truncate text-[10px] text-amber-700">{verified === 'submitted' ? 'ส่งแล้ว · ติดตามเอง' : 'ยังไม่พบ permalink'} · 📁 {(group.match(/groups\/([^/?]+)/) || [])[1] || group}{at ? ` · ${new Date(at).toLocaleString('th-TH', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}` : ''}</p></div>
              <a href={group} target="_blank" rel="noopener noreferrer" title="เปิดกลุ่มเพื่อติดตามโพสต์" className="shrink-0 rounded-lg border border-amber-300 bg-white px-2.5 py-1.5 text-[10px] font-bold text-amber-700 hover:bg-amber-100">เปิดติดตาม</a>
            </div>)}
            {sentTotal === 0 && reviewItems.length === 0 && <p className="py-6 text-center text-sm text-slate-400">ยังไม่มีประวัติส่งโพสต์จากระบบอัตโนมัติ</p>}
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><h3 className="font-bold text-slate-800">ตั้งค่าเร็ว</h3><p className="mt-1 text-xs text-slate-500">เลือกความถี่ แล้วระบบจัดการโพสต์และกลุ่มแบบสมดุลให้เอง</p></div>
          <div className="flex flex-wrap gap-2">
            {[30, 45, 60].map((minutes) => <button key={minutes} type="button" onClick={() => applyPreset(minutes)} className={`rounded-xl border px-4 py-2 text-sm font-bold ${campaign.intervalMinutes === minutes ? 'border-emerald-500 bg-emerald-50 text-emerald-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>{minutes === 30 ? '⚡ เร็ว' : minutes === 45 ? '⚖️ สมดุล' : '🛡️ ผ่อนคลาย'} · {minutes} นาที</button>)}
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="flex items-center justify-between gap-3"><div><h3 className="font-bold text-slate-800">บัญชีที่ให้ระบบรัน</h3>
        <p className="mt-1 text-xs text-slate-500">เลือกบัญชีแล้วกำหนดจำนวนโพสต์ต่อรอบและเวลาพัก ระบบแจกห้องจากคิวกลางโดยไม่ซ้ำและจัดรายการที่เหลือต่อให้เอง</p>
        </div><button type="button" onClick={() => setCampaign({ ...campaign, accountIds: accounts.filter((account) => account.ready !== false || campaign.accountIds.includes(account.id)).map((account) => account.id) })} className="text-xs font-bold text-emerald-700">เลือกทุกบัญชี</button></div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {accounts.map((account) => {
            const selected = campaign.accountIds.includes(account.id)
            const status = account.ready === true ? 'พร้อมใช้' : account.ready === false ? (account.sessionStatus === 'expired' ? 'Session หมดอายุ' : 'รอตรวจสอบใหม่') : 'กำลังตรวจสอบ'
            const rule = campaign.accountRules?.[account.id] || { burstSize: campaign.burstSize || 2, intervalMinutes: campaign.intervalMinutes || 30 }
            return <div key={account.id} className={`rounded-xl border p-3 text-sm ${selected ? 'border-emerald-300 bg-emerald-50/40' : 'border-slate-200'}`}>
              <label className="flex cursor-pointer items-center gap-2"><input type="checkbox" checked={selected} onChange={() => toggle('accountIds', account.id)} className="accent-emerald-600" /><span className="font-semibold">{account.name}</span><span className={`ml-auto text-[10px] ${account.ready === true ? 'text-emerald-600' : account.sessionStatus === 'expired' ? 'text-rose-600' : 'text-amber-600'}`}>{status}</span></label>
              {selected && <div className="mt-3 grid grid-cols-2 gap-2 border-t border-emerald-100 pt-3">
                <label className="text-[10px] font-semibold text-slate-500">โพสต์ต่อรอบ<input type="number" min="1" max="10" value={rule.burstSize} onChange={(e) => updateAccountRule(account.id, 'burstSize', e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-700" /></label>
                <label className="text-[10px] font-semibold text-slate-500">พักกี่นาที<input type="number" min="30" max="1440" step="5" value={rule.intervalMinutes} onChange={(e) => updateAccountRule(account.id, 'intervalMinutes', e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-700" /></label>
              </div>}
            </div>
          })}
          {!accounts.length && <p className="text-sm text-amber-600">กำลังโหลดบัญชีจากระบบ…</p>}
        </div>
      </section>

      <details open={showAdvanced} onToggle={(event) => setShowAdvanced(event.currentTarget.open)} className="rounded-2xl border border-slate-200 bg-white">
        <summary className="flex cursor-pointer list-none items-center justify-between p-4"><div><h3 className="font-bold text-slate-800">⚙️ ตั้งค่าขั้นสูง</h3><p className="mt-1 text-xs text-slate-500">เลือกชุดโพสต์ กลุ่มเป้าหมาย และกฎทรัพย์ใหม่แบบละเอียด</p></div><span className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-600">{showAdvanced ? 'ซ่อน' : 'เปิดตั้งค่า'}</span></summary>
      <section className="border-t border-slate-100 p-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div><h3 className="font-bold text-slate-800">2. วิธีเลือกชุดโพสต์</h3><p className="mt-1 text-xs text-slate-500">ไม่เลือกชุดใดเป็นพิเศษ = ใช้ทุกชุดที่มี รวมชุดที่เพิ่มใหม่ภายหลัง</p></div>
          <select value={campaign.postSetMode} onChange={(e) => setCampaign({ ...campaign, postSetMode: e.target.value })} className="rounded-xl border px-3 py-2 text-sm">
            <option value="all">หมุนทุกโพสต์ตามลำดับ</option>
            <option value="random">สุ่มโพสต์แต่ละรอบ</option>
          </select>
        </div>
        <div className="mt-3 flex items-center justify-between text-xs text-slate-500"><span>{campaign.postSetIds.length ? `เลือกเฉพาะ ${campaign.postSetIds.length} ชุด` : `ใช้ทุกชุดอัตโนมัติ (${sets.length})`}</span>{campaign.postSetIds.length > 0 && <button type="button" onClick={() => setCampaign({ ...campaign, postSetIds: [] })} className="font-bold text-emerald-700">กลับไปใช้ทุกชุด</button>}</div>
        <div className="mt-2 grid max-h-56 gap-2 overflow-auto sm:grid-cols-2">
          {sets.map((set) => <label key={set.id} className="flex cursor-pointer items-center gap-2 rounded-xl border p-2.5 text-sm"><input type="checkbox" checked={campaign.postSetIds.includes(set.id)} onChange={() => toggle('postSetIds', set.id)} className="accent-emerald-600" /><span className="truncate">{set.name}</span><span className="ml-auto text-[10px] text-slate-400">{new Date(set.createdAt).toLocaleDateString('th-TH')}</span></label>)}
        </div>
        <label className="mt-3 flex items-center gap-2 text-sm text-slate-600">ให้ความสำคัญชุดทรัพย์ใหม่ที่ยังไม่เคยโพสต์ในบัญชีนั้น เป็นเวลา<input type="number" min="0" max="720" value={campaign.priorityNewHours} onChange={(e) => setCampaign({ ...campaign, priorityNewHours: Number(e.target.value) })} className="w-20 rounded-lg border px-2 py-1.5" />ชั่วโมง</label>
      </section>

      <section className="border-t border-slate-100 p-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div><h3 className="font-bold text-slate-800">กลุ่มเป้าหมาย</h3><p className="mt-1 text-xs text-slate-500">สุ่ม 1 กลุ่มช่วยกระจายโพสต์ ส่วนเลือกเองโพสต์ได้สูงสุด 3 กลุ่มต่อรอบ</p></div>
          <div className="flex gap-2">
            <select value={campaign.groupMode} onChange={(e) => setCampaign({ ...campaign, groupMode: e.target.value })} className="rounded-xl border px-3 py-2 text-sm"><option value="random">สุ่ม 1 กลุ่ม</option><option value="selected">โพสต์กลุ่มที่เลือก</option></select>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl bg-emerald-50/60 p-2.5">
          <span className="text-xs font-semibold text-emerald-800">เลือกจากชุดเดียวกับค้นหาโพสต์:</span>
          {GROUP_SETS.map((set) => {
            const count = groups.filter((group) => group.category === set.id).length
            return <button key={set.id} type="button" disabled={!count} onClick={() => applyGroupSet(set.id)} className="rounded-full border border-emerald-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-35">{set.label} · {count}</button>
          })}
          <button type="button" onClick={() => setCampaign({ ...campaign, groups: groups.map((group) => group.url), groupMode: 'random' })} className="rounded-full border border-emerald-300 bg-emerald-100 px-2.5 py-1 text-[11px] font-bold text-emerald-800">ทุกกลุ่ม · {groups.length}</button>
        </div>
        <div className="mt-3 grid max-h-64 gap-2 overflow-auto sm:grid-cols-2">
          {groups.map((group) => <label key={group.url} className="flex cursor-pointer items-center gap-2 rounded-xl border p-2.5 text-sm"><input type="checkbox" checked={campaign.groups.includes(group.url)} onChange={() => toggle('groups', group.url)} className="accent-emerald-600" /><span className="min-w-0"><span className="block truncate">{group.name || group.label}</span><span className="block text-[10px] text-slate-400">ชุด: {groupSetLabel(group.category)}</span></span></label>)}
        </div>
      </section>
      </details>

      {error && <div className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">⚠️ {error}</div>}
      {saved && <div className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-700">✓ บันทึกแล้ว ระบบจะสร้างคิวถัดไปให้อัตโนมัติ</div>}
      <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white p-3 shadow-sm"><span className="text-xs text-slate-500">{campaign.enabled ? `เปิดอยู่ · ตั้งค่าแยก ${campaign.accountIds.length} บัญชี · จัดคิวที่เหลืออัตโนมัติ` : 'ระบบยังปิดอยู่'}</span><button disabled={saving} className="rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50">{saving ? 'กำลังบันทึก…' : 'บันทึกและใช้งาน'}</button></div>
    </form>
  )
}
