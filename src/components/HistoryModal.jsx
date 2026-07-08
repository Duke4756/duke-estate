import { useEffect, useState } from 'react'
import { getHistory, deleteHistoryRound, historyExcelUrl } from '../api'

function fmtTime(iso) {
  try {
    return new Date(iso).toLocaleString('th-TH', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}
const windowLabel = (m) => (m >= 60 ? `${m / 60} ชม.` : `${m} นาที`)

export default function HistoryModal({ open, onClose, onOpenRound }) {
  const [rounds, setRounds] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  function refresh() {
    setLoading(true)
    setError(null)
    getHistory()
      .then((d) => setRounds(d.rounds || []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    if (open) refresh()
  }, [open])

  if (!open) return null

  async function handleDelete(e, id) {
    e.stopPropagation()
    setRounds((r) => r.filter((x) => x.id !== id)) // optimistic
    try {
      await deleteHistoryRound(id)
    } catch (err) {
      setError(err.message)
      refresh()
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl rounded-2xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h2 className="text-base font-bold text-slate-800">🕘 ประวัติการค้นหา</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">
            ✕
          </button>
        </div>

        <div className="px-5 py-4">
          <p className="text-xs text-slate-400 mb-3">
            แต่ละรอบถูกเก็บเป็นไฟล์ Excel บนเครื่อง — คลิกเพื่อย้อนดูผล, ⬇ เพื่อโหลด .xlsx, 🗑 เพื่อลบ
          </p>

          {loading ? (
            <p className="text-sm text-slate-400 py-6 text-center">กำลังโหลด...</p>
          ) : error ? (
            <p className="text-sm text-rose-600 py-4">⚠️ {error}</p>
          ) : rounds.length === 0 ? (
            <div className="rounded-xl border-2 border-dashed border-slate-200 py-10 text-center text-sm text-slate-400">
              ยังไม่มีประวัติ — ทำการค้นหาสักครั้งแล้วจะถูกบันทึกอัตโนมัติ
            </div>
          ) : (
            <ul className="space-y-2 max-h-[26rem] overflow-auto">
              {rounds.map((r) => (
                <li
                  key={r.id}
                  onClick={() => onOpenRound(r.id)}
                  className="group flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 cursor-pointer hover:border-indigo-300 hover:bg-indigo-50/40 transition"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-700">
                      {fmtTime(r.savedAt)}
                      <span className="ml-2 text-[11px] font-medium text-slate-400">
                        {r.mode === 'ai' ? '🤖 AI' : '⚡ Keyword'} · {windowLabel(r.minutes)}
                      </span>
                    </p>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      🎯 {r.renters} ผู้เช่า · {r.total} โพสต์
                      {r.groups?.length ? ` · ${r.groups.length} กลุ่ม` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <a
                      href={historyExcelUrl(r.id)}
                      onClick={(e) => e.stopPropagation()}
                      title="ดาวน์โหลด Excel"
                      className="rounded-lg px-2 py-1 text-xs font-semibold text-emerald-600 hover:bg-emerald-50"
                    >
                      ⬇ Excel
                    </a>
                    <button
                      onClick={(e) => handleDelete(e, r.id)}
                      title="ลบประวัติ"
                      className="rounded-lg px-2 py-1 text-xs font-semibold text-rose-600 hover:bg-rose-50"
                    >
                      🗑
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
