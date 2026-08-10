import { useEffect, useState } from 'react'
import { getGroups, saveGroups } from '../api'
import { hasGroup } from '../groupUrl'
import { GROUP_SETS } from '../groupSets'

export default function GroupsModal({ open, onClose, onSaved }) {
  const [items, setItems] = useState([]) // [{ url, active }]
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!open) return
    setError(null)
    setLoading(true)
    getGroups()
      .then((d) => setItems((d.groups || []).map((g) => ({
        url: g.url, active: g.active !== false, category: g.category || 'general', name: g.name || '',
      }))))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [open])

  if (!open) return null

  const labelOf = (u) => (u.match(/groups\/([^/?]+)/) || [])[1] || u
  const activeCount = items.filter((g) => g.active).length

  function addDraft() {
    const v = draft.trim()
    if (!v) return
    if (!/facebook\.com\/groups\//i.test(v)) {
      setError('ต้องเป็นลิงก์กลุ่ม Facebook เช่น https://www.facebook.com/groups/xxxx')
      return
    }
    if (hasGroup(items, v)) {
      setError('ไม่สามารถเพิ่มได้ เนื่องจากมีกลุ่มนี้อยู่แล้ว')
      return
    }
    setItems([...items, { url: v, active: true, category: 'general', name: '' }])
    setDraft('')
    setError(null)
  }

  function toggle(url) {
    setItems(items.map((g) => (g.url === url ? { ...g, active: !g.active } : g)))
  }

  function update(url, patch) {
    setItems(items.map((g) => (g.url === url ? { ...g, ...patch } : g)))
  }

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      const res = await saveGroups(items)
      onSaved(res.groups || [])
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
        className="w-full max-w-2xl rounded-2xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h2 className="text-base font-bold text-slate-800">⚙️ คลังกลุ่ม Facebook</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">
            ✕
          </button>
        </div>

        <div className="px-5 py-4 space-y-3">
          <p className="text-xs text-slate-400">
            คลังนี้ใช้ร่วมกันทั้งค้นหาโพสต์และโพสต์อัตโนมัติ — จัดกลุ่มเป็นชุดเพื่อเรียกใช้พร้อมกันได้
          </p>

          {loading ? (
            <p className="text-sm text-slate-400 py-4 text-center">กำลังโหลด...</p>
          ) : (
            <ul className="space-y-2 max-h-[420px] overflow-auto">
              {items.length === 0 && (
                <li className="text-sm text-slate-400 py-3 text-center">ยังไม่มีกลุ่ม</li>
              )}
              {items.map((g) => (
                <li
                  key={g.url}
                  className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2 transition ${
                    g.active ? 'bg-slate-50 border-slate-200' : 'bg-slate-50/40 border-slate-200/60'
                  }`}
                >
                  <div className={`min-w-0 flex-1 ${g.active ? '' : 'opacity-45'}`}>
                    <input
                      value={g.name}
                      onChange={(e) => update(g.url, { name: e.target.value })}
                      placeholder={labelOf(g.url)}
                      className="mb-1 w-full bg-transparent text-sm font-medium text-slate-700 outline-none"
                    />
                    <p className="text-[11px] text-slate-400 truncate">{g.url}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <select
                      value={g.category}
                      onChange={(e) => update(g.url, { category: e.target.value })}
                      className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs"
                    >
                      {GROUP_SETS.map((set) => <option key={set.id} value={set.id}>{set.label}</option>)}
                    </select>
                    {/* Active toggle */}
                    <button
                      onClick={() => toggle(g.url)}
                      title={g.active ? 'กำลังใช้งาน — คลิกเพื่อปิด' : 'ปิดอยู่ — คลิกเพื่อเปิด'}
                      className={`relative h-6 w-11 rounded-full transition ${
                        g.active ? 'bg-emerald-500' : 'bg-slate-300'
                      }`}
                    >
                      <span
                        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
                          g.active ? 'left-[22px]' : 'left-0.5'
                        }`}
                      />
                    </button>
                    <button
                      onClick={() => setItems(items.filter((x) => x.url !== g.url))}
                      className="rounded-lg px-2 py-1 text-xs font-semibold text-rose-600 hover:bg-rose-50"
                    >
                      ลบ
                    </button>
                  </div>
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
          <span className="text-xs text-slate-400">
            {items.length} กลุ่ม · ใช้งาน {activeCount}
          </span>
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
              {saving ? 'กำลังบันทึก...' : 'บันทึกคลังกลุ่ม'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
