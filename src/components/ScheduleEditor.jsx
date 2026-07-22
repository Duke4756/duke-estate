import { useEffect, useState } from 'react'
import { createSchedule, updateSchedule } from '../api'

const labelOf = (u) => (u.match(/groups\/([^/?]+)/) || [])[1] || u

export default function ScheduleEditor({ open, schedule, postSets, onClose, onSaved }) {
  const [name, setName] = useState('')
  const [postSetId, setPostSetId] = useState('')
  const [groups, setGroups] = useState([])
  const [draft, setDraft] = useState('')
  const [hours, setHours] = useState(0)
  const [mins, setMins] = useState(0)
  const [secs, setSecs] = useState(30)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!open) return
    setError(null)
    setDraft('')
    setName(schedule?.name || '')
    setPostSetId(schedule?.postSetId || postSets?.[0]?.id || '')
    setGroups(schedule?.groups || [])
    // Prefill delay from the remaining time of an edited schedule.
    if (schedule?.runAt) {
      const remainSec = Math.round(Math.max(0, new Date(schedule.runAt).getTime() - Date.now()) / 1000)
      setHours(Math.floor(remainSec / 3600))
      setMins(Math.floor((remainSec % 3600) / 60))
      setSecs(remainSec % 60)
    } else {
      setHours(0)
      setMins(0)
      setSecs(30)
    }
  }, [open, schedule, postSets])

  if (!open) return null

  function addGroup() {
    const v = draft.trim()
    if (!v) return
    if (!/facebook\.com\/groups\//i.test(v)) {
      setError('ต้องเป็นลิงก์กลุ่ม Facebook')
      return
    }
    if (groups.includes(v)) {
      setError('มีกลุ่มนี้อยู่แล้ว')
      return
    }
    setGroups([...groups, v])
    setDraft('')
    setError(null)
  }

  async function handleSave() {
    if (!postSetId) return setError('กรุณาเลือกชุดโพสต์')
    if (groups.length === 0) return setError('ต้องมีกลุ่มเป้าหมายอย่างน้อยหนึ่งกลุ่ม')
    const totalSec = Number(hours) * 3600 + Number(mins) * 60 + Number(secs)
    if (totalSec <= 0) return setError('ตั้งเวลาอย่างน้อย 1 วินาที')

    const runAt = new Date(Date.now() + totalSec * 1000).toISOString()
    setSaving(true)
    setError(null)
    try {
      if (schedule?.id) {
        await updateSchedule(schedule.id, { name, postSetId, groups, runAt, status: 'pending' })
      } else {
        await createSchedule({ name, postSetId, groups, runAt })
      }
      onSaved()
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 p-4" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-2xl bg-white shadow-xl max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h2 className="text-base font-bold text-slate-800">
            {schedule?.id
              ? '✏️ แก้ไขการตั้งเวลา'
              : schedule?.postSetId || (schedule?.groups?.length ?? 0) > 0
                ? '🔁 โพสต์ซ้ำ (สร้างการตั้งเวลาใหม่)'
                : '⏰ ตั้งเวลาโพสต์ใหม่'}
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">
            ✕
          </button>
        </div>

        <div className="px-5 py-4 space-y-4 overflow-auto">
          <div>
            <label className="text-xs font-semibold text-slate-500">ชื่อ (ไม่บังคับ)</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="เช่น โพสต์เช้า กลุ่มเช่าคอนโด"
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400"
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-slate-500">ชุดโพสต์</label>
            {postSets?.length ? (
              <select
                value={postSetId}
                onChange={(e) => setPostSetId(e.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400 bg-white"
              >
                {postSets.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} {s.images?.length ? `(${s.images.length} รูป)` : ''}
                  </option>
                ))}
              </select>
            ) : (
              <p className="mt-1 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                ยังไม่มีชุดโพสต์ — ไปสร้างที่แท็บ “📝 ชุดของโพสต์” ก่อน
              </p>
            )}
          </div>

          <div>
            <label className="text-xs font-semibold text-slate-500">
              กลุ่มเป้าหมาย ({groups.length})
            </label>
            <ul className="mt-1 space-y-1.5 max-h-32 overflow-auto">
              {groups.map((g) => (
                <li
                  key={g}
                  className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 border border-slate-200 px-2.5 py-1.5"
                >
                  <span className="text-xs text-slate-600 truncate">📁 {labelOf(g)}</span>
                  <button
                    onClick={() => setGroups(groups.filter((x) => x !== g))}
                    className="shrink-0 text-xs font-semibold text-rose-600 hover:underline"
                  >
                    ลบ
                  </button>
                </li>
              ))}
            </ul>
            <div className="mt-1.5 flex gap-2">
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addGroup()}
                placeholder="https://www.facebook.com/groups/..."
                className="flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400"
              />
              <button
                onClick={addGroup}
                className="rounded-xl bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-200"
              >
                ＋
              </button>
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-slate-500">โพสต์ในอีก</label>
            <div className="mt-1 flex items-center gap-2">
              <input
                type="number"
                min="0"
                value={hours}
                onChange={(e) => setHours(e.target.value)}
                className="w-20 rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400"
              />
              <span className="text-sm text-slate-500">ชั่วโมง</span>
              <input
                type="number"
                min="0"
                max="59"
                value={mins}
                onChange={(e) => setMins(e.target.value)}
                className="w-20 rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400"
              />
              <span className="text-sm text-slate-500">นาที</span>
              <input
                type="number"
                min="0"
                max="59"
                value={secs}
                onChange={(e) => setSecs(e.target.value)}
                className="w-20 rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400"
              />
              <span className="text-sm text-slate-500">วินาที</span>
            </div>
          </div>

          {error && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-2.5 text-xs text-rose-700 whitespace-pre-line">
              ⚠️ {error}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-5 py-3">
          <button onClick={onClose} className="rounded-xl px-4 py-2 text-sm font-medium text-slate-500 hover:text-slate-700">
            ยกเลิก
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {saving ? 'กำลังบันทึก...' : 'บันทึก'}
          </button>
        </div>
      </div>
    </div>
  )
}
