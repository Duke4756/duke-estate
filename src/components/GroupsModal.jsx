import { useEffect, useState } from 'react'
import { getGroups, saveGroups } from '../api'

export default function GroupsModal({ open, onClose, onSaved }) {
  const [urls, setUrls] = useState([])
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!open) return
    setError(null)
    setLoading(true)
    getGroups()
      .then((d) => setUrls((d.groups || []).map((g) => g.url)))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [open])

  if (!open) return null

  const labelOf = (u) => (u.match(/groups\/([^/?]+)/) || [])[1] || u

  function addDraft() {
    const v = draft.trim()
    if (!v) return
    if (!/facebook\.com\/groups\//i.test(v)) {
      setError('ต้องเป็นลิงก์กลุ่ม Facebook เช่น https://www.facebook.com/groups/xxxx')
      return
    }
    if (urls.includes(v)) {
      setError('มีกลุ่มนี้อยู่แล้ว')
      return
    }
    setUrls([...urls, v])
    setDraft('')
    setError(null)
  }

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      const res = await saveGroups(urls)
      onSaved((res.groups || []).map((g) => g.url))
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-2xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h2 className="text-base font-bold text-slate-800">⚙️ ตั้งค่ากลุ่ม Facebook</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">
            ✕
          </button>
        </div>

        <div className="px-5 py-4 space-y-3">
          <p className="text-xs text-slate-400">
            เพิ่มหรือลบกลุ่มที่ต้องการมอนิเตอร์ — ยิ่งหลายกลุ่ม การดึงยิ่งใช้เวลานานขึ้น
          </p>

          {loading ? (
            <p className="text-sm text-slate-400 py-4 text-center">กำลังโหลด...</p>
          ) : (
            <ul className="space-y-2 max-h-64 overflow-auto">
              {urls.length === 0 && (
                <li className="text-sm text-slate-400 py-3 text-center">ยังไม่มีกลุ่ม</li>
              )}
              {urls.map((u) => (
                <li
                  key={u}
                  className="flex items-center justify-between gap-2 rounded-xl bg-slate-50 border border-slate-200 px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-700">📁 {labelOf(u)}</p>
                    <p className="text-[11px] text-slate-400 truncate">{u}</p>
                  </div>
                  <button
                    onClick={() => setUrls(urls.filter((x) => x !== u))}
                    className="shrink-0 rounded-lg px-2 py-1 text-xs font-semibold text-rose-600 hover:bg-rose-50"
                  >
                    ลบ
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="flex gap-2 pt-1">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addDraft()}
              placeholder="https://www.facebook.com/groups/..."
              className="flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400"
            />
            <button
              onClick={addDraft}
              className="rounded-xl bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-200"
            >
              + เพิ่ม
            </button>
          </div>

          {error && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-2.5 text-xs text-rose-700 whitespace-pre-line">
              ⚠️ {error}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3">
          <span className="text-xs text-slate-400">{urls.length} กลุ่ม</span>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="rounded-xl px-4 py-2 text-sm font-medium text-slate-500 hover:text-slate-700"
            >
              ยกเลิก
            </button>
            <button
              onClick={handleSave}
              disabled={saving || loading}
              className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {saving ? 'กำลังบันทึก...' : 'บันทึก & ดึงใหม่'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
