import { useEffect, useMemo, useState } from 'react'
import { getCampaignGroups, startCampaignEngine } from '../api'

export function defaultAccountPlan(campaign, accountId) {
  const existing = campaign.accountRules?.[accountId] || {}
  // The legacy account-schedule save action still validates a posting date,
  // even though this screen creates campaign queues automatically. Supply a
  // safe Bangkok date for old rules that do not yet have one.
  const tomorrowBangkok = new Date(Date.now() + (31 * 60 * 60 * 1000)).toISOString().slice(0, 10)
  return { ...existing, startDate: existing.startDate || tomorrowBangkok, slots: [] }
}

function groupTitle(group) {
  return group.name || group.label || group.url.replace(/^https?:\/\/(?:www\.)?facebook\.com\/groups\//, '').replace(/\/$/, '')
}

export default function AccountPostingSettings({ campaign, accounts = [], sets = [], groups = [], onOpenAccounts, onOpenGroupMembership = () => {}, membershipRevision = 0 }) {
  const availableAccounts = accounts.filter((account) => account.ready === true)
  const [activeId, setActiveId] = useState(availableAccounts[0]?.id || '')
  const [query, setQuery] = useState('')
  const [showProperties, setShowProperties] = useState(false)
  const [selected, setSelected] = useState([])
  const [selectedGroupUrls, setSelectedGroupUrls] = useState([])
  const [accountGroups, setAccountGroups] = useState([])
  const [groupsLoading, setGroupsLoading] = useState(false)
  const [groupCategory, setGroupCategory] = useState('ALL')
  const [groupZone, setGroupZone] = useState('ALL')
  const [type, setType] = useState('ALL')
  const [deal, setDeal] = useState('ALL')
  const [rounds, setRounds] = useState(1)
  const [result, setResult] = useState(null)
  const [busy, setBusy] = useState(false)

  const active = availableAccounts.find((account) => account.id === activeId) || availableAccounts[0]
  useEffect(() => {
    let cancelled = false
    setSelectedGroupUrls([])
    if (!active?.id) { setAccountGroups([]); return undefined }
    setGroupsLoading(true)
    getCampaignGroups(active.id)
      .then((response) => {
        if (cancelled) return
        setAccountGroups(response.groups || [])
      })
      .catch(() => { if (!cancelled) setAccountGroups([]) })
      .finally(() => { if (!cancelled) setGroupsLoading(false) })
    return () => { cancelled = true }
  }, [active?.id, membershipRevision])
  const visibleSets = sets.filter((set) => {
    const text = `${set.cd || ''} ${set.propertyCode || ''} ${set.name || ''} ${set.project || set.projectName || ''}`.toLowerCase()
    const kind = String(set.kind || set.category || '').toUpperCase()
    const sale = String(set.deal || '').toUpperCase()
    return (!query.trim() || text.includes(query.toLowerCase().trim())) && (type === 'ALL' || kind === type) && (deal === 'ALL' || sale === deal)
  })
  // Keep the shared library visible even if the per-account membership check
  // is temporarily unavailable. It avoids presenting an empty picker simply
  // because Facebook was slow to answer; UNKNOWN groups stay unselectable.
  const displayGroups = accountGroups.length ? accountGroups : groups
  const visibleGroups = useMemo(() => displayGroups.filter((group) => {
    const category = String(group.category || '').toUpperCase()
    return group.active !== false &&
      (groupCategory === 'ALL' || category === groupCategory) &&
      (groupZone === 'ALL' || (group.zone_tags || []).includes(groupZone))
  }), [displayGroups, groupCategory, groupZone])
  const zones = useMemo(() => [...new Set(displayGroups.flatMap((group) => group.zone_tags || []))].sort(), [displayGroups])

  function toggleProperty(id) {
    setSelected((ids) => ids.includes(id) ? ids.filter((value) => value !== id) : [...ids, id])
    setResult(null)
  }
  function toggleGroup(url) {
    setSelectedGroupUrls((urls) => urls.includes(url) ? urls.filter((value) => value !== url) : [...urls, url])
    setResult(null)
  }
  async function createQueue() {
    if (!active || !selected.length) return
    setBusy(true)
    try {
      const properties = selected.map((id) => {
        const set = sets.find((item) => item.id === id)
        return { ...set, cd: set?.cd || set?.propertyCode || set?.name, postSetId: id, category: set?.kind || 'CONDO' }
      })
      const planType = selected.length > 1 && selectedGroupUrls.length === 1 ? 'MULTI_PROPERTY_ONE_GROUP' : 'ONE_PROPERTY_MULTI_GROUP'
      const response = await startCampaignEngine({
        campaignId: `account-${active.id}`,
        accountId: active.id,
        planType,
        properties,
        targetGroupUrls: selectedGroupUrls,
        selectedZone: 'AUTO',
        mode: 'ROTATE',
        rounds: Math.max(1, Number(rounds) || 1),
        gapMinutes: campaign.accountGapMinutes || 65,
      })
      setResult(response)
      if (response.membershipResults?.length) {
        getCampaignGroups(active.id)
          .then((refreshed) => setAccountGroups(refreshed.groups || []))
          .catch(() => {})
      }
    } catch (error) {
      setResult({ error: error.message })
    } finally {
      setBusy(false)
    }
  }

  return <section className="space-y-4">
    <header className="rounded-2xl border border-slate-200 bg-white p-5">
      <h2 className="text-xl font-black">ตั้งค่าการตลาดตามบัญชี</h2>
      <p className="mt-1 text-sm text-slate-500">เลือกทรัพย์ เลือกกลุ่ม แล้วให้ระบบจัดคิวที่ปลอดภัย</p>
      {availableAccounts.length > 0 && <div className="mt-4 flex flex-wrap gap-2">
        {availableAccounts.map((account) => <button key={account.id} type="button" onClick={() => { setActiveId(account.id); setResult(null) }} className={`rounded-lg px-3 py-2 text-sm font-bold ${active?.id === account.id ? 'bg-violet-600 text-white' : 'bg-slate-100 text-slate-700'}`}>{account.name}</button>)}
      </div>}
      {!availableAccounts.length && <button type="button" onClick={onOpenAccounts} className="mt-3 font-bold text-violet-600">จัดการบัญชีและล็อกอิน</button>}
    </header>

    <section className="rounded-2xl border border-violet-200 bg-violet-50/40 p-5">
      <p className="text-sm font-bold text-slate-900">1. เลือกทรัพย์</p>
      <div className="mt-2 flex gap-2">
        <input value={query} onFocus={() => setShowProperties(true)} onChange={(event) => { setQuery(event.target.value); setShowProperties(true) }} placeholder="ค้นหาด้วย CD หรือชื่อโครงการ…" className="min-w-0 flex-1 rounded-l-xl border bg-white px-3 py-2" />
        <button type="button" onClick={() => setShowProperties((value) => !value)} className="rounded-r-xl border border-l-0 bg-white px-3" aria-label="แสดงรายการทรัพย์">⌄</button>
        <select value={type} onChange={(event) => setType(event.target.value)} className="rounded-xl border bg-white px-2"><option value="ALL">ทั้งหมด</option><option value="CONDO">คอนโด</option><option value="HOUSE">บ้าน</option></select>
        <select value={deal} onChange={(event) => setDeal(event.target.value)} className="rounded-xl border bg-white px-2"><option value="ALL">เช่า/ขาย</option><option value="RENT">เช่า</option><option value="SALE">ขาย</option></select>
      </div>
      {showProperties && <div className="mt-2 max-h-40 overflow-auto rounded-xl border bg-white p-2">{visibleSets.map((set) => <button key={set.id} type="button" onClick={() => toggleProperty(set.id)} className={`mr-2 mb-2 rounded-lg border px-3 py-2 text-xs font-semibold ${selected.includes(set.id) ? 'border-violet-600 bg-violet-600 text-white' : 'bg-white'}`}>{selected.includes(set.id) ? '✓ ' : ''}<b>{set.cd || set.propertyCode || ''}</b> {set.project || set.projectName || set.name}</button>)}{!visibleSets.length && <p className="p-2 text-sm text-slate-400">ไม่พบทรัพย์ที่ค้นหา</p>}</div>}
      {selected.length > 0 && <p className="mt-2 text-xs font-bold text-violet-700">เลือกทรัพย์แล้ว {selected.length} รายการ</p>}
    </section>

    <section className="rounded-2xl border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-bold text-slate-900">2. เลือกกลุ่ม</p><span className="text-xs text-slate-500">เลือกได้เฉพาะกลุ่มที่เข้าร่วมแล้ว · ไม่เลือก = ระบบเลือกอัตโนมัติ</span></div>
      <div className="mt-2 flex flex-wrap gap-2">
        <select value={groupCategory} onChange={(event) => setGroupCategory(event.target.value)} className="rounded-lg border px-2 py-1.5 text-sm"><option value="ALL">ทุกหมวด</option><option value="CONDO">คอนโด</option><option value="HOUSE">บ้าน</option><option value="MIXED">ใช้ได้ทั้งคู่</option></select>
        <select value={groupZone} onChange={(event) => setGroupZone(event.target.value)} className="rounded-lg border px-2 py-1.5 text-sm"><option value="ALL">ทุกโซน</option>{zones.map((zone) => <option key={zone} value={zone}>{zone}</option>)}</select>
        <span className="self-center text-xs font-medium text-violet-700">เลือก {selectedGroupUrls.length} กลุ่ม</span>
      </div>
      <div className="mt-2 max-h-40 overflow-auto rounded-xl border bg-slate-50 p-2">{visibleGroups.map((group) => {
        const isMember = group.membership === 'MEMBER'
        const requested = group.membership === 'REQUESTED'
        const notMember = group.membership === 'NOT_MEMBER'
        const canSelect = !requested && !notMember
        return <div key={group.url} className="mr-2 mb-2 inline-flex max-w-full items-center gap-1 rounded-lg border bg-white p-1 text-left text-xs">
          <button type="button" disabled={!canSelect} onClick={() => toggleGroup(group.url)} className={`inline-flex min-w-0 items-center gap-1 rounded-md px-2 py-1.5 disabled:cursor-default ${selectedGroupUrls.includes(group.url) ? 'bg-violet-600 text-white' : ''}`}><span>{selectedGroupUrls.includes(group.url) ? '✓' : '○'}</span><span className="truncate">{groupTitle(group)}</span><span className="opacity-70">· {group.category}{group.zone_tags?.length ? ` · ${group.zone_tags.join(', ')}` : ''}</span></button>
          {isMember ? <span className="px-1 text-[10px] font-bold text-emerald-600">เข้าร่วมแล้ว</span> : requested ? <span className="px-1 text-[10px] font-bold text-amber-600">รออนุมัติ</span> : notMember ? <button type="button" onClick={() => onOpenGroupMembership({ accountId: active.id, accountName: active.name, group: group.url })} className="rounded-md bg-violet-600 px-2 py-1.5 text-[10px] font-bold text-white hover:bg-violet-700">เข้าร่วม</button> : <span className="px-1 text-[10px] font-medium text-slate-400">ตรวจสอบไม่ได้</span>}
        </div>
      })}{groupsLoading && <p className="p-2 text-sm text-slate-400">กำลังตรวจสถานะสมาชิกของบัญชี…</p>}{!groupsLoading && !visibleGroups.length && <p className="p-2 text-sm text-slate-400">ยังไม่มีกลุ่มในคลัง กรุณาเพิ่มกลุ่มก่อน</p>}</div>
    </section>

    <section className="rounded-2xl border border-slate-200 bg-white p-5">
      <label className="block max-w-xs text-sm font-bold">จำนวนคิวต่อทรัพย์<input type="number" min="1" max="20" value={rounds} onChange={(event) => { setRounds(Math.max(1, Number(event.target.value) || 1)); setResult(null) }} className="mt-1 w-full rounded-xl border px-3 py-2" /><span className="mt-1 block text-xs font-normal text-slate-500">แต่ละทรัพย์จะถูกวางคิวตามจำนวนนี้ โดยหมุนในกลุ่มที่เลือก</span></label>
      <button type="button" disabled={busy || !selected.length || !active} onClick={createQueue} className="mt-4 rounded-xl bg-violet-600 px-4 py-2 font-bold text-white disabled:opacity-50">{busy ? 'กำลังสร้างคิว…' : 'สร้างคิว'}</button>
      {result && <div className={`mt-3 rounded-xl p-3 text-sm ${result.error || (!result.schedules?.length && result.membershipResults?.some((item) => item.membership !== 'MEMBER')) ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700'}`}>{result.error || (result.schedules?.length ? `✓ สร้างคิวแล้ว ${result.schedules.length} รายการ · ดูได้ที่ Monitor` : result.alreadyQueued ? `✓ รายการนี้มีคิวอยู่แล้ว ${result.alreadyQueued} งาน` : result.membershipResults?.some((item) => item.membership === 'NOT_MEMBER') ? 'กลุ่มที่เลือกมีบัญชีที่ยังไม่ได้เข้าร่วม — กด “เข้าร่วม” ที่กลุ่มนั้นก่อนสร้างคิวใหม่' : result.membershipResults?.some((item) => item.membership === 'REQUESTED') ? 'กลุ่มที่เลือกกำลังรออนุมัติ จึงยังสร้างคิวไม่ได้' : '⚠ ยังตรวจสอบการเป็นสมาชิกกลุ่มไม่สำเร็จ กรุณาลองใหม่')}</div>}
    </section>
  </section>
}
