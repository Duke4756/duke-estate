import { useEffect, useState } from 'react'
import {
  getPostSets,
  deletePostSet,
  getSchedules,
  deleteSchedule,
  streamScheduleRun,
  getHealth,
} from '../api'
import PostSetEditor from './PostSetEditor'
import ScheduleEditor from './ScheduleEditor'
import Countdown from './Countdown'

const labelOf = (u) => (u.match(/groups\/([^/?]+)/) || [])[1] || u

function PostSetCard({ set, onEdit, onDelete }) {
  const preview = set.images?.[0]?.url
  return (
    <article className="rounded-2xl border border-slate-200 bg-white overflow-hidden flex flex-col">
      {preview ? (
        <div className="relative h-32 bg-slate-100">
          <img src={preview} alt="" className="w-full h-full object-cover" />
          {set.images.length > 1 && (
            <span className="absolute bottom-1.5 right-1.5 rounded-md bg-black/60 px-1.5 py-0.5 text-[11px] font-semibold text-white">
              +{set.images.length - 1} รูป
            </span>
          )}
        </div>
      ) : (
        <div className="h-20 bg-gradient-to-br from-slate-50 to-slate-100 grid place-items-center text-2xl">📝</div>
      )}
      <div className="p-3 flex-1 flex flex-col">
        <p className="text-sm font-bold text-slate-800 truncate">{set.name}</p>
        <p className="mt-1 text-xs text-slate-500 line-clamp-3 whitespace-pre-line flex-1">
          {set.text || <span className="italic text-slate-300">ไม่มีข้อความ</span>}
        </p>
        <div className="mt-3 flex items-center justify-end gap-1">
          <button
            onClick={() => onEdit(set)}
            className="rounded-lg px-2.5 py-1 text-xs font-semibold text-indigo-600 hover:bg-indigo-50"
          >
            ✏️ แก้ไข
          </button>
          <button
            onClick={() => onDelete(set)}
            className="rounded-lg px-2.5 py-1 text-xs font-semibold text-rose-600 hover:bg-rose-50"
          >
            🗑 ลบ
          </button>
        </div>
      </div>
    </article>
  )
}

