import { useEffect, useState } from 'react'
import { createPostSet, updatePostSet } from '../api'

const fileToDataUrl = (file) =>
  new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result)
    r.onerror = reject
    r.readAsDataURL(file)
  })

export default function PostSetEditor({ open, set, onClose, onSaved }) {
  const [name, setName] = useState('')
  const [text, setText] = useState('')
  const [existing, setExisting] = useState([]) // [{file, url}] kept from an edited set
  const [added, setAdded] = useState([]) // [dataUrl] newly picked
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!open) return
    setName(set?.name || '')
    setText(set?.text || '')
    setExisting(set?.images || [])
    setAdded([])
    setError(null)
  }, [open, set])

  if (!open) return null

  async function pickFiles(e) {
    const files = [...e.target.files]
    e.target.value = '' // allow re-picking same file
    try {
      const urls = await Promise.all(files.filter((f) => f.type.startsWith('image/')).map(fileToDataUrl))
      setAdded((a) => [...a, ...urls])
    } catch {
      setError('อ่านไฟล์รูปไม่สำเร็จ')
    }
  }

  async function handleSave() {
    if (!text.trim() && existing.length + added.length === 0) {
      setError('ต้องมีข้อความหรือรูปภาพอย่างน้อยหนึ่งอย่าง')
      return
    }
    setSaving(true)
    setError(null)
    try {
      if (set?.id) {
        await updatePostSet(set.id, {
          name,
          text,
          keepImages: existing.map((i) => i.file),
          newImages: added,
        })
      } else {
        await createPostSet({ name, text, images: added })
      }
      onSaved()
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const totalImages = existing.length + added.length

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 p-4" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-2xl bg-white shadow-xl max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h2 className="text-base font-bold text-slate-800">
            {set?.id ? '✏️ แก้ไขชุดโพสต์' : '📝 สร้างชุดโพสต์'}
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">
            ✕
          </button>
        </div>

        <div className="px-5 py-4 space-y-3 overflow-auto">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="ชื่อชุดโพสต์ (สำหรับอ้างอิง) เช่น โปรโมชั่นเดือนนี้"
            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400"
          />

          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={7}
            placeholder="เขียนข้อความโพสต์... (เหมือนโพสต์ใน Facebook)"
            className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-indigo-400 resize-y leading-relaxed"
          />

          {/* image thumbnails */}
          {totalImages > 0 && (
            <div className="grid grid-cols-4 gap-2">
              {existing.map((img) => (
                <div key={img.file} className="relative group aspect-square">
                  <img src={img.url} alt="" className="w-full h-full object-cover rounded-lg border border-slate-200" />
                  <button
                    onClick={() => setExisting((x) => x.filter((i) => i.file !== img.file))}
                    className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-rose-600 text-white text-xs grid place-items-center shadow"
                  >
                    ✕
                  </button>
                </div>
              ))}
              {added.map((d, i) => (
                <div key={i} className="relative group aspect-square">
                  <img src={d} alt="" className="w-full h-full object-cover rounded-lg border border-emerald-300" />
                  <button
                    onClick={() => setAdded((a) => a.filter((_, j) => j !== i))}
                    className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-rose-600 text-white text-xs grid place-items-center shadow"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}

          <label className="flex items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-200 py-3 text-sm font-medium text-slate-500 cursor-pointer hover:border-indigo-300 hover:text-indigo-600">
            🖼️ เพิ่มรูปภาพ
            <input type="file" accept="image/*" multiple onChange={pickFiles} className="hidden" />
          </label>

          {error && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-2.5 text-xs text-rose-700">⚠️ {error}</div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3">
          <span className="text-xs text-slate-400">{totalImages} รูป</span>
          <div className="flex gap-2">
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
    </div>
  )
}
