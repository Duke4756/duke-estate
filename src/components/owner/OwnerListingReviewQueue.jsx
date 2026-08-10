// @ts-nocheck -- review drafts are runtime-validated server payloads.
import { useEffect, useState } from 'react'
import { getOwnerListingReviews, ownerListingReviewAction, updateOwnerListingReview } from '../../api'

const LABELS = { property_type: 'ประเภททรัพย์', project_name_raw: 'โครงการ', bedroom_count: 'ห้องนอน', bathroom_count: 'ห้องน้ำ', room_variant: 'รูปแบบห้อง', layout_type: 'Layout', area_sqm: 'พื้นที่', rent_price_monthly: 'ราคาเช่า', sale_price: 'ราคาขาย', nearby_transit: 'สถานี', pet_status: 'สัตว์เลี้ยง', contact_name: 'ผู้ติดต่อ', contact_phone: 'โทรศัพท์' }

export default function OwnerListingReviewQueue({ refreshToken = 0 }) {
  const [drafts, setDrafts] = useState([])
  const [error, setError] = useState(null)
  const load = () => getOwnerListingReviews().then((data) => setDrafts(data.drafts || [])).catch((e) => setError(e.message))
  useEffect(() => { void load() }, [refreshToken])
  async function changeValue(draft, name, rawValue) {
    const reviewed = structuredClone(draft.reviewed)
    const field = reviewed.listing[name]
    const numeric = ['bedroom_count', 'bathroom_count', 'area_sqm', 'rent_price_monthly', 'sale_price'].includes(name)
    field.value = rawValue === '' ? null : numeric ? Number(rawValue) : rawValue
    if (field.value !== draft.extraction.listing?.[name]?.value) field.conflict = 'user_corrected'
    try { const saved = await updateOwnerListingReview(draft.id, reviewed); setDrafts((items) => items.map((item) => item.id === draft.id ? saved : item)) }
    catch (e) { setError(e.message) }
  }
  async function action(draft, name) {
    setError(null)
    try { await ownerListingReviewAction(draft.id, name); await load() }
    catch (e) { setError(e.code === 'POSSIBLE_DUPLICATE' ? `พบรายการที่อาจซ้ำ (#${e.details?.propertyId}) กรุณาตรวจสอบก่อน` : e.message) }
  }
  const pending = drafts.filter((draft) => draft.status === 'pending_review')
  if (!pending.length && !error) return null
  return <section className="rounded-2xl border border-indigo-200 bg-indigo-50/60 p-4"><div className="flex items-center justify-between"><div><h2 className="font-bold text-indigo-950">🧾 Owner Listing Review Queue</h2><p className="mt-1 text-xs text-indigo-700">ตรวจหลักฐานและแก้ข้อมูลก่อนบันทึก — ระบบจะไม่บันทึกอัตโนมัติ</p></div><span className="rounded-full bg-indigo-600 px-3 py-1 text-xs font-bold text-white">{pending.length} รอตรวจ</span></div>{error && <p className="mt-3 rounded-xl bg-rose-50 p-3 text-sm text-rose-700">⚠️ {error}</p>}<div className="mt-3 space-y-3">{pending.map((draft) => <ReviewCard key={draft.id} draft={draft} onChange={changeValue} onAction={action} />)}</div></section>
}

function ReviewCard({ draft, onChange, onAction }) {
  const listing = draft.reviewed.listing
  return <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-sm font-bold text-slate-800">{draft.reviewed.post_type.value}</p><p className="text-[11px] text-slate-500">📁 {draft.source.group || 'ไม่ระบุกลุ่ม'} · {draft.source.postedAt ? new Date(draft.source.postedAt).toLocaleString('th-TH') : 'ไม่ระบุวันที่โพสต์'}</p></div>{draft.source.url && <a href={draft.source.url} target="_blank" rel="noreferrer" className="text-xs font-bold text-indigo-600">เปิดต้นฉบับ ↗</a>}</div><details className="mt-3 rounded-xl bg-slate-50 p-3"><summary className="cursor-pointer text-xs font-bold text-slate-600">ดู Source Text</summary><p className="mt-2 whitespace-pre-line text-xs text-slate-600">{draft.source.text}</p></details>{draft.source.images?.length > 0 && <div className="mt-3 flex gap-2 overflow-auto">{draft.source.images.map((url) => <img key={url} src={url} alt="" className="h-20 w-20 rounded-lg object-cover" />)}</div>}{listing ? <div className="mt-3 grid gap-2 md:grid-cols-2">{Object.entries(listing).map(([name, field]) => <FieldEditor key={name} name={name} field={field} onChange={(value) => onChange(draft, name, value)} />)}</div> : <p className="mt-3 rounded-xl bg-amber-50 p-3 text-xs text-amber-700">ผลนี้ไม่มี single listing กรุณาเลือก action ที่เหมาะสม</p>}<div className="mt-4 flex flex-wrap justify-end gap-2"><Action onClick={() => onAction(draft, 'mark_not_owner')}>ไม่ใช่ Owner</Action><Action onClick={() => onAction(draft, 'mark_multiple_listings')}>หลายทรัพย์</Action><Action onClick={() => onAction(draft, 'mark_duplicate')}>ซ้ำ</Action><Action onClick={() => onAction(draft, 'skip')}>ข้าม</Action>{listing && <button onClick={() => onAction(draft, 'confirm_and_save')} className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white">✓ ยืนยันและบันทึก</button>}</div></article>
}
function FieldEditor({ name, field, onChange }) { const warning = field.conflict || field.confidence < 0.7; return <label className={`rounded-xl border p-2.5 ${warning ? 'border-amber-300 bg-amber-50' : 'border-slate-200'}`}><span className="flex justify-between text-[11px] font-bold text-slate-600"><span>{LABELS[name] || name}</span><span className={warning ? 'text-amber-700' : 'text-emerald-600'}>{Math.round(field.confidence * 100)}%</span></span><input value={field.value ?? ''} onChange={(e) => onChange(e.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm" /><p className="mt-1 text-[10px] text-slate-500">{field.evidence.length ? `หลักฐาน: “${field.evidence.join('” · “')}”` : 'ไม่มีหลักฐานในโพสต์'}{field.conflict ? ` · ⚠️ ${field.conflict}` : ''}</p></label> }
function Action({ children, onClick }) { return <button onClick={onClick} className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-600">{children}</button> }
