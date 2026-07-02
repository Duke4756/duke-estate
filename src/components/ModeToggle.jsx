const MODES = [
  { id: 'keyword', label: '⚡ Keyword', hint: 'เร็ว · ไม่เรียก AI' },
  { id: 'ai', label: '🤖 AI (Gemini)', hint: 'แม่นยำกว่า' },
]

export default function ModeToggle({ mode, onChange, disabled }) {
  return (
    <div className="inline-flex items-center gap-2">
      <span className="text-xs text-slate-400">โหมดคัดกรอง:</span>
      <div className="inline-flex rounded-xl bg-slate-200/70 p-1">
        {MODES.map((m) => (
          <button
            key={m.id}
            onClick={() => onChange(m.id)}
            disabled={disabled}
            title={m.hint}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition disabled:opacity-50 ${
              mode === m.id
                ? 'bg-white text-slate-800 shadow-sm'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>
    </div>
  )
}
