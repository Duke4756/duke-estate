import { useEffect, useMemo, useState } from 'react'
import {
  getPostSets,
  deletePostSet,
  deletePostSets,
  getSchedules,
  deleteSchedule,
  streamScheduleRun,
  getHealth,
  getAccounts,
  getPostingSettings,
  updatePostingSettings,
  createPostSetFromUrl,
  disconnectJsaSession,
  finishJsaSession,
  getJsaSession,
  startJsaSession,
  reorderPostSets,
} from '../api'
import PostSetEditor from './PostSetEditor'
import ScheduleEditor from './ScheduleEditor'
import AccountsPanel from './AccountsPanel'
import AutoCampaignPanel from './AutoCampaignPanel'
import { filterAndSortSchedules, paginateSchedules } from './scheduleQueue'

const labelOf = (u) => (u.match(/groups\/([^/?]+)/) || [])[1] || u
const scheduledAt = (runAt) =>
  new Date(runAt).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' })

function PostSetCard({ set, selected, onSelect, onEdit, onDelete, onDragStart, onDrop }) {
  const preview = set.images?.[0]?.url
  return (
    <article draggable onDragStart={onDragStart} onDragOver={(event) => event.preventDefault()} onDrop={onDrop} className={`relative cursor-grab overflow-hidden rounded-2xl border bg-white flex flex-col active:cursor-grabbing ${selected ? 'border-indigo-500 ring-2 ring-indigo-100' : 'border-slate-200'}`}>
      <label draggable={false} onClick={(event) => event.stopPropagation()} className="absolute left-2 top-2 z-10 grid h-7 w-7 cursor-pointer place-items-center rounded-lg bg-white/95 shadow">
        <input type="checkbox" checked={selected} onChange={onSelect} className="h-4 w-4 accent-indigo-600" />
      </label>
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
  const [quickUrl, setQuickUrl] = useState('')
  const [quickImporting, setQuickImporting] = useState(false)
  const [importQueue, setImportQueue] = useState([])
  const [importedName, setImportedName] = useState('')
  const [jsaSession, setJsaSession] = useState({ connected: false, loginOpen: false })
  const [sessionBusy, setSessionBusy] = useState(false)
  const [selectedSetIds, setSelectedSetIds] = useState([])
  const [draggedSetId, setDraggedSetId] = useState(null)
  const [importProgress, setImportProgress] = useState('')

  function refresh() {
    setLoading(true)
    setError(null)
    getPostSets()
      .then((d) => setSets(d.postsets || []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }
  useEffect(() => {
    refresh()
    getJsaSession().then(setJsaSession).catch(() => {})
  }, [])

  function queueImport(value = quickUrl) {
    const urls = [...new Set(String(value || '').match(/https?:\/\/[^\s,]+/gi) || [])]
    if (!urls.length) return
    setImportQueue((current) => {
      const queued = new Set(current)
      return [...current, ...urls.filter((url) => !queued.has(url))]
    })
    setQuickUrl('')
    setImportedName(`รับลิงก์เข้าคิวแล้ว ${urls.length} รายการ`)
  }

  async function importQueuedUrl(url) {
    setQuickImporting(true)
    setError(null)
    setImportProgress('กำลังดึงข้อมูลและรูป…')
    try {
      const postset = await createPostSetFromUrl(url)
      setImportedName(postset.duplicateImport ? 'ข้ามลิงก์เดิมที่เคยนำเข้าแล้ว' : `สร้าง “${postset.name}” แล้ว`)
      if (!postset.duplicateImport) refresh()
    } catch (e) {
      setError(`นำเข้าไม่สำเร็จ\n${url}: ${e.message}`)
    } finally {
      setImportProgress('')
      setQuickImporting(false)
    }
  }

  useEffect(() => {
    if (quickImporting || !importQueue.length) return
    const [nextUrl, ...remaining] = importQueue
    setImportQueue(remaining)
    void importQueuedUrl(nextUrl)
  }, [importQueue, quickImporting])

  async function sessionAction(action) {
    setSessionBusy(true)
    setError(null)
    try { setJsaSession(await action()) }
    catch (e) { setError(e.message) }
    finally { setSessionBusy(false) }
  }

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

  async function handleBulkDelete() {
    if (!selectedSetIds.length || !confirm(`ลบชุดโพสต์ที่เลือก ${selectedSetIds.length} รายการ พร้อมรูปทั้งหมดหรือไม่?`)) return
    const previous = sets
    setSets((current) => current.filter((set) => !selectedSetIds.includes(set.id)))
    try {
      await deletePostSets(selectedSetIds)
      setSelectedSetIds([])
    } catch (e) {
      setSets(previous)
      setError(e.message)
    }
  }

  async function dropSet(targetId) {
    if (!draggedSetId || draggedSetId === targetId) return setDraggedSetId(null)
    const from = sets.findIndex((set) => set.id === draggedSetId)
    const to = sets.findIndex((set) => set.id === targetId)
    if (from < 0 || to < 0) return setDraggedSetId(null)
    const previous = sets
    const next = [...sets]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    setSets(next)
    setDraggedSetId(null)
    try { await reorderPostSets(next.map((set) => set.id)) }
    catch (e) { setSets(previous); setError(e.message) }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-indigo-200 bg-gradient-to-r from-indigo-50 to-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div><h3 className="text-sm font-bold text-indigo-900">วางลิงก์ JSA แล้วสร้างโพสต์ทันที</h3><p className="mt-0.5 text-xs text-indigo-600">ระบบดึงรายละเอียดและรูปทั้งหมด สร้างชุดโพสต์ และนำเข้าสู่ระบบอัตโนมัติในครั้งเดียว</p></div>
          <div className="flex items-center gap-2">
            <span className={`text-[11px] font-bold ${jsaSession.connected ? 'text-emerald-700' : jsaSession.loginOpen ? 'text-amber-700' : 'text-slate-500'}`}>{jsaSession.connected ? '● JSA พร้อมใช้' : jsaSession.loginOpen ? '● รอยืนยันล็อกอิน' : '○ ยังไม่เชื่อม JSA'}</span>
            {!jsaSession.loginOpen && <button type="button" disabled={sessionBusy} onClick={() => sessionAction(() => startJsaSession(quickUrl || undefined))} className="rounded-lg border border-indigo-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-indigo-700 disabled:opacity-50">{jsaSession.connected ? 'ล็อกอินใหม่' : 'เชื่อมต่อ JSA'}</button>}
            {jsaSession.loginOpen && <button type="button" disabled={sessionBusy} onClick={() => sessionAction(finishJsaSession)} className="rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-semibold text-white disabled:opacity-50">ล็อกอินแล้ว · บันทึก</button>}
            {jsaSession.connected && <button type="button" disabled={sessionBusy} onClick={() => sessionAction(disconnectJsaSession)} className="text-[11px] text-rose-600">ยกเลิก</button>}
          </div>
        </div>
        <div className="mt-3 flex gap-2">
          <textarea rows={2} value={quickUrl} onChange={(event) => setQuickUrl(event.target.value)} onPaste={(event) => {
            const pasted = event.clipboardData.getData('text').trim()
            if (/https?:\/\//i.test(pasted)) { event.preventDefault(); queueImport(pasted) }
          }} placeholder="วางลิงก์ได้ต่อเนื่อง แม้ระบบกำลังนำเข้าหรือกำลังโพสต์" className="min-w-0 flex-1 resize-y rounded-xl border border-indigo-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-indigo-500" />
          <button type="button" onClick={() => queueImport()} disabled={!quickUrl.trim()} className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50">{quickImporting ? 'เพิ่มเข้าคิว' : 'สร้างโพสต์ทันที'}</button>
        </div>
        {(quickImporting || importQueue.length > 0) && <p className="mt-2 text-xs font-semibold text-indigo-700">⏳ {quickImporting ? importProgress || 'กำลังนำเข้า…' : 'รอเริ่มนำเข้า'}{importQueue.length ? ` · รออีก ${importQueue.length} ลิงก์` : ''} · วางลิงก์ต่อได้ทันที</p>}
        {importedName && <p className="mt-2 text-xs font-semibold text-emerald-700">✓ {importedName}{sets.length ? ' · พร้อมให้ระบบโพสต์อัตโนมัติ' : ''}</p>}
      </div>
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

      {sets.length > 0 && <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
        <span className="text-xs text-slate-500">ลากการ์ดเพื่อจัดลำดับห้อง · เลือกหลายรายการเพื่อลบข้อมูลเก่า</span>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setSelectedSetIds(selectedSetIds.length === sets.length ? [] : sets.map((set) => set.id))} className="text-xs font-semibold text-indigo-600">{selectedSetIds.length === sets.length ? 'ล้างที่เลือก' : 'เลือกทั้งหมด'}</button>
          {selectedSetIds.length > 0 && <button type="button" onClick={handleBulkDelete} className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-bold text-white">ลบ {selectedSetIds.length} รายการ</button>}
        </div>
      </div>}

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
              selected={selectedSetIds.includes(set.id)}
              onSelect={() => setSelectedSetIds((ids) => ids.includes(set.id) ? ids.filter((id) => id !== set.id) : [...ids, set.id])}
              onDragStart={() => setDraggedSetId(set.id)}
              onDrop={() => dropSet(set.id)}
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
  if (sch.status === 'unconfirmed' || results.some((result) => result.pending || result.verified === 'unconfirmed')) return { label: 'ส่งโพสต์แล้ว', cls: BADGE_CLS.emerald }
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
function ScheduleRow({ sch, set, accountName, canPost, running, accountBusy, onRun, onRepost, onEdit, onDelete }) {
  const [showDetails, setShowDetails] = useState(false)
  const results = sch.results || []
  const okCount = results.filter((r) => r.ok).length
  const hasResults = results.length > 0
  const hasFailures = results.some((r) => !r.ok)
  const hasPendingVerification = results.some((r) => r.pending || r.verified === 'unconfirmed')
  const isThisRunning = running?.id === sch.id
  const usesRandomGroup = sch.groupMode === 'random'
  const badge = badgeFor(sch)
  // One schedule may target several groups. Open every successfully verified
  // permalink from a single user click (usually this is just one link).
  const postUrls = [...new Set(results.filter((r) => r.ok && r.postUrl).map((r) => r.postUrl))]
  const hasGroupFallback = results.some((r) => r.ok && ['accepted', 'group_card'].includes(r.verified))

  function openPostedLinks() {
    postUrls.forEach((url) => window.open(url, '_blank', 'noopener,noreferrer'))
  }

  return (
    <div className={`rounded-xl border bg-white px-3 py-2 transition hover:border-indigo-200 hover:shadow-sm ${sch.status === 'posting' ? 'border-amber-300 ring-2 ring-amber-100' : 'border-slate-200'}`}>
      <div className="flex items-center gap-2.5">
        {set?.images?.[0]?.url ? (
          <img src={set.images[0].url} alt="" className="h-10 w-10 rounded-lg object-cover border border-slate-200 shrink-0" />
        ) : (
          <div className="h-10 w-10 rounded-lg bg-slate-100 grid place-items-center text-base shrink-0">📝</div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p className="text-sm font-bold text-slate-800 truncate">{sch.name}</p>
            {sch.source === 'auto' && (
              <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700">♻️ ระบบสร้าง</span>
            )}
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
          <p className="text-[11px] text-slate-500 truncate">
            {set ? `📝 ${set.name}` : '⚠️ ชุดโพสต์ถูกลบ'} ·{' '}
            {usesRandomGroup ? `🎲 สุ่มจาก ${sch.groups.length} กลุ่ม` : `📁 ${sch.groups.length} กลุ่ม`}
            {sch.batchSize > 1 ? ` · ⚡ คิว ${sch.batchIndex}/${sch.batchSize}` : ''}
            {' · '}👤 {accountName || 'บัญชีหลัก'}
          </p>
          <p className="mt-0.5 truncate text-[11px] text-indigo-600">
            {isThisRunning ? (
              <span className="font-semibold text-indigo-700">{running.message}</span>
            ) : sch.status === 'posting' ? (
              <span className="font-semibold text-amber-600">⏳ กำลังโพสต์อยู่...</span>
            ) : hasPendingVerification ? (
              <span className="font-semibold text-emerald-600">✅ ส่งโพสต์เข้า Facebook แล้ว</span>
            ) : hasResults ? (
              <span className={`font-semibold ${hasFailures ? 'text-rose-600' : 'text-emerald-600'}`}>
                {hasFailures ? '❌ ' : '✅ '}สำเร็จ {okCount}/{results.length} กลุ่ม
              </span>
            ) : sch.status === 'pending' ? (
              <span>⏰ กำหนดโพสต์ {scheduledAt(sch.runAt)}</span>
            ) : null}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            onClick={() => onRun(sch)}
            disabled={sch.status === 'posting' || !canPost || accountBusy}
            title="โพสต์ทันที"
            className="rounded-lg bg-indigo-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            📤 <span className="hidden xl:inline">โพสต์เลย</span>
          </button>
          <button
            onClick={onRepost}
            title="สร้างคิวโพสต์ซ้ำ"
            className="rounded-lg border border-indigo-200 px-2 py-1 text-[11px] font-semibold text-indigo-600 hover:bg-indigo-50"
          >
            🔁
          </button>
          {postUrls.length > 0 && (
            <button
              onClick={openPostedLinks}
              title="เปิดโพสต์ที่เผยแพร่แล้ว"
              className="rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-100"
            >
              ↗{postUrls.length > 1 ? ` ${postUrls.length}` : ''}
            </button>
          )}
          <button onClick={onEdit} title="แก้ไขคิว" className="rounded-lg px-1.5 py-1 text-xs text-indigo-600 hover:bg-indigo-50">✏️</button>
          <button onClick={onDelete} title="ลบคิว" className="rounded-lg px-1.5 py-1 text-xs text-rose-600 hover:bg-rose-50">🗑</button>
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
                <span className={`text-xs font-bold ${r.ok || r.pending ? 'text-emerald-600' : 'text-rose-600'}`}>
                  {r.ok ? '✓ เผยแพร่แล้ว' : r.pending ? '✓ ส่งโพสต์แล้ว' : '✗ ไม่สำเร็จ'}
                </span>
                <span className="truncate text-xs text-slate-600">📁 {labelOf(r.group)}</span>
                {r.ok && (r.postUrl || r.verified === 'group_card') && (
                  <a
                    href={r.postUrl || r.group}
                    target="_blank"
                    rel="noreferrer"
                    className="ml-auto shrink-0 rounded-md bg-indigo-50 px-2 py-1 text-[11px] font-semibold text-indigo-600 hover:bg-indigo-100"
                  >
                    ↗ {['accepted', 'group_card'].includes(r.verified) ? 'เปิดกลุ่ม' : 'เปิดโพสต์'}
                  </a>
                )}
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
  const [postGapMinutes, setPostGapMinutes] = useState(0)
  const [postGapMinutesByAccount, setPostGapMinutesByAccount] = useState({})
  const [runningById, setRunningById] = useState({}) // schedule id -> { id, accountId, message }
  const [showWarning, setShowWarning] = useState(true)
  const [accounts, setAccounts] = useState([])
  const [statusFilter, setStatusFilter] = useState('all')
  const [accountFilter, setAccountFilter] = useState('all')
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState('runSoon')
  const [pageSize, setPageSize] = useState(40)
  const [page, setPage] = useState(1)
  const [postingSettings, setPostingSettings] = useState(null)
  const [savingSettings, setSavingSettings] = useState(false)

  function load(silent = false) {
    if (!silent) setLoading(true)
    setError(null)
    Promise.all([getSchedules(), getPostSets(), getAccounts(), getPostingSettings()])
      .then(([s, p, a, workingHours]) => {
        setSchedules(s.schedules || [])
        setSets(p.postsets || [])
        setAccounts(a.accounts || [])
        setPostingSettings(workingHours)
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
      .then((h) => {
        setCanPost(Boolean(h.canPost))
        setPostGapMinutes(Number(h.postGapMinutes) || 0)
        setPostGapMinutesByAccount(h.postGapMinutesByAccount || {})
      })
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
  const accountNameOf = (id) => accounts.find((account) => account.id === (id || 'primary'))?.name || 'บัญชีหลัก'
  const counts = {
    pending: schedules.filter((item) => item.status === 'pending').length,
    posting: schedules.filter((item) => item.status === 'posting').length,
    done: schedules.filter((item) => item.status === 'done').length,
    failed: schedules.filter((item) => item.status === 'failed').length,
  }
  const preparedSchedules = useMemo(() => schedules.map((schedule) => ({
    ...schedule,
    setName: setById(schedule.postSetId)?.name || '',
    accountName: accountNameOf(schedule.accountId),
  })), [schedules, sets, accounts])
  const filteredSchedules = useMemo(() => filterAndSortSchedules(preparedSchedules, {
    query,
    status: statusFilter,
    account: accountFilter,
    sort,
  }), [preparedSchedules, query, statusFilter, accountFilter, sort])
  const pagedSchedules = useMemo(
    () => paginateSchedules(filteredSchedules, page, pageSize),
    [filteredSchedules, page, pageSize],
  )
  const visibleSchedules = pagedSchedules.items

  useEffect(() => setPage(1), [query, statusFilter, accountFilter, sort, pageSize])

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

  async function saveWorkingHours(event) {
    event.preventDefault()
    if (!postingSettings?.settings) return
    setSavingSettings(true)
    setError(null)
    try {
      const saved = await updatePostingSettings(postingSettings.settings)
      setPostingSettings(saved)
      load(true)
    } catch (e) {
      setError(e.message)
    } finally {
      setSavingSettings(false)
    }
  }

  // Manual "โพสต์เลย": open the SSE stream and show live progress inline.
  async function runNow(sch) {
    if (!canPost) {
      setError('ยังไม่พร้อมโพสต์ — รัน "npm run login" บนเซิร์ฟเวอร์ก่อน')
      return
    }
    const freshHealth = await getHealth().catch(() => null)
    const accountId = sch.accountId || 'primary'
    if (Object.values(runningById).some((run) => run.accountId === accountId)) return
    const gapMinutes = Number(freshHealth?.postGapMinutesByAccount?.[accountId])
      || Number(postGapMinutesByAccount[accountId])
      || (accountId === 'primary' ? postGapMinutes : 0)
    setPostGapMinutes(gapMinutes)
    if (freshHealth?.postGapMinutesByAccount) setPostGapMinutesByAccount(freshHealth.postGapMinutesByAccount)
    if (gapMinutes > 0 && !confirm(`เพิ่งมีโพสต์สำเร็จภายในช่วง 30 นาทีที่ผ่านมา\nยังเหลือประมาณ ${gapMinutes} นาที\n\nต้องการโพสต์ซ้ำตอนนี้หรือไม่?`)) {
      return
    }
    setError(null)
    setRunningById((current) => ({ ...current, [sch.id]: { id: sch.id, accountId, message: '⏳ เริ่มโพสต์...' } }))
    streamScheduleRun(sch.id, {
      onProgress: ({ message }) => setRunningById((current) => ({ ...current, [sch.id]: { id: sch.id, accountId, message } })),
      onDone: () => {
        setRunningById((current) => { const next = { ...current }; delete next[sch.id]; return next })
        load(true)
      },
      onError: (msg) => {
        setRunningById((current) => { const next = { ...current }; delete next[sch.id]; return next })
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
      schedule: { name: sch.name, postSetId: sch.postSetId, groups: [...(sch.groups || [])], accountId: sch.accountId || 'primary' },
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

      <div className="rounded-3xl bg-gradient-to-br from-indigo-600 via-violet-600 to-purple-700 p-5 text-white shadow-lg shadow-indigo-200/60">
        <div className="flex items-center justify-between gap-4">
          <div><p className="text-xs font-semibold uppercase tracking-widest text-indigo-100">Auto Post Dashboard</p><h2 className="mt-1 text-2xl font-bold">จัดการคิวโพสต์</h2><p className="mt-1 text-sm text-indigo-100">ตั้งเวลา ตรวจสถานะ และเลือกบัญชีที่ใช้โพสต์ได้ในที่เดียว</p></div>
        <button
          onClick={() => setEditor({ open: true, schedule: null })}
          className="shrink-0 rounded-xl bg-white px-4 py-2.5 text-sm font-bold text-indigo-700 shadow-sm hover:bg-indigo-50"
        >
          ＋ ตั้งเวลาโพสต์
        </button>
        </div>
      </div>

      {postingSettings?.settings && (
        <form onSubmit={saveWorkingHours} className="flex flex-wrap items-end gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
          <div className="mr-auto">
            <p className="text-sm font-bold text-slate-800">🕘 ช่วงเวลาทำงานรวม</p>
            <p className="mt-0.5 text-xs text-slate-500">
              เวลาไทย · นอกช่วงนี้คิวจะถูกเลื่อนไปรอบถัดไปอัตโนมัติ
            </p>
          </div>
          <label className="text-xs font-semibold text-slate-600">
            เริ่ม
            <input
              type="time"
              value={postingSettings.settings.startTime}
              onChange={(event) => setPostingSettings((current) => ({ ...current, settings: { ...current.settings, startTime: event.target.value } }))}
              className="ml-2 rounded-xl border border-slate-200 px-3 py-2 text-sm"
            />
          </label>
          <label className="text-xs font-semibold text-slate-600">
            ถึง
            <input
              type="time"
              value={postingSettings.settings.endTime}
              onChange={(event) => setPostingSettings((current) => ({ ...current, settings: { ...current.settings, endTime: event.target.value } }))}
              className="ml-2 rounded-xl border border-slate-200 px-3 py-2 text-sm"
            />
          </label>
          <span className={`rounded-full px-3 py-2 text-xs font-bold ${postingSettings.withinWindow ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
            {postingSettings.withinWindow ? '● อยู่ในเวลาทำงาน' : '○ นอกเวลาทำงาน'}
          </span>
          <button disabled={savingSettings} className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-bold text-white hover:bg-indigo-700 disabled:opacity-50">
            {savingSettings ? 'กำลังบันทึก…' : 'บันทึกเวลา'}
          </button>
        </form>
      )}

      <div className="grid grid-cols-4 gap-2">
        {[
          ['pending', 'รอโพสต์', counts.pending, 'text-indigo-700 bg-indigo-50 border-indigo-100'],
          ['posting', 'กำลังโพสต์', counts.posting, 'text-amber-700 bg-amber-50 border-amber-100'],
          ['done', 'สำเร็จ', counts.done, 'text-emerald-700 bg-emerald-50 border-emerald-100'],
          ['failed', 'ไม่สำเร็จ', counts.failed, 'text-rose-700 bg-rose-50 border-rose-100'],
        ].map(([id, label, count, cls]) => <button key={id} onClick={() => setStatusFilter(statusFilter === id ? 'all' : id)} className={`flex items-center justify-between rounded-xl border px-3 py-2 text-left transition ${cls} ${statusFilter === id ? 'ring-2 ring-current' : 'hover:shadow-sm'}`}><span className="text-xs font-semibold">{label}</span><span className="text-lg font-black">{count}</span></button>)}
      </div>
      <div className="sticky top-2 z-10 rounded-2xl border border-slate-200 bg-white/95 p-2 shadow-sm backdrop-blur">
        <div className="grid gap-2 md:grid-cols-[minmax(220px,1fr)_160px_150px_130px]">
          <label className="relative">
            <span className="pointer-events-none absolute left-3 top-2 text-sm text-slate-400">⌕</span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ค้นหาชื่อคิว ชุดโพสต์ บัญชี หรือกลุ่ม…" className="w-full rounded-xl border border-slate-200 py-1.5 pl-8 pr-3 text-sm outline-none focus:border-indigo-400" />
          </label>
          <select value={accountFilter} onChange={(event) => setAccountFilter(event.target.value)} className="rounded-xl border border-slate-200 px-2 py-1.5 text-xs">
            <option value="all">ทุกบัญชี</option>
            {accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
          </select>
          <select value={sort} onChange={(event) => setSort(event.target.value)} className="rounded-xl border border-slate-200 px-2 py-1.5 text-xs">
            <option value="runSoon">คิวถัดไปก่อน</option>
            <option value="newest">สร้างล่าสุด</option>
            <option value="oldest">สร้างเก่าสุด</option>
            <option value="runLate">กำหนดช้าสุด</option>
          </select>
          <select value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))} className="rounded-xl border border-slate-200 px-2 py-1.5 text-xs">
            <option value={20}>20 รายการ</option>
            <option value={40}>40 รายการ</option>
            <option value={80}>80 รายการ</option>
          </select>
        </div>
        <div className="mt-1.5 flex items-center justify-between px-1 text-[11px] text-slate-500">
          <span>พบ {pagedSchedules.total} จาก {schedules.length} คิว · หน้า {pagedSchedules.page}/{pagedSchedules.pages}</span>
          {(query || statusFilter !== 'all' || accountFilter !== 'all') && <button onClick={() => { setQuery(''); setStatusFilter('all'); setAccountFilter('all') }} className="font-semibold text-indigo-600">ล้างตัวกรอง</button>}
        </div>
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
      ) : visibleSchedules.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white py-10 text-center text-sm text-slate-400">
          ไม่มีคิวในสถานะนี้
        </div>
      ) : (
        <div className="space-y-1.5">
          {visibleSchedules.map((sch) => (
            <ScheduleRow
              key={sch.id}
              sch={sch}
              set={setById(sch.postSetId)}
              accountName={accountNameOf(sch.accountId)}
              canPost={canPost}
              running={runningById[sch.id] || null}
              accountBusy={Object.values(runningById).some((run) => run.accountId === (sch.accountId || 'primary'))}
              onRun={runNow}
              onRepost={() => repost(sch)}
              onEdit={() => setEditor({ open: true, schedule: sch })}
              onDelete={() => handleDelete(sch)}
            />
          ))}
        </div>
      )}

      {pagedSchedules.pages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button disabled={pagedSchedules.page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold disabled:opacity-40">← ก่อนหน้า</button>
          <span className="text-xs text-slate-500">{pagedSchedules.page} / {pagedSchedules.pages}</span>
          <button disabled={pagedSchedules.page >= pagedSchedules.pages} onClick={() => setPage((value) => Math.min(pagedSchedules.pages, value + 1))} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold disabled:opacity-40">ถัดไป →</button>
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
  { id: 'automatic', label: '♻️ โหมดรันอัตโนมัติ' },
  { id: 'accounts', label: '👤 บัญชีโพสต์' },
]

export default function AutoPostView() {
  const [tab, setTab] = useState('automatic')
  return (
    <main className="max-w-7xl mx-auto px-5 py-6 space-y-5">
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

      {tab === 'sets' ? <PostSetsPanel /> : tab === 'accounts' ? <AccountsPanel /> : <AutoCampaignPanel onOpenAccounts={() => setTab('accounts')} />}
    </main>
  )
}
