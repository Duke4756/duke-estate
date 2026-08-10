import { useEffect, useMemo, useState } from 'react'
import { getGroupCrawlHistory } from '../api'

const RECENT_MS = 6 * 60 * 60 * 1000

function formatDate(value) {
  if (!value) return 'ยังไม่เคยค้นหา'
  return new Date(value).toLocaleString('th-TH', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function GroupCrawlHistoryModal({ open, onClose, onApply, currentSkipped = [], configured = false }) {
  const [groups, setGroups] = useState([])
  const [selected, setSelected] = useState(new Set())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!open) return
    setLoading(true)
    setError(null)
    getGroupCrawlHistory()
      .then((data) => {
        const active = (data.groups || []).filter((group) => group.active !== false)
        setGroups(active)
        const current = new Set(currentSkipped)
        setSelected(new Set(active
          .filter((group) => {
            if (configured) return !current.has(group.key)
            const completed = new Date(group.crawl?.last_completed_at || 0).getTime()
            return !completed || Date.now() - completed >= RECENT_MS
          })
          .map((group) => group.key)))
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [open, configured, currentSkipped])

  const selectedCount = selected.size
  const skippedCount = useMemo(() => Math.max(0, groups.length - selectedCount), [groups.length, selectedCount])

  function toggle(key) {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function apply() {
    onApply(groups.filter((group) => !selected.has(group.key)).map((group) => group.key))
    onClose()
  }

  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 p-4" onClick={onClose}>
      <div className="w-full max-w-3xl rounded-2xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b px-5 py-4">
          <div>
            <h2 className="font-bold text-slate-800">🧭 ประวัติการค้นหารายกลุ่ม</h2>
            <p className="mt-1 text-xs text-slate-400">กลุ่มที่ค้นหาสำเร็จภายใน 6 ชั่วโมงจะถูกแนะนำให้ข้าม</p>
          </div>
          <button onClick={onClose} className="text-xl text-slate-400">✕</button>
        </div>
        <div className="max-h-[520px] space-y-2 overflow-auto p-5">
          {loading && <p className="py-8 text-center text-sm text-slate-400">กำลังโหลด...</p>}
          {error && <p className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">⚠️ {error}</p>}
          {!loading && groups.map((group) => {
            const checked = selected.has(group.key)
            const crawl = group.crawl
            return (
              <label key={group.key} className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 ${checked ? 'border-indigo-200 bg-indigo-50/40' : 'border-slate-200 bg-slate-50 opacity-70'}`}>
                <input type="checkbox" checked={checked} onChange={() => toggle(group.key)} className="h-4 w-4 accent-indigo-600" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-slate-700">{group.name || group.label}</p>
                  <p className="truncate text-[11px] text-slate-400">{group.url}</p>
                </div>
                <div className="shrink-0 text-right text-[11px] text-slate-500">
                  <p>{formatDate(crawl?.last_completed_at)}</p>
                  {crawl && <p>ลึก {crawl.last_depth || 0} ช่วง · ล่าสุดใหม่ {crawl.last_new_count || 0} · รวมใหม่ {crawl.total_new_count || 0}</p>}
                  <p className={checked ? 'font-bold text-indigo-600' : 'font-bold text-amber-600'}>{checked ? 'ค้นหารอบนี้' : 'ข้ามรอบนี้'}</p>
                </div>
              </label>
            )
          })}
        </div>
        <div className="flex items-center justify-between border-t px-5 py-3">
          <div className="flex gap-3 text-xs text-slate-500">
            <span>ค้นหา {selectedCount} กลุ่ม</span><span>ข้าม {skippedCount} กลุ่ม</span>
            <button onClick={() => setSelected(new Set(groups.map((group) => group.key)))} className="font-bold text-indigo-600">เลือกทั้งหมด</button>
            <button onClick={() => setSelected(new Set())} className="font-bold text-slate-500">ข้ามทั้งหมด</button>
          </div>
          <div className="flex gap-2">
            <button onClick={onClose} className="rounded-xl px-4 py-2 text-sm text-slate-500">ยกเลิก</button>
            <button onClick={apply} className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white">ใช้ตัวเลือกนี้</button>
          </div>
        </div>
      </div>
    </div>
  )
}