function PostSetsPanel() {
  const [sets, setSets] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [editor, setEditor] = useState({ open: false, set: null })

  function refresh() {
    setLoading(true)
    setError(null)
    getPostSets()
      .then((d) => setSets(d.postsets || []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }
  useEffect(refresh, [])

  async function handleDelete(set) {
    if (!confirm(`ลบชุดโพสต์ "${set.name}"?`)) return
    setSets((s) => s.filter((x) => x.id !== set.id)) // optimistic
    try {
      await deletePostSet(set.id)
    } catch (e) {
      setError(e.message)
      refresh()
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-slate-500">
          สร้าง “ชุดของโพสต์” (ข้อความ + รูป) ไว้ใช้โพสต์อัตโนมัติ — เก็บบนเครื่องนี้เท่านั้น
        </p>
        <button
          onClick={() => setEditor({ open: true, set: null })}
          className="shrink-0 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
        >
          ＋ สร้างชุดโพสต์
        </button>
      </div>

      {error && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">⚠️ {error}</div>
      )}

      {loading ? (
        <p className="text-sm text-slate-400 py-10 text-center">กำลังโหลด...</p>
      ) : sets.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-slate-200 py-14 text-center">
          <div className="text-4xl">📝</div>
          <p className="mt-3 font-semibold text-slate-600">ยังไม่มีชุดโพสต์</p>
          <p className="mt-1 text-sm text-slate-400">กด “＋ สร้างชุดโพสต์” เพื่อเริ่มต้น</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {sets.map((set) => (
            <PostSetCard
              key={set.id}
              set={set}
              onEdit={(s) => setEditor({ open: true, set: s })}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}

      <PostSetEditor
        open={editor.open}
        set={editor.set}
        onClose={() => setEditor({ open: false, set: null })}
        onSaved={() => {
          setEditor({ open: false, set: null })
          refresh()
        }}
      />
    </div>
  )
}

// Status badge — reflects the REAL outcome using per-group results, not just
// the raw status. A "done" schedule with some failed groups shows "สำเร็จบางส่วน".
const BADGE_CLS = {
  rose: 'bg-rose-50 text-rose-600 border-rose-200',
  emerald: 'bg-emerald-50 text-emerald-600 border-emerald-200',
  amber: 'bg-amber-50 text-amber-600 border-amber-200',
  indigo: 'bg-indigo-50 text-indigo-600 border-indigo-200',
  slate: 'bg-slate-100 text-slate-500 border-slate-200',
}
function badgeFor(sch) {
  const results = sch.results || []
  if (sch.status === 'posting') return { label: 'กำลังโพสต์', cls: BADGE_CLS.amber }
  if (sch.status === 'canceled') return { label: 'ยกเลิก', cls: BADGE_CLS.slate }
  if (sch.status === 'pending') return { label: 'รอโพสต์', cls: BADGE_CLS.indigo }
  if (results.length) {
    const failN = results.filter((r) => !r.ok).length
    if (failN === 0) return { label: 'โพสต์สำเร็จ', cls: BADGE_CLS.emerald }
    if (failN === results.length) return { label: 'โพสต์ไม่สำเร็จ', cls: BADGE_CLS.rose }
    return { label: 'สำเร็จบางส่วน', cls: BADGE_CLS.amber }
  }
  return sch.status === 'failed'
    ? { label: 'โพสต์ไม่สำเร็จ', cls: BADGE_CLS.rose }
    : { label: 'โพสต์สำเร็จ', cls: BADGE_CLS.emerald }
}

// One schedule row. Owns its own "details open" state so the (i) button can
// reveal the per-group result + full error message independently per row.
function ScheduleRow({ sch, set, canPost, running, onRun, onRepost, onEdit, onDelete }) {
  const [showDetails, setShowDetails] = useState(false)
  const results = sch.results || []
  const okCount = results.filter((r) => r.ok).length
  const hasResults = results.length > 0
  const hasFailures = results.some((r) => !r.ok)
  const isThisRunning = running?.id === sch.id
  const badge = badgeFor(sch)

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex items-center gap-4">
        {set?.images?.[0]?.url ? (
          <img src={set.images[0].url} alt="" className="h-14 w-14 rounded-xl object-cover border border-slate-200 shrink-0" />
        ) : (
          <div className="h-14 w-14 rounded-xl bg-slate-100 grid place-items-center text-xl shrink-0">📝</div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="text-sm font-bold text-slate-800 truncate">{sch.name}</p>
            <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${badge.cls}`}>
              {badge.label}
            </span>
            {/* (i) — reveal per-group results + error detail */}
            {hasResults && (
              <button
                onClick={() => setShowDetails((s) => !s)}
                title="ดูรายละเอียดผลการโพสต์"
                className={`grid h-4 w-4 shrink-0 place-items-center rounded-full border text-[9px] font-bold leading-none ${
                  hasFailures
                    ? 'border-rose-300 bg-rose-50 text-rose-600 hover:bg-rose-100'
                    : 'border-slate-200 bg-slate-50 text-slate-500 hover:bg-slate-100'
                }`}
              >
                i
              </button>
            )}
          </div>
          <p className="text-xs text-slate-500 truncate">
            {set ? `📝 ${set.name}` : '⚠️ ชุดโพสต์ถูกลบ'} · 📁 {sch.groups.length} กลุ่ม
          </p>
          <p className="mt-1 text-sm text-indigo-600">
            {isThisRunning ? (
              <span className="font-semibold text-indigo-700">{running.message}</span>
            ) : sch.status === 'posting' ? (
              <span className="font-semibold text-amber-600">⏳ กำลังโพสต์อยู่...</span>
            ) : hasResults ? (
              <span className={`font-semibold ${hasFailures ? 'text-rose-600' : 'text-emerald-600'}`}>
                {hasFailures ? '❌ ' : '✅ '}สำเร็จ {okCount}/{results.length} กลุ่ม
              </span>
            ) : sch.status === 'pending' ? (
              <>
                ⏳ อีก <Countdown runAt={sch.runAt} className="text-slate-800 font-semibold" />
              </>
            ) : null}
          </p>
        </div>
        <div className="flex flex-col items-stretch gap-1 shrink-0">
          <button
            onClick={() => onRun(sch)}
            disabled={sch.status === 'posting' || !canPost || !!running}
            className="rounded-lg bg-indigo-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            📤 โพสต์เลย
          </button>
          <button
            onClick={onRepost}
            className="rounded-lg border border-indigo-200 px-2.5 py-1 text-xs font-semibold text-indigo-600 hover:bg-indigo-50"
          >
            🔁 โพสต์ซ้ำ
          </button>
          <div className="flex gap-1">
            <button
              onClick={onEdit}
              className="flex-1 rounded-lg px-2.5 py-1 text-xs font-semibold text-indigo-600 hover:bg-indigo-50"
            >
              ✏️ แก้ไข
            </button>
            <button
              onClick={onDelete}
              className="flex-1 rounded-lg px-2.5 py-1 text-xs font-semibold text-rose-600 hover:bg-rose-50"
            >
              🗑 ลบ
            </button>
          </div>
        </div>
      </div>

      {/* Per-group detail panel — toggled by the (i) button */}
      {showDetails && hasResults && (
        <div className="mt-3 space-y-1.5 border-t border-slate-100 pt-3">
          {sch.finishedAt && (
            <p className="text-[11px] text-slate-400">
              โพสต์เมื่อ{' '}
              {new Date(sch.finishedAt).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' })}
            </p>
          )}
          {results.map((r, i) => (
            <div key={i} className="rounded-lg bg-slate-50 px-2.5 py-1.5">
              <div className="flex items-center gap-2">
                <span className={`text-xs font-bold ${r.ok ? 'text-emerald-600' : 'text-rose-600'}`}>
                  {r.ok ? '✓ สำเร็จ' : '✗ ไม่สำเร็จ'}
                </span>
                <span className="truncate text-xs text-slate-600">📁 {labelOf(r.group)}</span>
              </div>
              {!r.ok && r.error && (
                <p className="mt-1 whitespace-pre-line text-[11px] leading-relaxed text-rose-600">↳ {r.error}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function SchedulePanel() {
  const [schedules, setSchedules] = useState([])
  const [sets, setSets] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [editor, setEditor] = useState({ open: false, schedule: null })
  const [canPost, setCanPost] = useState(false)
  const [running, setRunning] = useState(null) // { id, message } live progress of a manual run
  const [showWarning, setShowWarning] = useState(true)

  function load(silent = false) {
    if (!silent) setLoading(true)
    setError(null)
    Promise.all([getSchedules(), getPostSets()])
      .then(([s, p]) => {
        setSchedules(s.schedules || [])
        setSets(p.postsets || [])
      })
      .catch((e) => setError(e.message))
      .finally(() => {
        if (!silent) setLoading(false)
      })
  }
  useEffect(() => load(), [])

  // Check whether the backend has an FB session ready to post.
  useEffect(() => {
    getHealth()
      .then((h) => setCanPost(Boolean(h.canPost)))
      .catch(() => {})
  }, [])

  // While any schedule is pending or posting, poll every 5s so the UI reflects
  // the auto-fired run (and a manual run's per-group results) live.
  const hasActive = schedules.some((s) => s.status === 'pending' || s.status === 'posting')
  useEffect(() => {
    if (!hasActive) return
    const t = setInterval(() => load(true), 5000)
    return () => clearInterval(t)
  }, [hasActive])

  const setById = (id) => sets.find((s) => s.id === id)

  async function handleDelete(sch) {
    if (!confirm('ลบการตั้งเวลานี้?')) return
    setSchedules((x) => x.filter((s) => s.id !== sch.id))
    try {
      await deleteSchedule(sch.id)
    } catch (e) {
      setError(e.message)
      load()
    }
  }

  // Manual "โพสต์เลย": open the SSE stream and show live progress inline.
  function runNow(sch) {
    if (!canPost) {
      setError('ยังไม่พร้อมโพสต์ — รัน "npm run login" บนเซิร์ฟเวอร์ก่อน')
      return
    }
    if (running) return
    setError(null)
    setRunning({ id: sch.id, message: '⏳ เริ่มโพสต์...' })
    streamScheduleRun(sch.id, {
      onProgress: ({ message }) => setRunning({ id: sch.id, message }),
      onDone: () => {
        setRunning(null)
        load(true)
      },
      onError: (msg) => {
        setRunning(null)
        setError(msg)
        load(true)
      },
    })
  }

  // Repost: reuse this schedule's config (post set + groups) in a NEW schedule.
  // The original is kept; the editor opens prefilled with a fresh default time.
  function repost(sch) {
    setEditor({
      open: true,
      schedule: { name: sch.name, postSetId: sch.postSetId, groups: [...(sch.groups || [])] },
    })
  }

  return (
    <div className="space-y-4">
      {showWarning && (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          <span className="flex-1 leading-relaxed">
            ⚠️ <b>โพสต์อัตโนมัติเข้า Facebook</b> — ใช้บัญชีสำรองเท่านั้น เพราะอาจทำให้บัญชีโดนจำกัด/แบนได้
            {!canPost && (
              <span className="mt-1 block">· ยังไม่พร้อมโพสต์: รัน "npm run login" บนเซิร์ฟเวอร์ก่อน</span>
            )}
          </span>
          <button onClick={() => setShowWarning(false)} className="shrink-0 text-amber-500 hover:text-amber-700">
            ✕
          </button>
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-slate-500">
          ตั้งเวลาให้โพสต์ “ชุดของโพสต์” ไปยังกลุ่มเป้าหมาย — ถึงเวลาแล้วโพสต์เองอัตโนมัติ หรือกด “โพสต์เลย” เพื่อทำทันที
        </p>
        <button
          onClick={() => setEditor({ open: true, schedule: null })}
          className="shrink-0 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
        >
          ＋ ตั้งเวลาโพสต์
        </button>
      </div>

      {error && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">⚠️ {error}</div>
      )}

      {loading ? (
        <p className="text-sm text-slate-400 py-10 text-center">กำลังโหลด...</p>
      ) : schedules.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-slate-200 py-14 text-center">
          <div className="text-4xl">⏰</div>
          <p className="mt-3 font-semibold text-slate-600">ยังไม่มีการตั้งเวลา</p>
          <p className="mt-1 text-sm text-slate-400">กด “＋ ตั้งเวลาโพสต์” เพื่อเริ่มต้น</p>
        </div>
      ) : (
        <div className="space-y-3">
          {schedules.map((sch) => (
            <ScheduleRow
              key={sch.id}
              sch={sch}
              set={setById(sch.postSetId)}
              canPost={canPost}
              running={running}
              onRun={runNow}
              onRepost={() => repost(sch)}
              onEdit={() => setEditor({ open: true, schedule: sch })}
              onDelete={() => handleDelete(sch)}
            />
          ))}
        </div>
      )}

      <ScheduleEditor
        open={editor.open}
        schedule={editor.schedule}
        postSets={sets}
        onClose={() => setEditor({ open: false, schedule: null })}
        onSaved={() => {
          setEditor({ open: false, schedule: null })
          load()
        }}
      />
    </div>
  )
}

const TABS = [
  { id: 'sets', label: '📝 ชุดของโพสต์' },
  { id: 'schedule', label: '⏰ ตั้งเวลาโพสต์' },
]

export default function AutoPostView() {
  const [tab, setTab] = useState('sets')
  return (
    <main className="max-w-6xl mx-auto px-5 py-6 space-y-5">
      <div className="inline-flex rounded-2xl bg-slate-200/70 p-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`rounded-xl px-4 py-2 text-sm font-medium transition ${
              tab === t.id ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'sets' ? <PostSetsPanel /> : <SchedulePanel />}
    </main>
  )
}
