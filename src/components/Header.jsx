const MODES = [
  { id: 'owners', label: '🏠 ฐานเจ้าของ' },
  { id: 'autopost', label: '🤖 โพสต์อัตโนมัติ' },
  { id: 'settings', label: '⚙️ Settings' },
]

const APP_ROLE = import.meta.env.VITE_APP_ROLE || 'all'
const visibleModes = APP_ROLE === 'autopost' || APP_ROLE === 'search'
    ? MODES.filter((mode) => mode.id === 'autopost')
    : MODES

export default function Header({ appMode, onMode }) {
  const [uiLagMs, setUiLagMs] = useState(0)
  useEffect(() => {
    let expected = performance.now() + 1000
    const timer = setInterval(() => {
      const now = performance.now()
      setUiLagMs(Math.max(0, Math.round(now - expected)))
      expected = now + 1000
    }, 1000)
    return () => clearInterval(timer)
  }, [])
  const lagTone = uiLagMs > 500 ? 'border-rose-300 bg-rose-50 text-rose-700' : uiLagMs > 150 ? 'border-amber-300 bg-amber-50 text-amber-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'
  return (
    <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
      <div className="max-w-7xl mx-auto px-5 py-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 grid place-items-center text-xl shadow-lg shadow-indigo-200">
            🏠
          </div>
          <div className="hidden md:block">
            <h1 className="text-lg font-bold text-slate-800 leading-tight">Duke Estate</h1>
            <p className="text-xs text-slate-500">ระบบจัดการอสังหาริมทรัพย์</p>
          </div>
        </div>

        {/* Mode switch */}
        <div className="inline-flex rounded-2xl bg-slate-100 p-1">
          {visibleModes.map((m) => (
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

        <div title="ความหน่วงของหน้าเว็บ: สีเขียวปกติ, เหลืองเริ่มช้า, แดงเครื่องทำงานหนัก" className={`shrink-0 rounded-lg border px-2 py-1 text-right text-[10px] font-bold tabular-nums ${lagTone}`}>
          <span className="block text-[9px] font-medium opacity-70">UI lag</span>{uiLagMs} ms
        </div>
      </div>
    </header>
  )
}
import { useEffect, useState } from 'react'
