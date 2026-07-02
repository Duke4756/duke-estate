function Stat({ label, value, accent }) {
  return (
    <div className="flex-1 min-w-[130px] rounded-2xl bg-white border border-slate-200 px-4 py-3">
      <div className={`text-2xl font-bold ${accent}`}>{value}</div>
      <div className="text-xs text-slate-500 mt-0.5">{label}</div>
    </div>
  )
}

export default function StatsBar({ total, renters, others }) {
  return (
    <div className="flex flex-wrap gap-3">
      <Stat label="โพสต์ทั้งหมด (1 ชม.)" value={total} accent="text-slate-800" />
      <Stat label="🎯 ผู้กำลังหาห้องเช่า" value={renters} accent="text-emerald-600" />
      <Stat label="เจ้าของ / ขาย / อื่นๆ" value={others} accent="text-slate-400" />
    </div>
  )
}
