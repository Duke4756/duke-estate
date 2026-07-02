export default function ProgressBar({ percent = 0, logs = [], mode, onStop }) {
  const pct = Math.max(0, Math.min(100, Math.round(percent)))
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-semibold text-slate-700">
          {mode === 'keyword' ? '⚡ กำลังดึง + คัดกรอง (Keyword)' : '🤖 กำลังดึง + คัดกรอง (AI)'}
        </span>
        <div className="flex items-center gap-3">
          <span className="text-sm font-bold text-indigo-600 tabular-nums">{pct}%</span>
          {onStop && (
            <button
              onClick={onStop}
              className="rounded-lg bg-rose-100 px-2.5 py-1 text-xs font-semibold text-rose-600 transition hover:bg-rose-200 active:scale-95"
            >
              ⏹ หยุด
            </button>
          )}
        </div>
      </div>

      {/* bar */}
      <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
        <div
          className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-500 transition-all duration-300 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>

      {/* live log */}
      <div className="mt-3 max-h-40 overflow-auto rounded-xl bg-slate-900/95 p-3 font-mono text-[11px] leading-relaxed text-slate-300">
        {logs.length === 0 ? (
          <div className="text-slate-500">รอเริ่มต้น...</div>
        ) : (
          logs.map((line, i) => (
            <div
              key={i}
              className={i === logs.length - 1 ? 'text-emerald-300' : 'text-slate-400'}
            >
              <span className="text-slate-600">{String(i + 1).padStart(2, '0')} </span>
              {line}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
