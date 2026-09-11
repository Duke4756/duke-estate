import { useEffect, useState } from 'react'
import AccountPostingSettings, { defaultAccountPlan } from './AccountPostingSettings'
import { mergeAutoCampaignRuntime } from '../autoCampaignState'
import {
  getAccounts,
  getAutoCampaign,
  getAutoCampaignStatus,
  getSchedules,
  deleteSchedule,
  getGroups,
  getPostSets,
  openAutopostEvidenceFolder,
  startGroupMembership,
  finishGroupMembership,
  cancelGroupMembership,
  updateAutoCampaign,
} from '../api'

const isFacebookPostPermalink = (value = '') =>
  /^https?:\/\/(?:www\.|web\.)?facebook\.com\/groups\/[^/]+\/(?:posts|permalink)\/\d+/i.test(String(value))
const groupKey = (value = '') => (String(value).match(/facebook\.com\/groups\/([^/?#]+)/i)?.[1] || String(value)).toLowerCase()
const groupTitle = (groupUrl, groups = []) => {
  const group = groups.find((item) => groupKey(item.url) === groupKey(groupUrl))
  return group?.name || group?.label || (String(groupUrl).match(/groups\/([^/?]+)/) || [])[1] || groupUrl
}

export default function AutoCampaignPanel({ onOpenAccounts = () => {}, showSettings = true }) {
  const [campaign, setCampaign] = useState(null)
  const [accounts, setAccounts] = useState([])
  const [sets, setSets] = useState([])
  const [groups, setGroups] = useState([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [saved, setSaved] = useState(false)
  const [runtime, setRuntime] = useState({ runs: [], plans: [], serverTime: null })
  const [showStats, setShowStats] = useState(false)
  const [openingFolder, setOpeningFolder] = useState(false)
  const [backendOnline, setBackendOnline] = useState(null)
  const [joining, setJoining] = useState(null)
  const [membershipRevision, setMembershipRevision] = useState(0)
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
    const refreshStatus = () => Promise.all([getAutoCampaignStatus(), getPostSets(), getSchedules()])
      .then(([data, setData, scheduleData]) => {
        if (stopped) return
        setBackendOnline(true)
        const accountNames = new Map((accounts || []).map((account) => [account.id, account.name]))
        const campaignPlans = (scheduleData.schedules || [])
          .filter((schedule) => schedule.source === 'campaign' && ['pending', 'posting'].includes(schedule.status))
          .sort((a, b) => new Date(a.runAt).getTime() - new Date(b.runAt).getTime())
          .map((schedule) => ({ accountId: schedule.accountId || 'primary', accountName: accountNames.get(schedule.accountId || 'primary') || schedule.accountId || 'บัญชีหลัก', nextRunAt: schedule.runAt, nextPostSetId: schedule.postSetId, nextPostSetName: schedule.name, group: schedule.groups?.[0] || null, state: schedule.status === 'posting' ? 'posting' : 'ready', scheduleId: schedule.id }))
        setRuntime({ ...data, plans: campaignPlans.length ? campaignPlans : data.plans })
        setSets(setData.postsets || [])
        if ((setData.postsets || []).length > 0) {
          setError((current) => current?.startsWith('ไม่มีชุดโพสต์เหลือ') ? null : current)
        }
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
      .catch(() => {
        if (stopped) return
        setBackendOnline(false)
      })
    void refreshStatus()
    const timer = setInterval(refreshStatus, 5000)
    return () => { stopped = true; clearInterval(timer) }
  }, [])

  async function openEvidenceFolder() {
    setOpeningFolder(true)
    setError(null)
    try {
      await openAutopostEvidenceFolder()
      setBackendOnline(true)
    } catch (e) {
      setBackendOnline(false)
      setError(`เปิดโฟลเดอร์ไม่ได้ เพราะตัวทำงานเบื้องหลังหยุดอยู่ — ปิดหน้าต่างโปรแกรมแล้วเปิดใหม่ด้วย npm run autopost-app (${e.message})`)
    }
    finally { setOpeningFolder(false) }
  }

  async function deleteQueuedCampaign(scheduleId) {
    if (!scheduleId) return
    try {
      await deleteSchedule(scheduleId)
      setRuntime((current) => ({ ...current, plans: (current.plans || []).filter((plan) => plan.scheduleId !== scheduleId), runs: (current.runs || []).filter((run) => run.id !== scheduleId) }))
    } catch (e) { setError(e.message) }
  }

  function configuredCampaign(current) {
    const accountRules = { ...(current.accountRules || {}) }
    for (const { id } of accounts) if (!accountRules[id]) accountRules[id] = defaultAccountPlan(current, id)
    const known = new Set(accounts.map(({ id }) => id))
    return { ...current, mode: 'account_schedule', accountIds: (current.accountIds || []).filter((id) => known.has(id)), postSetIds: [], groups: [], accountRules }
  }

  async function submit(event) {
    event.preventDefault()
    setSaving(true)
    setSaved(false)
    setError(null)
    try {
      const requested = configuredCampaign(campaign)
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

  async function setEnabled(enabled) {
    if (saving) return
    if (enabled && !(campaign.accountIds || []).length) {
      setError('หน้านี้สร้างคิวตามบัญชีที่เลือกได้ทันที ไม่ต้องเปิดโหมดโพสต์อัตโนมัติ')
      return
    }
    const next = { ...configuredCampaign(campaign), enabled }
    setCampaign(next)
    setSaving(true)
    setSaved(false)
    setError(null)
    try {
      const result = await updateAutoCampaign(enabled ? next : { pauseOnly: true })
      setCampaign(enabled ? result.campaign : { ...campaign, enabled: false })
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
      setMembershipRevision((value) => value + 1)
      if (result.membership === 'MEMBER' || result.membership === 'joined') {
        setSaved(true)
      }
      else if (result.membership === 'REQUESTED' || result.membership === 'requested') setError('ส่งคำขอเข้าร่วมแล้ว ระบบจะยังไม่โพสต์จนกว่าแอดมินกลุ่มจะอนุมัติ')
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
  const dailyStats = runtime.dailyStats || { total: 0, withEvidence: 0, accounts: [] }
  const reviewItems = recentRuns.flatMap((run) => (run.reviewResults || run.unconfirmedResults || [])
    .map((result) => ({ ...result, run })))
  const sentTotal = recentRuns.reduce((sum, run) => sum + (run.successCount || 0) + (run.unconfirmedCount || 0) + (run.skippedCount || 0), 0)
  const failedTotal = recentRuns.filter((run) => run.status === 'failed').length
  const activeTotal = recentRuns.filter((run) => ['pending', 'posting'].includes(run.status)).length
  const inventoryEmpty = runtime.inventory?.empty === true
  const membershipIssues = [...new Map(recentRuns.flatMap((run) => (run.membershipResults || [])
    .filter((result) => new Date(result.at || run.finishedAt || run.createdAt || 0).getTime() > membershipClearedAt)
    .map((result) => ({ accountId: run.accountId, accountName: run.accountName, group: result.group })))
    .map((item) => [`${item.accountId}:${item.group}`, item])).values()]
  return (
    <form onSubmit={submit} className="space-y-4">
      {backendOnline === false && <div role="alert" className="sticky top-2 z-40 rounded-2xl border-2 border-rose-400 bg-rose-50 p-4 text-rose-800 shadow-lg">
        <p className="font-black">🔴 ตัวทำงานเบื้องหลังหยุด — ระบบจะไม่โพสต์ตามเวลา</p>
        <p className="mt-1 text-xs">ปิดหน้าต่าง Terminal เดิม แล้วเปิดโปรแกรมใหม่ด้วย <code className="rounded bg-rose-100 px-1.5 py-0.5 font-bold">npm run autopost-app</code> ระบบจะกลับมาสร้างคิวทันที</p>
      </div>}
      {campaign.enabled && inventoryEmpty && <div role="status" className="sticky top-2 z-30 rounded-2xl border-2 border-amber-400 bg-amber-50 p-4 text-amber-900 shadow-lg">
        <p className="font-black">📭 คิวหมด — ไม่มีห้องใหม่ให้โพสต์</p>
        <p className="mt-1 text-xs">เพิ่มทรัพย์เข้าสต็อกเพื่อให้ระบบสร้างคิวโพสต์ โดยทรัพย์และรูปจะยังอยู่หลังโพสต์สำเร็จ</p>
      </div>}
      {error && <div role="alert" className="rounded-2xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700">⚠️ {error}</div>}
      <div className="rounded-3xl bg-gradient-to-br from-emerald-600 via-teal-600 to-cyan-700 p-5 text-white shadow-lg">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-emerald-100">ACCOUNT SCHEDULE</p>
            <h2 className="mt-1 text-2xl font-bold">ตั้งเวลาโพสต์ตามบัญชี</h2>
            <p className="mt-1 text-sm text-emerald-100">เลือกทรัพย์และกลุ่มให้แต่ละบัญชี ตั้งเวลาโพสต์ครั้งเดียวหรือทำซ้ำทุกวัน</p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <label className="flex cursor-pointer items-center gap-2 rounded-2xl bg-white/15 px-4 py-3">
              <input type="checkbox" checked={campaign.enabled} disabled={saving} onChange={(e) => setEnabled(e.target.checked)} className="h-5 w-5 accent-emerald-500 disabled:opacity-50" />
              <b>{saving ? 'กำลังเปลี่ยนสถานะ…' : campaign.enabled ? 'เปิดใช้งาน' : 'ปิดอยู่'}</b>
            </label>
            <div className="flex gap-2">
              <button type="button" onClick={() => setShowStats(true)} className="rounded-xl bg-white/15 px-3 py-2 text-xs font-bold text-white hover:bg-white/25">📊 ดูสถิติ</button>
              <button type="button" onClick={openEvidenceFolder} disabled={openingFolder} className="rounded-xl bg-white/15 px-3 py-2 text-xs font-bold text-white hover:bg-white/25 disabled:opacity-50">{openingFolder ? 'กำลังเปิด…' : '📂 เปิดโฟลเดอร์ส่งงาน'}</button>
            </div>
          </div>
        </div>
      </div>

      <div className={showSettings ? '' : 'hidden'}><AccountPostingSettings campaign={campaign} accounts={accounts} sets={sets} groups={groups} onOpenAccounts={onOpenAccounts} onOpenGroupMembership={openGroupMembership} membershipRevision={membershipRevision} onGroupsSaved={setGroups} onChange={(next) => { setCampaign(next); setSaved(false) }} />
      {showSettings && <p className="rounded-xl border border-indigo-100 bg-indigo-50 px-4 py-3 text-xs text-indigo-700">การเลือกทรัพย์และกลุ่มจะบันทึกเป็นคิวทันทีเมื่อกด “สร้างคิว” ไม่ต้องกดบันทึกการตั้งค่าอีก</p>}
      {saved && <p role="status" className="text-sm text-emerald-700">✓ บันทึกการตั้งค่าแล้ว</p>} </div>

      {showStats && <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/60 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowStats(false) }}>
        <section className="max-h-[88vh] w-full max-w-4xl overflow-hidden rounded-3xl bg-white shadow-2xl">
          <header className="flex items-center justify-between border-b border-slate-200 p-5">
            <div><h2 className="text-xl font-black text-slate-800">📊 สถิติการโพสต์รายวัน</h2><p className="mt-1 text-xs text-slate-500">นับเฉพาะโพสต์ที่ระบบยืนยันแล้ว · ย้อนหลัง 30 วัน</p></div>
            <div className="flex gap-2"><button type="button" onClick={openEvidenceFolder} className="rounded-xl bg-indigo-50 px-3 py-2 text-xs font-bold text-indigo-700">📂 เปิดโฟลเดอร์</button><button type="button" onClick={() => setShowStats(false)} className="grid h-9 w-9 place-items-center rounded-full bg-slate-100 text-slate-600">✕</button></div>
          </header>
          <div className="max-h-[72vh] overflow-auto p-5">
            <div className="mb-4 grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl bg-emerald-50 p-4"><p className="text-xs font-bold text-emerald-700">โพสต์วันนี้</p><p className="mt-1 text-3xl font-black text-emerald-700">{dailyStats.total}</p></div>
              <div className="rounded-2xl bg-indigo-50 p-4"><p className="text-xs font-bold text-indigo-700">มีภาพหลักฐาน</p><p className="mt-1 text-3xl font-black text-indigo-700">{dailyStats.withEvidence}</p></div>
              <div className="rounded-2xl bg-amber-50 p-4"><p className="text-xs font-bold text-amber-700">หลักฐานครบ</p><p className="mt-1 text-3xl font-black text-amber-700">{dailyStats.total ? Math.round(dailyStats.withEvidence / dailyStats.total * 100) : 0}%</p></div>
            </div>
            <table className="w-full border-separate border-spacing-0 overflow-hidden text-left text-sm">
              <thead className="sticky top-0 bg-slate-100 text-xs text-slate-600"><tr><th className="rounded-l-xl p-3">วันที่</th>{accounts.map((account) => <th key={account.id} className="p-3">{account.name}</th>)}<th className="rounded-r-xl p-3 text-right">รวม</th></tr></thead>
              <tbody>{(dailyStats.history || []).map((day) => <tr key={day.date} className="border-b border-slate-100"><td className="whitespace-nowrap p-3 font-bold text-slate-700">{new Date(`${day.date}T00:00:00+07:00`).toLocaleDateString('th-TH', { day: '2-digit', month: 'short', year: '2-digit' })}</td>{accounts.map((account) => { const stat = day.accounts?.find((item) => item.accountId === account.id); return <td key={account.id} className="p-3 text-slate-600"><b>{stat?.verified || 0}</b><span className="ml-1 text-[10px] text-slate-400">📸 {stat?.withEvidence || 0}</span></td> })}<td className="p-3 text-right font-black text-emerald-700">{day.total}</td></tr>)}</tbody>
            </table>
          </div>
        </section>
      </div>}

      <section className={`${showSettings ? 'hidden' : ''} rounded-2xl border p-4 ${campaign.enabled ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200 bg-white'}`}>
        <div className="flex items-center justify-between gap-3">
          <div><h3 className="font-bold text-slate-800">{campaign.enabled ? (inventoryEmpty ? '● ระบบเปิดอยู่ แต่คิวหมด' : '● ระบบกำลังทำงาน') : '○ ระบบยังปิดอยู่'}</h3><p className="mt-1 text-xs text-slate-500">สถานะอัปเดตอัตโนมัติทุก 5 วินาที · ไม่ต้องเปิดหน้านี้ค้างไว้</p></div>
          <div className="flex items-center gap-2">
            {campaign.enabled && <span className="rounded-full bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white">ตั้งค่าแยก {campaign.accountIds.length} บัญชี</span>}
          </div>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2">
          <div className="rounded-xl border border-emerald-200 bg-white p-3"><p className="text-[10px] font-semibold text-slate-500">โพสต์สำเร็จวันนี้</p><p className="mt-1 text-xl font-black text-emerald-600">{dailyStats.total}</p><p className="text-[10px] text-slate-400">มีภาพส่งงาน {dailyStats.withEvidence}/{dailyStats.total} โพสต์</p></div>
          <div className="rounded-xl border border-indigo-200 bg-white p-3"><p className="text-[10px] font-semibold text-slate-500">กำลังทำงาน</p><p className="mt-1 text-xl font-black text-indigo-600">{activeTotal}</p><p className="text-[10px] text-slate-400">คิวที่กำลังโพสต์หรือรอรัน</p></div>
          <div className="rounded-xl border border-rose-200 bg-white p-3"><p className="text-[10px] font-semibold text-slate-500">ต้องแก้ไข</p><p className="mt-1 text-xl font-black text-rose-600">{failedTotal + membershipIssues.length}</p><p className="text-[10px] text-slate-400">บัญชีหรือกลุ่มที่ต้องตรวจสอบ</p>{(failedTotal > 0 || membershipIssues.length > 0) && <div className="mt-2 flex flex-wrap gap-1.5">{failedTotal > 0 && <button type="button" onClick={onOpenAccounts} className="rounded-lg bg-rose-600 px-2.5 py-1 text-[10px] font-bold text-white hover:bg-rose-700">แก้ไขบัญชี →</button>}{membershipIssues.length > 0 && <button type="button" onClick={() => document.getElementById('membership-issues')?.scrollIntoView({ behavior: 'smooth', block: 'center' })} className="rounded-lg border border-rose-300 bg-rose-50 px-2.5 py-1 text-[10px] font-bold text-rose-700 hover:bg-rose-100">แก้ไขกลุ่ม ↓</button>}</div>}</div>
        </div>
        {campaign.accountIds.length > 0 && <div className="mt-3 grid gap-2 md:grid-cols-3">
          {campaign.accountIds.map((accountId) => {
            const account = accounts.find((item) => item.id === accountId)
            const run = latestByAccount.get(accountId)
              const plan = (runtime.plans || []).find((item) => item.accountId === accountId)
              const nextAt = plan?.nextRunAt
            const todayStats = dailyStats.accounts.find((item) => item.accountId === accountId) || { verified: 0, withEvidence: 0 }
            return <div key={accountId} className="rounded-xl border border-emerald-100 bg-white p-3">
              <p className="text-sm font-bold text-slate-700">👤 {account?.name || run?.accountName || accountId}</p>
              <p className="mt-1 text-xs font-black text-emerald-700">วันนี้ {todayStats.verified} โพสต์ · 📸 {todayStats.withEvidence} หลักฐาน</p>
              <p className={`mt-1 text-xs font-semibold ${inventoryEmpty ? 'text-amber-600' : run?.status === 'posting' ? 'text-indigo-600' : ((run?.successCount || 0) + (run?.unconfirmedCount || 0) + (run?.skippedCount || 0)) > 0 ? 'text-emerald-600' : run?.status === 'failed' ? 'text-rose-600' : 'text-indigo-600'}`}>{inventoryEmpty ? 'คิวหมด — รอเพิ่มห้องใหม่' : <>{run?.status === 'posting' ? '● ' : ''}{statusLabel(run)}</>}</p>
              {run?.lastError && run.status === 'failed' && <p className="mt-1 line-clamp-2 text-[10px] text-rose-500">{run.lastError}</p>}
              {nextAt && <p className="mt-1 text-[10px] text-slate-400">รอบถัดไปประมาณ {new Date(nextAt).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}</p>}
            </div>
          })}
        </div>}
      </section>

      {joining && <section className="rounded-2xl border-2 border-indigo-300 bg-indigo-50 p-4"><h3 className="font-bold text-indigo-900">🌐 เปิด Facebook สำหรับ {joining.accountName} แล้ว</h3><p className="mt-1 text-xs text-indigo-700">กด “เข้าร่วมกลุ่ม” และตอบคำถามใน Chrome จากนั้นกลับมากดตรวจและบันทึก หากต้องรอแอดมิน ระบบจะพักกลุ่มนี้ไว้ก่อน</p><div className="mt-3 flex gap-2"><button type="button" onClick={saveGroupMembership} className="rounded-xl bg-indigo-600 px-4 py-2 text-xs font-bold text-white">ตรวจและบันทึก</button><button type="button" onClick={closeGroupMembership} className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-slate-600">ยกเลิก</button></div></section>}

      {membershipIssues.length > 0 && <section id="membership-issues" className="scroll-mt-24 rounded-2xl border border-rose-200 bg-rose-50 p-4"><div className="flex items-start justify-between gap-3"><div><h3 className="font-bold text-rose-900">🚪 พบประวัติบัญชีที่ยังไม่ได้เข้าร่วมกลุ่ม</h3><p className="mt-1 text-xs text-rose-700">รายการนี้มาจากรอบโพสต์ก่อนหน้า หากเข้าร่วมครบแล้วให้ยืนยันเพื่อล้างคำเตือนเก่า รายการใหม่จะยังแจ้งเตือนตามปกติ</p></div><button type="button" onClick={confirmAllGroupsJoined} className="shrink-0 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white">✓ เข้าร่วมครบแล้ว</button></div><div className="mt-3 grid gap-2 md:grid-cols-2">{membershipIssues.slice(0, 12).map((issue) => <div key={`${issue.accountId}-${issue.group}`} className="flex items-center gap-3 rounded-xl border border-rose-100 bg-white p-3"><div className="min-w-0 flex-1"><p className="text-xs font-bold text-slate-700">👤 {issue.accountName}</p><p className="truncate text-[10px] text-slate-500">📁 {(issue.group.match(/groups\/([^/?]+)/) || [])[1] || issue.group}</p></div><button type="button" disabled={Boolean(joining)} onClick={() => openGroupMembership(issue)} className="shrink-0 rounded-lg bg-rose-600 px-3 py-2 text-[11px] font-bold text-white disabled:opacity-40">เปิดตรวจสอบ</button></div>)}</div></section>}

      <section className={`${showSettings ? 'hidden' : ''} grid gap-4 lg:grid-cols-2`}>
        <div className="rounded-2xl border border-indigo-100 bg-white p-4">
          <div className="flex items-center justify-between"><div><h3 className="font-bold text-slate-800">⏭️ กำลังจะโพสต์</h3><p className="mt-1 text-xs text-slate-500">แผนรอบถัดไปของแต่ละบัญชี</p></div><span className="rounded-full bg-indigo-50 px-2.5 py-1 text-[10px] font-bold text-indigo-600">{(runtime.plans || []).length} บัญชี</span></div>
          <div className="mt-3 space-y-2">
            {(runtime.plans || []).map((plan) => {
              const set = sets.find((item) => item.id === plan.nextPostSetId)
              const activeRun = plan.scheduleId
                ? (runtime.runs || []).find((run) => run.id === plan.scheduleId)
                : (runtime.runs || []).find((run) => run.accountId === plan.accountId && ['pending', 'posting'].includes(run.status))
              const activeSet = activeRun ? sets.find((item) => item.id === activeRun.postSetId) : null
              const displaySet = activeSet || set
              const propertyName = displaySet?.name || displaySet?.cd || displaySet?.propertyCode || activeRun?.name?.replace(/^อัตโนมัติ · /, '') || plan.nextPostSetName || (plan.state === 'inventory_empty' ? 'คิวหมด — ไม่มีห้องใหม่' : plan.randomPostSet ? 'สุ่มจากชุดโพสต์ทั้งหมด' : 'รอเลือกโพสต์')
              const scheduledGroup = plan.group || activeRun?.groups?.[0]
              return <div key={plan.scheduleId || plan.accountId} className="flex items-center gap-3 rounded-xl border border-slate-100 bg-slate-50 p-2.5">
                {displaySet?.images?.[0]?.url ? <img src={displaySet.images[0].url} alt="" className="h-11 w-11 rounded-lg object-cover" /> : <div className="grid h-11 w-11 place-items-center rounded-lg bg-white">📝</div>}
                <div className="min-w-0 flex-1"><p className="truncate text-sm font-bold text-slate-700">{propertyName}</p><p className="truncate text-[11px] text-slate-500">👤 {plan.accountName}{scheduledGroup && <> · 📁 {groupTitle(scheduledGroup, groups)}</>}</p></div>
                  <div className="shrink-0 text-right"><p className={`text-[11px] font-bold ${plan.state === 'inventory_empty' ? 'text-amber-600' : activeRun?.status === 'posting' ? 'text-amber-600' : 'text-indigo-600'}`}>{activeRun?.status === 'posting' ? '● กำลังโพสต์' : activeRun?.status === 'pending' ? 'อยู่ในคิว' : plan.state === 'inventory_empty' ? 'รอเพิ่มห้อง' : plan.state === 'completed' ? 'เสร็จแล้ว' : 'รอบถัดไป'}</p>{plan.nextRunAt && <p className="text-[10px] text-slate-400">🕒 {new Date(plan.nextRunAt).toLocaleString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</p>}{plan.scheduleId && <button type="button" onClick={() => deleteQueuedCampaign(plan.scheduleId)} title="ลบคิว" className="mt-1 rounded px-1.5 py-0.5 text-[11px] font-bold text-rose-600 hover:bg-rose-50">ลบ</button>}</div>
              </div>
            })}
            {!(runtime.plans || []).length && <p className="py-6 text-center text-sm text-slate-400">เปิดระบบและเลือกบัญชีเพื่อสร้างแผนโพสต์</p>}
          </div>
        </div>

        <div className="rounded-2xl border border-emerald-100 bg-white p-4">
          <div className="flex items-center justify-between"><div><h3 className="font-bold text-slate-800">✅ ส่งโพสต์ล่าสุด</h3><p className="mt-1 text-xs text-slate-500">โพสต์ที่ยืนยันแล้ว และรายการที่ต้องเปิดกลุ่มตรวจสอบ</p></div>{reviewItems.length > 0 && <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[10px] font-bold text-amber-700">รอตรวจ {reviewItems.length}</span>}</div>
          <div className="mt-3 max-h-64 space-y-2 overflow-auto">
            {(runtime.runs || []).flatMap((run) => (run.successfulResults || [])
              .map((result) => ({ ...result, run }))).slice(0, 12).map(({ run, group, postUrl, evidenceUrl, at }, index) => <div key={`${run.id}-${group}-${index}`} className="flex items-center gap-3 rounded-xl border border-slate-100 p-2.5">
              {evidenceUrl ? <a href={evidenceUrl} target="_blank" rel="noopener noreferrer" title="กดเพื่อดูภาพหลักฐานเต็ม"><img src={evidenceUrl} alt="ภาพหลักฐานโพสต์บน Facebook" className="h-12 w-16 rounded-lg border border-emerald-200 object-cover shadow-sm" /></a> : sets.find((item) => item.id === run.postSetId)?.images?.[0]?.url ? <img src={sets.find((item) => item.id === run.postSetId).images[0].url} alt="รูปห้อง (ยังไม่มีภาพหลักฐาน)" className="h-10 w-10 rounded-lg object-cover opacity-60" /> : <div className="grid h-10 w-10 place-items-center rounded-lg bg-slate-50">✓</div>}
              <div className="min-w-0 flex-1"><p className="truncate text-sm font-bold text-slate-700">{run.name.replace(/^อัตโนมัติ · /, '')}</p><p className="truncate text-[10px] text-slate-400">👤 {run.accountName} · 📁 {(group.match(/groups\/([^/?]+)/) || [])[1] || group}{at ? ` · ${new Date(at).toLocaleString('th-TH', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}` : ''}</p></div>
              {evidenceUrl && <a href={evidenceUrl} target="_blank" rel="noopener noreferrer" title="เปิดภาพหลักฐานที่ระบบตรวจพบ" className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-indigo-200 bg-indigo-50 text-sm text-indigo-700 hover:bg-indigo-100">📸</a>}
              <a href={isFacebookPostPermalink(postUrl) ? postUrl : group} target="_blank" rel="noopener noreferrer" title={isFacebookPostPermalink(postUrl) ? 'เปิดโพสต์จริงบน Facebook' : 'เปิดกลุ่ม Facebook'} aria-label="เปิดผลการโพสต์บน Facebook" className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-emerald-200 bg-emerald-50 text-sm text-emerald-700 transition hover:bg-emerald-100">{isFacebookPostPermalink(postUrl) ? '🔗' : '📁'}</a>
            </div>)}
            {reviewItems.slice(0, 12).map(({ run, group, evidenceUrl, at, verificationExpired }, index) => <div key={`review-${run.id}-${group}-${index}`} className="flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50/60 p-2.5">
              {evidenceUrl ? <a href={evidenceUrl} target="_blank" rel="noopener noreferrer" title="กดเพื่อดูภาพหลักฐานเต็ม"><img src={evidenceUrl} alt="ภาพหลักฐานที่ระบบตรวจพบ" className="h-12 w-16 rounded-lg border border-amber-300 object-cover shadow-sm" /></a> : sets.find((item) => item.id === run.postSetId)?.images?.[0]?.url ? <img src={sets.find((item) => item.id === run.postSetId).images[0].url} alt="รูปห้อง (กำลังรอภาพหลักฐาน)" className="h-10 w-10 rounded-lg object-cover opacity-60" /> : <div className="grid h-10 w-10 place-items-center rounded-lg bg-white">🕓</div>}
              <div className="min-w-0 flex-1"><p className="truncate text-sm font-bold text-slate-700">{run.name.replace(/^อัตโนมัติ · /, '')}</p><p className="truncate text-[10px] text-amber-700">{verificationExpired ? 'ยังยืนยันไม่ได้ · เปิดกลุ่มตรวจครั้งเดียว (ระบบจะไม่โพสต์ซ้ำ)' : 'ส่งแล้ว · ระบบกำลังตรวจ permalink (ไม่โพสต์ซ้ำ)'} · 📁 {(group.match(/groups\/([^/?]+)/) || [])[1] || group}{at ? ` · ${new Date(at).toLocaleString('th-TH', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}` : ''}</p></div>
              {evidenceUrl && <a href={evidenceUrl} target="_blank" rel="noopener noreferrer" className="shrink-0 rounded-lg border border-indigo-200 bg-white px-2.5 py-1.5 text-[10px] font-bold text-indigo-700 hover:bg-indigo-50">📸 หลักฐาน</a>}
              <a href={group} target="_blank" rel="noopener noreferrer" title="เปิดกลุ่มเพื่อติดตามโพสต์" className="shrink-0 rounded-lg border border-amber-300 bg-white px-2.5 py-1.5 text-[10px] font-bold text-amber-700 hover:bg-amber-100">เปิดติดตาม</a>
            </div>)}
            {sentTotal === 0 && reviewItems.length === 0 && <p className="py-6 text-center text-sm text-slate-400">ยังไม่มีประวัติส่งโพสต์จากระบบอัตโนมัติ</p>}
          </div>
        </div>
      </section>

      {error && <div className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">⚠️ {error}</div>}
    </form>
  )
}
