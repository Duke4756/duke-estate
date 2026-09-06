import { useEffect, useState } from 'react'
import { createPostSet, disconnectJsaSession, finishJsaSession, getJsaSession, importPostSetUrl, startJsaSession, updatePostSet } from '../api'

const fileToDataUrl = (file) =>
  new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result)
    r.onerror = reject
    r.readAsDataURL(file)
  })

export default function PostSetEditor({ open, set, onClose, onSaved, kind, propertyType: initialPropertyType, deal: initialDeal }) {
  const [name, setName] = useState('')
  const [propertyType, setPropertyType] = useState('condo')
  const [deal, setDeal] = useState('rent')
  const [text, setText] = useState('')
  // A single list is important: it lets new and existing images be rearranged together.
  const [images, setImages] = useState([]) // [{id, type: 'existing'|'new', file?, url}]
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [draggingImages, setDraggingImages] = useState(false)
  const [sourceUrl, setSourceUrl] = useState('')
  const [importing, setImporting] = useState(false)
  const [jsaSession, setJsaSession] = useState({ connected: false, loginOpen: false })
  const [sessionBusy, setSessionBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setName(set?.name || '')
    setPropertyType(set?.kind || initialPropertyType || 'condo')
    setDeal(set?.deal || initialDeal || 'rent')
    setText(set?.text || '')
    setImages((set?.images || []).map((image) => ({
      id: `existing-${image.file}`,
      type: 'existing',
      ...image,
    })))
    setError(null)
    setDraggingImages(false)
    setSourceUrl(set?.sourceUrl || '')
    getJsaSession().then(setJsaSession).catch(() => {})
  }, [open, set, initialPropertyType, initialDeal])

  if (!open) return null

  async function addFiles(fileList) {
    const files = [...fileList]
    const images = files.filter((f) => f.type.startsWith('image/'))
    if (images.length === 0) {
      setError('กรุณาเลือกหรือลากวางไฟล์รูปภาพ')
      return
    }
    try {
      const urls = await Promise.all(images.map(fileToDataUrl))
      setImages((current) => [
        ...current,
        ...urls.map((url) => ({ id: `new-${crypto.randomUUID()}`, type: 'new', url })),
      ])
      setError(null)
    } catch {
      setError('อ่านไฟล์รูปไม่สำเร็จ')
    }
  }

  function pickFiles(e) {
    addFiles(e.target.files)
    e.target.value = '' // allow re-picking same file
  }

  function dropImages(e) {
    e.preventDefault()
    setDraggingImages(false)
    addFiles(e.dataTransfer.files)
  }

  async function handleSave() {
    if (!text.trim() && images.length === 0) {
      setError('ต้องมีข้อความหรือรูปภาพอย่างน้อยหนึ่งอย่าง')
      return
    }
    setSaving(true)
    setError(null)
    try {
      let saved
      if (set?.id) {
        saved = await updatePostSet(set.id, {
          name,
          propertyType,
          deal,
          text,
          keepImages: images.filter((image) => image.type === 'existing').map((image) => image.file),
          newImages: images
            .filter((image) => image.type === 'new')
            .map((image) => ({ id: image.id, url: image.url })),
          imageOrder: images.map((image) =>
            image.type === 'existing'
              ? { type: 'existing', file: image.file }
              : { type: 'new', id: image.id },
          ),
        })
      } else {
        saved = await createPostSet({ name, text, images: images.map((image) => image.url), sourceUrl, kind, propertyType, deal })
      }
      onSaved(saved)
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  async function importUrl(value = sourceUrl) {
    const url = String(value || '').trim()
    if (!url) return setError('กรุณาวางลิงก์ประกาศจากเว็บไซต์บริษัท')
    setImporting(true)
    setError(null)
    try {
      const preview = await importPostSetUrl(url)
      setSourceUrl(preview.sourceUrl)
      setName(preview.name || '')
      setText(preview.text || '')
      setImages((preview.images || []).map((url) => ({ id: `new-${crypto.randomUUID()}`, type: 'new', url })))
      if (!preview.images?.length) setError('ดึงข้อความสำเร็จ แต่ไม่พบรูปที่ดาวน์โหลดได้ กรุณาเพิ่มรูปด้วยตนเองก่อนบันทึก')
    } catch (e) {
      setError(e.message)
    } finally {
      setImporting(false)
    }
  }

  async function runSessionAction(action) {
    setSessionBusy(true)
    setError(null)
    try { setJsaSession(await action()) }
    catch (e) { setError(e.message) }
    finally { setSessionBusy(false) }
  }

  const totalImages = images.length

  function moveImage(draggedId, targetId) {
    if (draggedId === targetId) return
    setImages((current) => {
      const from = current.findIndex((image) => image.id === draggedId)
      const to = current.findIndex((image) => image.id === targetId)
      if (from < 0 || to < 0) return current
      const next = [...current]
      const [dragged] = next.splice(from, 1)
      next.splice(to, 0, dragged)
      return next
    })
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 p-4" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-2xl bg-white shadow-xl max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h2 className="text-base font-bold text-slate-800">
            {set?.id ? '✏️ แก้ไขทรัพย์' : '📝 เพิ่มทรัพย์'}
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">
            ✕
          </button>
        </div>

        <div className="px-5 py-4 space-y-3 overflow-auto">
          {!set?.id && <div className="rounded-xl border border-indigo-100 bg-indigo-50/60 p-3">
            <label className="text-xs font-bold text-indigo-800">นำเข้าจากลิงก์เว็บไซต์บริษัท</label>
            <div className="mt-2 flex gap-2">
              <input type="url" value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} onPaste={(e) => {
                const pasted = e.clipboardData.getData('text').trim()
                if (/^https?:\/\//i.test(pasted)) {
                  e.preventDefault()
                  setSourceUrl(pasted)
                  void importUrl(pasted)
                }
              }} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); importUrl() } }} placeholder="https://.../property/..." className="min-w-0 flex-1 rounded-xl border border-indigo-200 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-500" />
              <button type="button" onClick={importUrl} disabled={importing} className="rounded-xl bg-indigo-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">{importing ? 'กำลังดึง…' : 'ดึงข้อมูล'}</button>
            </div>
            <p className="mt-1.5 text-[11px] text-indigo-600">วางลิงก์แล้วระบบจะเริ่มดึงทันที จากนั้นให้ตรวจข้อความและรูปก่อนบันทึกเข้าระบบโพสต์อัตโนมัติ</p>
            <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-indigo-100 pt-2">
              <span className={`text-[11px] font-bold ${jsaSession.connected ? 'text-emerald-700' : jsaSession.loginOpen ? 'text-amber-700' : 'text-slate-500'}`}>{jsaSession.connected ? '● เชื่อมต่อ JSA แล้ว' : jsaSession.loginOpen ? '● รอยืนยันการล็อกอิน' : '○ ยังไม่ได้เชื่อมต่อ JSA'}</span>
              {!jsaSession.loginOpen && <button type="button" disabled={sessionBusy} onClick={() => runSessionAction(() => startJsaSession(sourceUrl || undefined))} className="rounded-lg border border-indigo-200 bg-white px-2 py-1 text-[11px] font-semibold text-indigo-700 disabled:opacity-50">{jsaSession.connected ? 'ล็อกอินใหม่' : 'เชื่อมต่อ JSA'}</button>}
              {jsaSession.loginOpen && <button type="button" disabled={sessionBusy} onClick={() => runSessionAction(finishJsaSession)} className="rounded-lg bg-emerald-600 px-2 py-1 text-[11px] font-semibold text-white disabled:opacity-50">ล็อกอินแล้ว · บันทึก Session</button>}
              {jsaSession.connected && <button type="button" disabled={sessionBusy} onClick={() => runSessionAction(disconnectJsaSession)} className="px-1 py-1 text-[11px] text-rose-600 disabled:opacity-50">ยกเลิกการเชื่อมต่อ</button>}
            </div>
          </div>}
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="ชื่อชุดโพสต์ (สำหรับอ้างอิง) เช่น โปรโมชั่นเดือนนี้"
            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400"
          />

          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs font-semibold text-slate-500">หมวดทรัพย์
              <select value={propertyType} onChange={(e) => setPropertyType(e.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"><option value="condo">คอนโด</option><option value="house">บ้าน</option></select>
            </label>
            <label className="text-xs font-semibold text-slate-500">ประเภทประกาศ
              <select value={deal} onChange={(e) => setDeal(e.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"><option value="rent">เช่า</option><option value="sale">ขาย</option></select>
            </label>
          </div>

          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={7}
            placeholder="เขียนข้อความโพสต์... (เหมือนโพสต์ใน Facebook)"
            className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-indigo-400 resize-y leading-relaxed"
          />

          {/* Drag thumbnails to control the order used when posting. */}
          {totalImages > 0 && (
            <>
              <p className="text-xs text-slate-500">ลากรูปเพื่อจัดลำดับ — รูปแรกจะถูกโพสต์ก่อน</p>
              <div className="grid grid-cols-4 gap-2">
              {images.map((image, index) => (
                <div
                  key={image.id}
                  draggable
                  onDragStart={(e) => e.dataTransfer.setData('text/plain', image.id)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault()
                    moveImage(e.dataTransfer.getData('text/plain'), image.id)
                  }}
                  className="relative group aspect-square cursor-grab active:cursor-grabbing"
                >
                  <img src={image.url} alt={`รูปที่ ${index + 1}`} className={`w-full h-full object-cover rounded-lg border ${image.type === 'new' ? 'border-emerald-300' : 'border-slate-200'}`} />
                  <span className="absolute left-1 top-1 h-5 min-w-5 rounded-full bg-slate-900/70 px-1 text-xs text-white grid place-items-center">{index + 1}</span>
                  <button
                    onClick={() => setImages((current) => current.filter((item) => item.id !== image.id))}
                    draggable={false}
                    className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-rose-600 text-white text-xs grid place-items-center shadow"
                  >
                    ✕
                  </button>
                </div>
              ))}
              </div>
            </>
          )}

          <label
            onDragOver={(e) => {
              e.preventDefault()
              setDraggingImages(true)
            }}
            onDragLeave={() => setDraggingImages(false)}
            onDrop={dropImages}
            className={`flex min-h-24 cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed px-4 py-3 text-center text-sm font-medium transition-colors ${
              draggingImages
                ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                : 'border-slate-200 text-slate-500 hover:border-indigo-300 hover:text-indigo-600'
            }`}
          >
            <span className="text-lg">🖼️</span>
            <span>ลากรูปมาวางที่นี่ หรือคลิกเพื่อเลือกรูป</span>
            <span className="text-xs font-normal text-slate-400">รองรับหลายรูปพร้อมกัน</span>
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
