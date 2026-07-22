import { useEffect, useMemo, useRef, useState } from 'react'
import { streamLeads, getHistoryRound, getHealth } from './api'
import Header from './components/Header'
import SessionBanner from './components/SessionBanner'
import StatsBar from './components/StatsBar'
import FilterTabs from './components/FilterTabs'
import ModeToggle from './components/ModeToggle'
import WindowSelect from './components/WindowSelect'
import GroupsModal from './components/GroupsModal'
import KeywordsModal from './components/KeywordsModal'
import HistoryModal from './components/HistoryModal'
import ProgressBar from './components/ProgressBar'
import LeadCard from './components/LeadCard'
import EmptyState from './components/EmptyState'
import AutoPostView from './components/AutoPostView'

export default function App() {
  const [appMode, setAppMode] = useState('search') // 'search' | 'autopost'
  const [leads, setLeads] = useState([])
  const [source, setSource] = useState('demo')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [filter, setFilter] = useState('renter')
  const [lastUpdated, setLastUpdated] = useState(null)
  // 'keyword' = fast rules (good for testing the scraper), 'ai' = Gemini.
  const [mode, setMode] = useState('keyword')
  const [minutes, setMinutes] = useState(180) // ช่วงเวลาที่ดึง (นาที)
  const [classifier, setClassifier] = useState(null)
  const [showGroups, setShowGroups] = useState(false)
  const [showKeywords, setShowKeywords] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [viewingRound, setViewingRound] = useState(null) // history meta when reviewing a past round
  const [percent, setPercent] = useState(0)
  const [logs, setLogs] = useState([])
  const [hasSession, setHasSession] = useState(null) // null=unknown, false=not logged in
  const [checkingSession, setCheckingSession] = useState(false)
  const [notice, setNotice] = useState(null) // transient toast
  const esRef = useRef(null)

  async function checkSession() {
    setCheckingSession(true)
    try {
      const h = await getHealth()
      setHasSession(Boolean(h.hasSession))
      return Boolean(h.hasSession)
    } catch {
      return false
    } finally {
      setCheckingSession(false)
    }
  }

  // Check FB session on first load → shows a warning banner if not logged in.
  useEffect(() => {
    checkSession()
  }, [])

  // Auto-dismiss the toast.
  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => setNotice(null), 6000)
    return () => clearTimeout(t)
  }, [notice])

  const NO_SESSION_MSG =
    '⚠️ ยังไม่ได้เข้าสู่ระบบ Facebook — จะแสดงข้อมูลตัวอย่างแทน · รัน "npm run login" เพื่อเชื่อมต่อของจริง'

  // fresh=true re-scrapes Facebook; false reuses the server's cached scrape.
  // Streams live progress (percent + log) over SSE.
  function load(fresh = false) {
    // A fresh scrape connects to Playwright + Facebook — warn if not logged in.
    if (fresh && hasSession === false) setNotice(NO_SESSION_MSG)
    esRef.current?.close()
    setViewingRound(null) // going live exits any history view
    setLoading(true)
    setError(null)
    setPercent(0)
    setLogs([])
    setLeads([]) // clear so cards can stream in fresh
    esRef.current = streamLeads(
      { minutes, mode, fresh },
      {
        onProgress: ({ percent, message }) => {
          if (typeof percent === 'number') setPercent(percent)
          if (message) setLogs((l) => [...l, message].slice(-60))
        },
        // Each group's leads arrive here → append (dedupe by id) so posts
        // show up progressively without waiting for the whole scrape.
        onLeads: ({ leads, classifier }) => {
          setLeads((prev) => {
            const byId = new Map(prev.map((l) => [l.id, l]))
            for (const l of leads) byId.set(l.id, l)
            return [...byId.values()]
          })
          if (classifier) setClassifier(classifier)
          setSource('live')
        },
        onDone: (data) => {
          setSource(data.source || 'demo')
          if (data.classifier) setClassifier(data.classifier)
          setLastUpdated(new Date().toLocaleTimeString('th-TH'))
          setLoading(false)
        },
        onError: (msg) => {
          setError(msg)
          setLoading(false)
        },
      },
    )
  }

  function stop() {
    esRef.current?.close()
    esRef.current = null
    setLoading(false)
    setLogs((l) => [...l, '⏹ หยุดโดยผู้ใช้'])
  }

  // Refresh button: re-verify session first (user may have just run `npm run
  // login`), warn if still missing, then scrape.
  async function handleRefresh() {
    const ok = await checkSession()
    if (!ok) setNotice(NO_SESSION_MSG)
    load(true)
  }

  // Load a past search round from history into the main view.
  async function openRound(id) {
    try {
      esRef.current?.close()
      const r = await getHistoryRound(id)
      setLoading(false)
      setLeads(r.leads || [])
      setClassifier(r.meta?.classifier || null)
      setViewingRound(r.meta || { id })
      setSource('history')
      setShowHistory(false)
      setError(null)
    } catch (e) {
      setError(e.message)
    }
  }

  // No auto-search: entering the site (or changing window/mode) does NOT fetch.
  // The user must press "ดึงโพสต์ล่าสุด" to start. Just clean up the stream on unmount.
  useEffect(() => {
    return () => esRef.current?.close()
  }, [])

  const renters = useMemo(
    () => leads.filter((l) => l.category === 'renter'),
    [leads],
  )
  const others = useMemo(
    () => leads.filter((l) => l.category !== 'renter'),
    [leads],
  )

  const counts = { renter: renters.length, all: leads.length, other: others.length }

  const visible =
    filter === 'renter' ? renters : filter === 'other' ? others : leads

  return (
    <div className="min-h-screen">
      <Header
        source={source}
        onRefresh={handleRefresh}
        onStop={stop}
        loading={loading}
        lastUpdated={lastUpdated}
        appMode={appMode}
        onMode={setAppMode}
      />

      {hasSession === false && (
        <SessionBanner onRecheck={checkSession} checking={checkingSession} />
      )}

      {appMode === 'autopost' && <AutoPostView />}

      <main
        className={`max-w-6xl mx-auto px-5 py-6 space-y-5 ${appMode === 'search' ? '' : 'hidden'}`}
      >
        <StatsBar total={leads.length} renters={renters.length} others={others.length} />

        {error && (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
            ⚠️ {error}
          </div>
        )}

        <div className="flex items-center justify-between gap-3 flex-wrap">
          <FilterTabs active={filter} onChange={setFilter} counts={counts} />
          <div className="flex items-center gap-3 flex-wrap">
            <WindowSelect minutes={minutes} onChange={setMinutes} disabled={loading} />
            <ModeToggle mode={mode} onChange={setMode} disabled={loading} />
            <button
              onClick={() => setShowGroups(true)}
              className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
            >
              ⚙️ กลุ่ม
            </button>
            <button
              onClick={() => setShowKeywords(true)}
              className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
            >
              🏷️ Keywords
            </button>
            <button
              onClick={() => setShowHistory(true)}
              className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
            >
              🕘 History
            </button>
          </div>
        </div>

        {viewingRound && (
          <div className="flex items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
            <span>
              📖 กำลังดูประวัติ:{' '}
              <span className="font-semibold">
                {new Date(viewingRound.savedAt).toLocaleString('th-TH', {
                  day: '2-digit',
                  month: 'short',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>{' '}
              ({viewingRound.total} โพสต์)
            </span>
            <button
              onClick={() => load(false)}
              className="shrink-0 rounded-lg bg-amber-200/70 px-3 py-1 text-xs font-semibold text-amber-800 hover:bg-amber-200"
            >
              ← กลับสู่ live
            </button>
          </div>
        )}

        <div className="flex items-center justify-between gap-3 flex-wrap -mt-2">
          <p className="text-xs text-slate-400">
            แสดงโพสต์ในช่วง {minutes >= 60 ? `${minutes / 60} ชั่วโมง` : `${minutes} นาที`}ที่ผ่านมา ·
            เรียงจากใหม่ → เก่า
          </p>
          {classifier && (
            <p className="text-xs text-slate-400">
              คัดกรองด้วย:{' '}
              <span className="font-semibold text-slate-600">
                {classifier === 'ai' ? '🤖 Gemini' : `⚡ ${classifier}`}
              </span>
            </p>
          )}
        </div>

        {/* Progress bar shows while loading — but cards below stream in live. */}
        {loading && <ProgressBar percent={percent} logs={logs} mode={mode} onStop={stop} />}

        {visible.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {visible
              .slice()
              .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
              .map((lead) => (
                <LeadCard key={lead.id} lead={lead} />
              ))}
          </div>
        ) : (
          !loading &&
          (leads.length === 0 ? (
            <EmptyState
              icon="👆"
              title="กดปุ่ม “ดึงโพสต์ล่าสุด” มุมขวาบนเพื่อเริ่มค้นหา"
              subtitle="เลือกช่วงเวลา / โหมด ตามต้องการก่อน แล้วกดปุ่มเพื่อเริ่ม (ไม่ค้นหาอัตโนมัติ)"
            />
          ) : (
            <EmptyState
              title="ไม่มีโพสต์ในหมวดนี้"
              subtitle="ลองสลับแท็บ ทั้งหมด / เจ้าของ ดู"
            />
          ))
        )}

        <footer className="pt-4 pb-8 text-center text-[11px] text-slate-400">
          Condo Lead Finder · ขับเคลื่อนด้วย Gemini AI ·{' '}
          {source === 'demo' && 'กำลังใช้ข้อมูลตัวอย่าง — ดู README เพื่อเชื่อมต่อ Facebook จริง'}
        </footer>
      </main>

      <GroupsModal
        open={showGroups}
        onClose={() => setShowGroups(false)}
        onSaved={() => {
          setShowGroups(false)
          load(true) // groups changed → re-scrape
        }}
      />
      <KeywordsModal
        open={showKeywords}
        onClose={() => setShowKeywords(false)}
        onSaved={() => {
          setShowKeywords(false)
          load(false) // keywords changed → re-classify (no re-scrape)
        }}
      />
      <HistoryModal
        open={showHistory}
        onClose={() => setShowHistory(false)}
        onOpenRound={openRound}
      />

      {/* Transient toast (e.g. no-session warning on connect actions) */}
      {notice && (
        <div className="fixed bottom-5 left-1/2 z-50 -translate-x-1/2 max-w-md rounded-xl bg-slate-900 px-4 py-3 text-sm text-white shadow-xl">
          <div className="flex items-start gap-3">
            <span className="flex-1 leading-relaxed">{notice}</span>
            <button onClick={() => setNotice(null)} className="text-slate-400 hover:text-white">
              ✕
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
