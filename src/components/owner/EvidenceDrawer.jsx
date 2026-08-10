export default function EvidenceDrawer({ property, onClose }) {
  if (!property) return null
  return <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/40" onClick={onClose}>
    <aside className="h-full w-full max-w-xl overflow-auto bg-white p-5 shadow-2xl" onClick={(event) => event.stopPropagation()}>
      <div className="flex items-center justify-between"><h3 className="font-bold text-slate-800">หลักฐานและข้อความต้นฉบับ</h3><button onClick={onClose} className="text-xl text-slate-400">×</button></div>
      <div className="mt-4 rounded-xl bg-slate-50 p-3 text-sm leading-relaxed text-slate-700 whitespace-pre-wrap">{property.raw_text}</div>
      <h4 className="mt-5 text-sm font-bold text-slate-700">หลักฐานรายช่อง</h4>
      <div className="mt-2 space-y-2">
        {(property.evidence || []).map((item, index) => <div key={`${item.field}-${index}`} className="rounded-xl border border-slate-200 p-3">
          <div><span className="text-xs font-bold text-indigo-700">{item.field}</span></div>
          <p className="mt-1 text-sm text-slate-700">“{item.quote}”</p>
        </div>)}
        {!property.evidence?.length && <p className="text-sm text-slate-400">ไม่มีหลักฐานที่ผ่านการตรวจสอบ</p>}
      </div>
      {!!property.warnings?.length && <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">⚠️ {property.warnings.join(', ')}</div>}
    </aside>
  </div>
}
