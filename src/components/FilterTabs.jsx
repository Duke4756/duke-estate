const TABS = [
  { id: 'renter', label: '🎯 ผู้หาห้องเช่า' },
  { id: 'all', label: 'ทั้งหมด' },
  { id: 'other', label: 'เจ้าของ / ขาย / อื่นๆ' },
]

export default function FilterTabs({ active, onChange, counts }) {
  return (
    <div className="inline-flex rounded-2xl bg-slate-200/70 p-1">
      {TABS.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={`rounded-xl px-4 py-2 text-sm font-medium transition ${
            active === t.id
              ? 'bg-white text-slate-800 shadow-sm'
              : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          {t.label}
          <span className="ml-1.5 text-xs text-slate-400">{counts[t.id] ?? 0}</span>
        </button>
      ))}
    </div>
  )
}
