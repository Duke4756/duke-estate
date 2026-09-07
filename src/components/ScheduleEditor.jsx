import { useEffect, useMemo, useRef, useState } from 'react'
import { hasGroup } from '../groupUrl'
import { createSchedule, createScheduleBatch, getAccounts, getGroups, resolveGroupNames, saveGroups, updateSchedule } from '../api'
import { GROUP_SETS, groupSetLabel, selectGroupSet } from '../groupSets'

const labelOf = (u) => (u.match(/groups\/([^/?]+)/) || [])[1] || u

function toDateTimeLocal(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
}

function defaultDateTime() {
  return toDateTimeLocal(Date.now() + 35 * 60_000)
}

export default function ScheduleEditor({ open, schedule, postSets, onClose, onSaved }) {
  const [name, setName] = useState('')
  const [selectedIds, setSelectedIds] = useState([])
  const [groups, setGroups] = useState([])
  const [savedGroups, setSavedGroups] = useState([])
  const [groupMode, setGroupMode] = useState('random')
  const [groupDraft, setGroupDraft] = useState('')
  const [runAtLocal, setRunAtLocal] = useState(defaultDateTime)
  const [intervalMinutes, setIntervalMinutes] = useState(30)
  const [jitterMinutes, setJitterMinutes] = useState(5)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [postSetQuery, setPostSetQuery] = useState('')
  const [groupQuery, setGroupQuery] = useState('')
  const [groupCategory, setGroupCategory] = useState('all')
  const [showSelectedGroupsOnly, setShowSelectedGroupsOnly] = useState(false)
  const [editingGroupUrl, setEditingGroupUrl] = useState(null)
  const [librarySaving, setLibrarySaving] = useState(false)
  const [resolvingNames, setResolvingNames] = useState(false)
  const [accounts, setAccounts] = useState([])
  const [accountId, setAccountId] = useState('primary')
  const dragSelection = useRef({ active: false, select: true, visited: new Set() })
  const suppressClick = useRef(false)
  const groupDragSelection = useRef({ active: false, select: true, visited: new Set() })
  const suppressGroupClick = useRef(false)

  const isEditing = Boolean(schedule?.id)
  const isBatch = !isEditing && selectedIds.length > 1
  const selectedSets = useMemo(() => postSets.filter((set) => selectedIds.includes(set.id)), [postSets, selectedIds])
  const visiblePostSets = useMemo(() => {
    const query = postSetQuery.trim().toLowerCase()
    return query ? postSets.filter((set) => String(set.name || '').toLowerCase().includes(query)) : postSets
  }, [postSets, postSetQuery])
  const visibleSavedGroups = useMemo(() => {
    const query = groupQuery.trim().toLowerCase()
    return savedGroups.filter((group) => {
      if (groupCategory !== 'all' && group.category !== groupCategory) return false
      if (showSelectedGroupsOnly && !groups.includes(group.url)) return false
      if (!query) return true
      return [group.name, group.label, labelOf(group.url), group.url, group.category]
        .join(' ')
        .toLowerCase()
        .includes(query)
    })
  }, [savedGroups, groups, groupQuery, groupCategory, showSelectedGroupsOnly])

  useEffect(() => {
    if (!open) return
    setError(null)
    setName(schedule?.name || '')
    setSelectedIds(schedule?.postSetId ? [schedule.postSetId] : postSets?.[0]?.id ? [postSets[0].id] : [])
    setGroups(schedule?.groups || [])
    setGroupMode(schedule?.groupMode || 'random')
    setGroupDraft('')
    setRunAtLocal(schedule?.runAt ? toDateTimeLocal(schedule.runAt) : defaultDateTime())
    setIntervalMinutes(30)
    setJitterMinutes(5)
    setPostSetQuery('')
    setGroupQuery('')
    setGroupCategory('all')
    setShowSelectedGroupsOnly(false)
    setEditingGroupUrl(null)
    setAccountId(schedule?.accountId || 'primary')
    getAccounts().then((data) => setAccounts(data.accounts || [])).catch((e) => setError(e.message))
    getGroups()
      .then((data) => {
        const activeGroups = (data.groups || []).filter((group) => group.active !== false)
        setSavedGroups(activeGroups)
        if (schedule?.id) {
          const activeUrls = new Set(activeGroups.map((group) => group.url))
          setGroups((current) => current.filter((url) => activeUrls.has(url)))
        }
      })
      .catch((e) => setError(e.message))
    // Deliberately do not depend on postSets: the parent polls every 5 seconds
    // and receives a new array each time. Depending on it reset the user's
    // in-progress checkbox draft even though the modal stayed open.
  }, [open, schedule?.id])

  useEffect(() => {
    const stopDragging = () => {
      dragSelection.current.active = false
      dragSelection.current.visited.clear()
      groupDragSelection.current.active = false
      groupDragSelection.current.visited.clear()
    }
    window.addEventListener('pointerup', stopDragging)
    window.addEventListener('pointercancel', stopDragging)
    return () => {
      window.removeEventListener('pointerup', stopDragging)
      window.removeEventListener('pointercancel', stopDragging)
    }
  }, [])

  if (!open) return null

  function togglePostSet(id) {
    if (isEditing) return
    setSelectedIds((ids) => (ids.includes(id) ? ids.filter((value) => value !== id) : [...ids, id]))
  }

  function applyDragSelection(id) {
    const drag = dragSelection.current
    if (!drag.active || drag.visited.has(id)) return
    drag.visited.add(id)
    setSelectedIds((ids) => drag.select
      ? (ids.includes(id) ? ids : [...ids, id])
      : ids.filter((value) => value !== id))
  }

  function beginDragSelection(event, id) {
    if (isEditing || event.button !== 0) return
    const shouldSelect = !selectedIds.includes(id)
    dragSelection.current = { active: true, select: shouldSelect, visited: new Set() }
    suppressClick.current = true
    applyDragSelection(id)
    event.preventDefault()
  }

  function toggleGroup(url) {
    setGroups((current) => {
      if (current.includes(url)) {
        setError(null)
        return current.filter((value) => value !== url)
      }
      if (groupMode === 'selected' && current.length >= 3) {
        setError('โหมดเลือกเองเลือกได้สูงสุด 3 กลุ่มต่อหนึ่งโพสต์')
        return current
      }
      setError(null)
      return [...current, url]
    })
  }

  function applyGroupDragSelection(url) {
    const drag = groupDragSelection.current
    if (!drag.active || drag.visited.has(url)) return
    drag.visited.add(url)
    setGroups((current) => {
      if (!drag.select) return current.filter((value) => value !== url)
      if (current.includes(url)) return current
      if (groupMode === 'selected' && current.length >= 3) return current
      return [...current, url]
    })
  }

  function beginGroupDragSelection(event, url) {
    if (event.button !== 0 || editingGroupUrl) return
    groupDragSelection.current = {
      active: true,
      select: !groups.includes(url),
      visited: new Set(),
    }
    suppressGroupClick.current = true
    applyGroupDragSelection(url)
    event.preventDefault()
  }

  function toggleVisibleGroups() {
    const visibleUrls = visibleSavedGroups.map((group) => group.url)
    const allSelected = visibleUrls.length > 0 && visibleUrls.every((url) => groups.includes(url))
    if (allSelected) {
      setGroups((current) => current.filter((url) => !visibleUrls.includes(url)))
      return
    }
    setGroups((current) => {
      const missing = visibleUrls.filter((url) => !current.includes(url))
      const allowed = groupMode === 'selected'
        ? missing.slice(0, Math.max(0, 3 - current.length))
        : missing
      return [...current, ...allowed]
    })
  }

  function applyGroupSet(setId) {
    const selected = selectGroupSet(savedGroups, setId, groupMode)
    setGroups(selected)
    setError(selected.length
      ? (groupMode === 'selected' && savedGroups.filter((group) => group.category === setId).length > 3
        ? `เลือก 3 กลุ่มแรกจากชุด “${groupSetLabel(setId)}” ตามข้อจำกัดโหมดเลือกเอง`
        : null)
      : `ชุด “${groupSetLabel(setId)}” ยังไม่มีกลุ่มที่เปิดใช้งาน`)
  }

  async function addGroupToLibrary() {
    const url = groupDraft.trim()
    if (!/facebook\.com\/groups\//i.test(url)) return setError('ต้องเป็นลิงก์กลุ่ม Facebook เช่น https://www.facebook.com/groups/xxxx')
    if (hasGroup(savedGroups, url)) {
      setError('ไม่สามารถเพิ่มได้ เนื่องจากมีกลุ่มนี้อยู่แล้ว')
      return
    }
    const cannotSelect = groupMode === 'selected' && !groups.includes(url) && groups.length >= 3
    try {
      const saved = await saveGroups([...savedGroups, { url, active: true }])
      // saveGroups returns the API response object ({ groups }), whereas the
      // picker below needs the actual array. Keeping the response object here
      // makes the next render crash at `savedGroups.map(...)`.
      setSavedGroups(saved.groups || [])
      setGroupDraft('')
      setGroups((current) => {
        if (current.includes(url) || cannotSelect) return current
        return [...current, url]
      })
      setError(cannotSelect ? 'บันทึกกลุ่มเข้าคลังแล้ว แต่โหมดเลือกเองเลือกได้สูงสุด 3 กลุ่มต่อหนึ่งโพสต์' : null)
    } catch (e) {
      setError(e.message)
    }
  }

  async function refreshGroupNames() {
    if (!savedGroups.length || resolvingNames) return
    setResolvingNames(true)
    try {
      const result = await resolveGroupNames(savedGroups.map((group) => group.url))
      setSavedGroups(result.groups || savedGroups)
    } catch (e) { setError(e.message) } finally { setResolvingNames(false) }
  }

  async function updateLibraryGroup(url, patch) {
    const next = savedGroups.map((group) => (group.url === url ? { ...group, ...patch } : group))
    setSavedGroups(next)
  }

  async function commitLibraryChanges() {
    setLibrarySaving(true)
    setError(null)
    try {
      const saved = await saveGroups(savedGroups)
      setSavedGroups(saved.groups || [])
      setEditingGroupUrl(null)
    } catch (e) {
      setError(e.message)
    } finally {
      setLibrarySaving(false)
    }
  }

  async function removeLibraryGroup(group) {
    const title = group.name || group.label || labelOf(group.url)
    if (!window.confirm(`ลบกลุ่ม “${title}” ออกจากคลังหรือไม่?`)) return
    const next = savedGroups.filter((item) => item.url !== group.url)
    setLibrarySaving(true)
    setError(null)
    try {
      const saved = await saveGroups(next)
      setSavedGroups(saved.groups || [])
      setGroups((current) => current.filter((url) => url !== group.url))
      if (editingGroupUrl === group.url) setEditingGroupUrl(null)
    } catch (e) {
      setError(e.message)
      setSavedGroups(savedGroups)
    } finally {
      setLibrarySaving(false)
    }
  }

  async function handleSave() {
    if (!selectedIds.length) return setError('กรุณาเลือกชุดโพสต์อย่างน้อยหนึ่งชุด')
    if (groups.length === 0) return setError('เลือกกลุ่มจากคลังอย่างน้อยหนึ่งกลุ่ม')
    if (groupMode === 'selected' && groups.length > 3) return setError('โหมดเลือกเองเลือกได้สูงสุด 3 กลุ่มต่อหนึ่งโพสต์')
    const scheduledTime = new Date(runAtLocal)
    if (!runAtLocal || Number.isNaN(scheduledTime.getTime()) || scheduledTime.getTime() <= Date.now()) {
      return setError('วันและเวลาเริ่มต้นต้องอยู่ในอนาคต')
    }
    if (isBatch && Number(intervalMinutes) < 30) return setError('คิวหลายโพสต์ต้องเว้นอย่างน้อย 30 นาที')
    setSaving(true)
    setError(null)
    try {
      if (isEditing) {
        await updateSchedule(schedule.id, {
          name,
          postSetId: selectedIds[0],
          groups,
          groupMode,
          runAt: scheduledTime.toISOString(),
          status: 'pending',
          accountId,
        })
      } else if (isBatch) {
        await createScheduleBatch({
          name,
          // Keep the queue deterministic in the visual post-set order; users
          // can tick in any order without accidentally changing the sequence.
          postSetIds: selectedSets.map((set) => set.id),
          groups,
          groupMode,
          runAt: scheduledTime.toISOString(),
          intervalMinutes: Number(intervalMinutes),
          jitterMinutes: Number(jitterMinutes),
          accountId,
        })
      } else {
        await createSchedule({ name, postSetId: selectedIds[0], groups, groupMode, runAt: scheduledTime.toISOString(), accountId })
      }
      onSaved()
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const firstRun = runAtLocal ? new Date(runAtLocal).getTime() : 0
  const lastRun = isBatch ? firstRun + (selectedIds.length - 1) * (Number(intervalMinutes) + Number(jitterMinutes || 0)) * 60_000 : firstRun

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 p-4" onClick={onClose}>
      <div className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-100 bg-white px-6 py-4">
          <div>
            <h2 className="text-base font-bold text-slate-800">{isEditing ? '✏️ แก้ไขการตั้งเวลา' : '⏰ สร้างคิวโพสต์'}</h2>
            {!isEditing && <p className="mt-0.5 text-xs text-slate-400">เลือกหลายชุดโพสต์เพื่อให้ระบบเรียงเวลาให้อัตโนมัติ</p>}
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">✕</button>
        </div>

        <div className="space-y-5 overflow-auto px-6 py-5">
          <div>
            <label className="text-xs font-semibold text-slate-500">ชื่อคิว (ไม่บังคับ)</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="เช่น คิวลงประกาศช่วงบ่าย" className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400" />
          </div>

          <div>
            <label className="text-xs font-semibold text-slate-500">บัญชีที่ใช้โพสต์</label>
            <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm">
              {accounts.filter((account) => account.ready).map((account) => <option key={account.id} value={account.id}>{account.name}{account.id === 'primary' ? ' (เดิม)' : ''}</option>)}
            </select>
          </div>

          <div>
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-slate-500">เลือกชุดโพสต์ {isEditing ? '' : '(เลือกได้หลายรายการ)'}</label>
              {!isEditing && <span className="rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-bold text-indigo-700">เลือกแล้ว {selectedIds.length} รายการ</span>}
            </div>
            {!isEditing && <div className="mt-2 flex gap-2">
              <input value={postSetQuery} onChange={(e) => setPostSetQuery(e.target.value)} placeholder="🔎 ค้นหาชื่อชุดโพสต์..." className="min-w-0 flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400" />
              <button type="button" onClick={() => setSelectedIds((ids) => {
                const visibleIds = visiblePostSets.map((set) => set.id)
                const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => ids.includes(id))
                return allVisibleSelected ? ids.filter((id) => !visibleIds.includes(id)) : [...new Set([...ids, ...visibleIds])]
              })} className="rounded-xl border border-indigo-200 px-3 py-2 text-xs font-semibold text-indigo-600 hover:bg-indigo-50">
                {visiblePostSets.length > 0 && visiblePostSets.every((set) => selectedIds.includes(set.id)) ? 'ล้างที่แสดง' : 'เลือกที่แสดง'}
              </button>
              {selectedIds.length > 0 && <button type="button" onClick={() => setSelectedIds([])} className="rounded-xl px-2 py-2 text-xs font-semibold text-rose-500 hover:bg-rose-50">ล้างทั้งหมด</button>}
            </div>}
            {!isEditing && <div className="mt-2 flex items-center justify-between rounded-xl border border-indigo-100 bg-indigo-50/70 px-3 py-2">
              <span className="text-xs text-indigo-700">🖱️ กดค้างแล้วลากผ่านหลายรายการเพื่อเลือก/เอาออก</span>
              <button type="button" onClick={() => setSelectedIds(postSets.map((set) => set.id))} className="shrink-0 text-xs font-bold text-indigo-700 hover:underline">เลือกทั้งหมด {postSets.length}</button>
            </div>}
            <div className="mt-1.5 grid max-h-56 grid-cols-1 gap-2 overflow-auto rounded-xl p-1 select-none sm:grid-cols-2">
              {visiblePostSets.map((set) => {
                const selected = selectedIds.includes(set.id)
                return <button
                  type="button"
                  key={set.id}
                  aria-pressed={selected}
                  onPointerDown={(event) => beginDragSelection(event, set.id)}
                  onPointerEnter={() => applyDragSelection(set.id)}
                  onClick={() => {
                    if (suppressClick.current) {
                      suppressClick.current = false
                      return
                    }
                    togglePostSet(set.id)
                  }}
                  className={`flex items-center gap-2 rounded-xl border p-2.5 text-left transition ${selected ? 'border-indigo-500 bg-indigo-50 ring-1 ring-indigo-200' : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'}`}
                >
                  <span className={`grid h-5 w-5 shrink-0 place-items-center rounded border text-xs ${selected ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-slate-300 bg-white text-transparent'}`}>✓</span>
                  <span className="min-w-0"><span className="block truncate text-sm font-semibold text-slate-700">{set.name}</span><span className="block text-xs text-slate-400">{set.images?.length || 0} รูป</span></span>
                </button>
              })}
            </div>
            {visiblePostSets.length === 0 && postSets.length > 0 && <p className="mt-3 text-center text-xs text-slate-400">ไม่พบชุดโพสต์ที่ค้นหา</p>}
            {!postSets?.length && <p className="mt-1 text-xs text-amber-700">ยังไม่มีชุดโพสต์</p>}
          </div>

          <section className="rounded-2xl border border-slate-200 bg-slate-50/50 p-3.5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-slate-800">เลือกกลุ่มปลายทาง</h3>
                <p className="mt-0.5 text-xs text-slate-400">กดค้างแล้วลากผ่านหลายกลุ่มเพื่อเลือกหรือเอาออก</p>
              </div>
              <div className="flex items-center gap-2"><button type="button" onClick={refreshGroupNames} disabled={resolvingNames || !savedGroups.length} className="rounded-lg border border-indigo-200 bg-white px-2.5 py-1.5 text-[11px] font-bold text-indigo-700 disabled:opacity-40">{resolvingNames ? 'กำลังดึงชื่อ…' : '↻ อัปเดตชื่อกลุ่ม'}</button><span className="shrink-0 rounded-full bg-indigo-100 px-3 py-1 text-xs font-bold text-indigo-700">เลือกแล้ว {groups.length} กลุ่ม</span></div>
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(220px,1fr)_auto_auto]">
              <label className="relative">
                <span className="pointer-events-none absolute left-3 top-2 text-sm text-slate-400">⌕</span>
                <input value={groupQuery} onChange={(e) => setGroupQuery(e.target.value)} placeholder="ค้นหาชื่อ หมวดหมู่ หรือลิงก์กลุ่ม…" className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-8 pr-3 text-sm outline-none focus:border-indigo-400" />
              </label>
              <button type="button" onClick={() => setShowSelectedGroupsOnly((value) => !value)} className={`rounded-xl border px-3 py-2 text-xs font-semibold ${showSelectedGroupsOnly ? 'border-indigo-400 bg-indigo-50 text-indigo-700' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}>{showSelectedGroupsOnly ? 'แสดงทั้งหมด' : 'เฉพาะที่เลือก'}</button>
              <button type="button" onClick={toggleVisibleGroups} className="rounded-xl border border-indigo-200 bg-white px-3 py-2 text-xs font-semibold text-indigo-600 hover:bg-indigo-50">
                {visibleSavedGroups.length > 0 && visibleSavedGroups.every((group) => groups.includes(group.url)) ? 'ล้างที่แสดง' : 'เลือกที่แสดง'}
              </button>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5" role="tablist" aria-label="หมวดหมู่กลุ่ม">
              <button type="button" onClick={() => setGroupCategory('all')} className={`rounded-full px-3 py-1.5 text-xs font-bold ${groupCategory === 'all' ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600 border border-slate-200'}`}>ทุกหมวด · {savedGroups.length}</button>
              {GROUP_SETS.map((set) => {
                const count = savedGroups.filter((group) => group.category === set.id).length
                return <button key={set.id} type="button" onClick={() => setGroupCategory(set.id)} className={`rounded-full px-3 py-1.5 text-xs font-bold ${groupCategory === set.id ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600 border border-slate-200'}`}>{set.label} · {count}</button>
              })}
            </div>
            <div className="mt-2 flex items-center justify-between rounded-xl bg-indigo-50 px-3 py-2 text-xs text-indigo-700">
              <span>🖱️ ลากเพื่อเลือกได้เหมือนชุดโพสต์</span>
              {groups.length > 0 && <button type="button" onClick={() => setGroups([])} className="font-bold text-rose-600 hover:underline">ล้างทั้งหมด</button>}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-xs font-semibold text-slate-500">เลือกเป็นชุด:</span>
              {GROUP_SETS.map((set) => {
                const count = savedGroups.filter((group) => group.category === set.id).length
                return <button key={set.id} type="button" disabled={!count} onClick={() => applyGroupSet(set.id)} className="rounded-full border border-indigo-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-indigo-700 hover:bg-indigo-50 disabled:opacity-35">{set.label} · {count}</button>
              })}
            </div>
            <div className="mt-2 grid max-h-60 grid-cols-1 gap-2 overflow-auto rounded-xl select-none sm:grid-cols-2">
              {visibleSavedGroups.map((group) => {
                const selected = groups.includes(group.url)
                const editing = editingGroupUrl === group.url
                return <div
                  key={group.url}
                  onPointerDown={(event) => !editing && beginGroupDragSelection(event, group.url)}
                  onPointerEnter={() => !editing && applyGroupDragSelection(group.url)}
                  className={`rounded-xl border p-2.5 transition ${editing ? 'sm:col-span-2' : 'cursor-pointer'} ${selected ? 'border-indigo-500 bg-indigo-50 ring-1 ring-indigo-100' : 'border-slate-200 bg-white hover:border-slate-300'}`}
                >
                  {editing ? (
                    <div className="space-y-2">
                      <input
                        autoFocus
                        value={group.name || ''}
                        onChange={(e) => updateLibraryGroup(group.url, { name: e.target.value })}
                        placeholder={group.label || labelOf(group.url)}
                        className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs outline-none focus:border-indigo-400"
                      />
                      <div className="flex gap-1.5">
                        <select
                          value={group.category || 'general'}
                          onChange={(e) => updateLibraryGroup(group.url, { category: e.target.value })}
                          className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs"
                        >
                          {GROUP_SETS.map((set) => <option key={set.id} value={set.id}>{set.label}</option>)}
                        </select>
                        <button type="button" onClick={commitLibraryChanges} disabled={librarySaving} className="rounded-lg bg-indigo-600 px-2.5 py-1.5 text-xs font-semibold text-white disabled:opacity-50">บันทึก</button>
                        <button type="button" onClick={() => { setEditingGroupUrl(null); getGroups().then((data) => setSavedGroups(data.groups || [])).catch(() => {}) }} className="rounded-lg px-2 py-1.5 text-xs text-slate-500 hover:bg-slate-100">ยกเลิก</button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <button type="button" aria-pressed={selected} onClick={() => {
                        if (suppressGroupClick.current) {
                          suppressGroupClick.current = false
                          return
                        }
                        toggleGroup(group.url)
                      }} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                        <span className={`grid h-5 w-5 shrink-0 place-items-center rounded border text-xs ${selected ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-slate-300 bg-white text-transparent'}`}>✓</span>
                        <span className="min-w-0">
                          <span className="block truncate text-xs font-medium text-slate-700">📁 {group.name || group.label || labelOf(group.url)}</span>
                          <span className="block truncate text-[10px] text-slate-400">ชุด: {groupSetLabel(group.category)}</span>
                        </span>
                      </button>
                      <button type="button" onPointerDown={(e) => e.stopPropagation()} onClick={() => setEditingGroupUrl(group.url)} title="แก้ไขชื่อและหมวดหมู่" className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-xs text-indigo-600 hover:bg-indigo-100">✏️</button>
                      <button type="button" onPointerDown={(e) => e.stopPropagation()} onClick={() => removeLibraryGroup(group)} disabled={librarySaving} title="ลบออกจากคลัง" className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-xs text-rose-500 hover:bg-rose-50 disabled:opacity-40">🗑</button>
                    </div>
                  )}
                </div>
              })}
              {!visibleSavedGroups.length && <p className="col-span-full py-6 text-center text-xs text-slate-400">{savedGroups.length ? 'ไม่พบกลุ่มที่ตรงกับตัวกรอง' : 'ยังไม่มีกลุ่มในคลัง'}</p>}
            </div>
            <div className="mt-2 flex gap-2">
              <input value={groupDraft} onChange={(e) => setGroupDraft(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addGroupToLibrary()} placeholder="เพิ่มลิงก์กลุ่มใหม่เข้าคลัง..." className="flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400" />
              <button onClick={addGroupToLibrary} className="rounded-xl bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-200">＋ บันทึก</button>
            </div>
          </section>

          <div>
            <label className="text-xs font-semibold text-slate-500">รูปแบบการเลือกกลุ่ม</label>
            <div className="mt-1 flex gap-2">
              <button onClick={() => setGroupMode('random')} className={`flex-1 rounded-xl border px-3 py-2 text-left text-sm ${groupMode === 'random' ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-slate-200 text-slate-600'}`}><b>🎲 สุ่ม 1 กลุ่ม</b><span className="block text-xs opacity-75">เหมาะกับคิวหลายโพสต์</span></button>
              <button onClick={() => { setGroupMode('selected'); if (groups.length > 3) setGroups(groups.slice(0, 3)) }} className={`flex-1 rounded-xl border px-3 py-2 text-left text-sm ${groupMode === 'selected' ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-slate-200 text-slate-600'}`}><b>📁 เลือกเอง</b><span className="block text-xs opacity-75">1-3 กลุ่มต่อโพสต์</span></button>
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-slate-500">เวลาเริ่มต้น</label>
            <input type="datetime-local" value={runAtLocal} min={toDateTimeLocal(Date.now())} onChange={(e) => setRunAtLocal(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400" />
          </div>

          {isBatch && <div className="rounded-2xl border border-indigo-100 bg-indigo-50/60 p-3 space-y-3">
            <p className="text-sm font-semibold text-indigo-900">⚡ คิวอัตโนมัติ {selectedIds.length} รายการ</p>
            <div className="grid grid-cols-2 gap-3">
              <label className="text-xs font-semibold text-slate-600">เว้นช่วงขั้นต่ำ (นาที)<input type="number" min="30" max="1440" value={intervalMinutes} onChange={(e) => setIntervalMinutes(e.target.value)} className="mt-1 w-full rounded-lg border border-indigo-200 bg-white px-2 py-1.5 text-sm" /></label>
              <label className="text-xs font-semibold text-slate-600">สุ่มเพิ่ม 0- (นาที)<input type="number" min="0" max="30" value={jitterMinutes} onChange={(e) => setJitterMinutes(e.target.value)} className="mt-1 w-full rounded-lg border border-indigo-200 bg-white px-2 py-1.5 text-sm" /></label>
            </div>
            <p className="text-xs text-indigo-800">ระบบเรียงตามลำดับที่เลือก, เว้นอย่างน้อย {intervalMinutes || 0} นาที และสุ่มเลื่อนเวลาไปด้านหน้าไม่เกิน {jitterMinutes || 0} นาที จึงไม่ทำให้โพสต์ถี่กว่าเดิม</p>
            {firstRun > 0 && <p className="text-xs text-indigo-700">ประมาณการจบคิว: {new Date(lastRun).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' })}</p>}
          </div>}

          {error && <div className="rounded-xl border border-rose-200 bg-rose-50 p-2.5 text-xs text-rose-700 whitespace-pre-line">⚠️ {error}</div>}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-slate-100 bg-white px-6 py-3.5">
          <button onClick={onClose} className="rounded-xl px-4 py-2 text-sm font-medium text-slate-500">ยกเลิก</button>
          <button onClick={handleSave} disabled={saving} className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">{saving ? 'กำลังบันทึก...' : isBatch ? `สร้างคิว ${selectedSets.length} รายการ` : 'บันทึก'}</button>
        </div>
      </div>
    </div>
  )
}
