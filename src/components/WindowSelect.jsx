const WINDOWS = [
  { mins: 60, label: '1 ชม.' },
  { mins: 180, label: '3 ชม.' },
  { mins: 360, label: '6 ชม.' },
  { mins: 720, label: '12 ชม.' },
]

export default function WindowSelect({ minutes, onChange, disabled }) {
  return (
    <div className="inline-flex items-center gap-2">
      <span className="text-xs text-slate-400">ช่วงเวลา:</span>
      <div className="inline-flex rounded-xl bg-slate-200/70 p-1">
        {WINDOWS.map((w) => (
          <button
            key={w.mins}
            onClick={() => onChange(w.mins)}
            disabled={disabled}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition disabled:opacity-50 ${
              minutes === w.mins
                ? 'bg-white text-slate-800 shadow-sm'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {w.label}
          </button>
        ))}
      </div>
    </div>
  )
}
