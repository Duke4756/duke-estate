const MODES = [
  { id: 'search', label: '🔍 ค้นหาโพสต์' },
  { id: 'autopost', label: '🤖 โพสต์อัตโนมัติ' },
]

export default function Header({ source, onRefresh, onStop, loading, lastUpdated, appMode, onMode }) {
  const isSearch = appMode === 'search'
  return (
    <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
      <div className="max-w-6xl mx-auto px-5 py-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 grid place-items-center text-xl shadow-lg shadow-indigo-200">
            🏠
          </div>
          <div className="hidden md:block">
            <h1 className="text-lg font-bold text-slate-800 leading-tight">Condo Lead Finder</h1>
            <p className="text-xs text-slate-500">ค้นหาลูกค้า + โพสต์อัตโนมัติในที่เดียว</p>
          </div>
        </div>

        {/* Mode switch */}
        <div className="inline-flex rounded-2xl bg-slate-100 p-1">
          {MODES.map((m) => (
            <button
              key={m.id}
              onClick={() => onMode?.(m.id)}
              className={`rounded-xl px-3.5 py-2 text-sm font-semibold transition ${
                appMode === m.id ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-3">
          {isSearch && (
            <>
              <div className="hidden lg:flex flex-col items-end">
                <span className="text-[11px] uppercase tracking-wide text-slate-400">แหล่งข้อมูล</span>
                <span
                  className={`text-xs font-semibold ${
                    source === 'live' ? 'text-emerald-600' : source === 'history' ? 'text-amber-600' : 'text-slate-500'
                  }`}
                >
                  {source === 'live'
                    ? '● Live (Facebook)'
                    : source === 'history'
                      ? '● ประวัติ'
                      : '● Demo'}
                </span>
              </div>
              {loading ? (
                <button
                  onClick={onStop}
                  className="inline-flex items-center gap-2 rounded-xl bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-rose-700 active:scale-95"
                >
                  <span>⏹</span> หยุดดึง
                </button>
              ) : (
                <button
                  onClick={onRefresh}
                  className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 active:scale-95"
                >
                  <span>↻</span> ดึงโพสต์ล่าสุด
                </button>
              )}
            </>
          )}
        </div>
      </div>
      {isSearch && lastUpdated && (
        <div className="max-w-6xl mx-auto px-5 pb-2 -mt-1">
          <p className="text-[11px] text-slate-400">อัปเดตล่าสุด: {lastUpdated}</p>
        </div>
      )}
    </header>
  )
}
