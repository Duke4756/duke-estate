import { useEffect, useState } from 'react'
import { getGroups, saveGroups, resolveGroupNames, getProjects } from '../api'
import { hasGroup } from '../groupUrl'

export default function GroupsModal({ open, onClose, onSaved, embedded = false }) {
  const [items, setItems] = useState([]) // [{ url, active }]
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [resolving, setResolving] = useState(false)
  const [projects, setProjects] = useState([])
  const [query, setQuery] = useState('')
  const [newCategory, setNewCategory] = useState('')
  const [newZone, setNewZone] = useState('')
  const [customCategories, setCustomCategories] = useState([])

  useEffect(() => {
    if (!open) return
    setError(null)
    setLoading(true)
    getGroups()
      .then((d) => setItems((d.groups || []).map((g) => ({
        url: g.url, active: g.active !== false, category: g.category || 'general', name: g.name || '', marketingTags: g.marketingTags || [], projectTags: g.projectTags || [], notes: g.notes || '', zone_tags: g.zone_tags || [], project_specific: g.project_specific === true, project_name: g.project_name || '', project_aliases: g.project_aliases || [], manual_tags: g.manual_tags || [],
      }))))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
    getProjects().then((d) => setProjects(d.projects || [])).catch(() => {})
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
    const urls = v.split(/\s+/).filter(Boolean)
    setItems(urls.reduce((list, url) => hasGroup(list, url) ? list : [...list, { url, active: true, category: 'general', name: '', marketingTags: [], projectTags: [], notes: '', zone_tags: [], project_specific: false, project_name: '', project_aliases: [], manual_tags: [] }], items))
    setDraft('')
    setError(null)
  }

  function toggle(url) {
    setItems(items.map((g) => (g.url === url ? { ...g, active: !g.active } : g)))
  }

  function update(url, patch) {
    setItems(items.map((g) => (g.url === url ? { ...g, ...patch } : g)))
  }

  const categories = [...new Set(['CONDO', 'HOUSE', ...customCategories, ...items.map((item) => item.category).filter(Boolean)])]
  const zones = [...new Set(items.flatMap((item) => item.zone_tags || []))].sort()
  function addCategory() {
    const value = newCategory.trim().toUpperCase()
    if (!value || categories.includes(value)) return
    setCustomCategories((current) => [...new Set([...current, value])])
    setNewCategory('')
  }
  function removeCategory(value) {
    if (['CONDO', 'HOUSE'].includes(value)) return
    setCustomCategories((current) => current.filter((category) => category !== value))
    setItems(items.map((item) => item.category === value ? { ...item, category: 'general' } : item))
  }
  function addZone() {
    const value = newZone.trim().toUpperCase()
    if (!value) return
    setItems(items.map((item) => item.zone_tags?.includes(value) ? item : item))
    setNewZone('')
    setQuery(value)
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

  async function resolveNames() {
    setResolving(true); setError(null)
    try {
      const result = await resolveGroupNames(items.map((item) => item.url))
      setItems(result.groups || items)
      const found = (result.resolved || []).filter((item) => item.ok).length
      setError(found ? `ตรวจพบชื่อกลุ่มแล้ว ${found} กลุ่ม` : 'ยังตรวจชื่อกลุ่มไม่ได้ กรุณาเปิด Facebook และล็อกอินก่อน')
    } catch (e) { setError(e.message) }
    finally { setResolving(false) }
  }

  return (
    <div
      className={embedded ? 'w-full' : 'fixed inset-0 z-50 grid place-items-center bg-slate-900/40 p-4'}
      onClick={onClose}
    >
      <div
        className={embedded ? 'w-full rounded-2xl border border-slate-200 bg-white shadow-sm' : 'w-full max-w-2xl rounded-2xl bg-white shadow-xl'}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div><h2 className="text-base font-bold text-slate-800">⚙️ ตั้งค่ากลุ่ม Facebook</h2><p className="mt-1 text-[11px] text-slate-400">หมวดหลัก: Condo / House · หมวดย่อย: Zone</p></div>
          <button type="button" disabled={resolving || loading || !items.length} onClick={resolveNames} className="mr-2 rounded-lg bg-indigo-50 px-3 py-1.5 text-xs font-bold text-indigo-700 disabled:opacity-50">{resolving ? 'กำลังเปิดตรวจ…' : '↻ ดึงชื่อจาก Facebook'}</button>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">
            ✕
          </button>
        </div>

        <div className="px-5 py-4 space-y-3">
          <datalist id="project-master-options">{projects.map((project) => <option key={project.id} value={project.id}>{project.canonical_name}</option>)}</datalist><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ค้นหากลุ่มหรือโครงการ…" className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" />
          <div className="rounded-xl border border-indigo-100 bg-indigo-50 p-3"><p className="text-xs font-bold text-indigo-900">หมวดหมู่และโซน</p><div className="mt-2 flex flex-wrap gap-2">{categories.map((category) => <span key={category} className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-1 text-[11px] font-semibold text-indigo-700">{category}{!['CONDO', 'HOUSE'].includes(category) && <button type="button" onClick={() => removeCategory(category)} title="ลบหมวดนี้" className="font-black text-rose-500">×</button>}</span>)}<input value={newCategory} onChange={(e) => setNewCategory(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addCategory()} placeholder="สร้างหมวดหลัก" className="w-32 rounded-lg border px-2 py-1 text-xs" /><button type="button" onClick={addCategory} className="rounded-lg bg-indigo-600 px-2 py-1 text-xs font-bold text-white">เพิ่ม</button></div><div className="mt-2 flex flex-wrap gap-2">{zones.map((zone) => <span key={zone} className="rounded-full bg-white px-2 py-1 text-[11px] font-semibold text-emerald-700">{zone}</span>)}<input value={newZone} onChange={(e) => setNewZone(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addZone()} placeholder="สร้างโซนย่อย" className="w-32 rounded-lg border px-2 py-1 text-xs" /><button type="button" onClick={addZone} className="rounded-lg bg-emerald-600 px-2 py-1 text-xs font-bold text-white">เพิ่ม</button></div></div>
          <p className="text-xs text-slate-400">ตั้งหมวด/โซนให้แต่ละกลุ่มได้จากช่องในรายการด้านล่าง แล้วกดบันทึก</p>

          {loading ? (
            <p className="text-sm text-slate-400 py-4 text-center">กำลังโหลด...</p>
          ) : (
            <ul className="space-y-2 max-h-[420px] overflow-auto">
              {items.length === 0 && (
                <li className="text-sm text-slate-400 py-3 text-center">ยังไม่มีกลุ่ม</li>
              )}
              {items.filter((g) => !query || `${g.name} ${g.url} ${(g.projectTags || []).join(' ')}`.toLowerCase().includes(query.toLowerCase()) || (projects || []).some((p) => (g.projectIds || []).includes(p.id) && `${p.canonical_name} ${(p.aliases || []).join(' ')}`.toLowerCase().includes(query.toLowerCase()))).map((g) => (
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
                    <p className="text-[11px] text-slate-400 truncate">{g.url}{g.memberCount ? ` · สมาชิก ${g.memberCount.toLocaleString('th-TH')} คน` : ''}</p>
                    {String(g.category).toUpperCase() === 'CONDO' && <input value={(g.marketingTags || []).join(',')} onChange={(e) => update(g.url, { marketingTags: e.target.value.split(',').map((x) => x.trim().toUpperCase()).filter(Boolean) })} placeholder="Tag เป้าหมาย: EXPAT,OWNER" className="mt-1 w-full bg-transparent text-[11px] text-indigo-600 outline-none" />}
                    <input value={(g.projectTags || []).join(',')} onChange={(e) => update(g.url, { projectTags: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} placeholder="โครงการ: Siri Residence" className="mt-1 w-full bg-transparent text-[11px] text-violet-600 outline-none" />
                    {String(g.category).toUpperCase() === 'CONDO' && <input value={(g.zone_tags || []).join(',')} onChange={(e) => update(g.url, { zone_tags: e.target.value.split(',').map((x) => x.trim().toUpperCase()).filter(Boolean) })} placeholder="โซน: SUKHUMVIT, RAMA9_RATCHADA, GENERAL" className="mt-1 w-full bg-transparent text-[11px] text-emerald-600 outline-none" />}
                    <input list="project-master-options" value={(g.projectIds || []).join(',')} onChange={(e) => update(g.url, { projectIds: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} placeholder="Project ID หลายรายการ" className="mt-1 w-full bg-transparent text-[11px] text-emerald-600 outline-none" />
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <select
                      value={['CONDO', 'HOUSE'].includes(String(g.category).toUpperCase()) ? String(g.category).toUpperCase() : ''}
                      onChange={(e) => update(g.url, { category: e.target.value, ...(e.target.value === 'HOUSE' ? { zone_tags: [] } : {}) })}
                      className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs"
                    >
                      <option value="">ยังไม่จัดหมวด</option>
                      <option value="CONDO">คอนโด</option>
                      <option value="HOUSE">บ้าน</option>
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
