export default function EmptyState({ icon = '🔍', title, subtitle }) {
  return (
    <div className="rounded-2xl border-2 border-dashed border-slate-200 bg-white/50 py-16 text-center">
      <div className="text-4xl">{icon}</div>
      <p className="mt-3 font-semibold text-slate-700">{title}</p>
      {subtitle && <p className="mt-1 text-sm text-slate-400">{subtitle}</p>}
    </div>
  )
}
