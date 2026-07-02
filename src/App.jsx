import { useEffect, useMemo, useRef, useState } from 'react'
import { streamLeads } from './api'
import Header from './components/Header'
import StatsBar from './components/StatsBar'
import FilterTabs from './components/FilterTabs'
import ModeToggle from './components/ModeToggle'
import WindowSelect from './components/WindowSelect'
import GroupsModal from './components/GroupsModal'
import KeywordsModal from './components/KeywordsModal'
import ProgressBar from './components/ProgressBar'
import LeadCard from './components/LeadCard'
import EmptyState from './components/EmptyState'

export default function App() {
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
  const [percent, setPercent] = useState(0)
  const [logs, setLogs] = useState([])
  const esRef = useRef(null)

  // fresh=true re-scrapes Facebook; false reuses the server's cached scrape.
  // Streams live progress (percent + log) over SSE.
  function load(fresh = false) {
    esRef.current?.close()
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

  // Toggling mode re-classifies the cached scrape (fast). Changing the time
  // window triggers a fresh scrape on the server (cache is keyed by minutes).
  useEffect(() => {
    load(false)
    return () => esRef.current?.close()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, minutes])

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
        onRefresh={() => load(true)}
        onStop={stop}
        loading={loading}
        lastUpdated={lastUpdated}
      />

      <main className="max-w-6xl mx-auto px-5 py-6 space-y-5">
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
          </div>
        </div>

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
          !loading && (
            <EmptyState
              title="ยังไม่มีโพสต์ในหมวดนี้"
              subtitle="ลองกด “ดึงโพสต์ล่าสุด” อีกครั้ง หรือสลับแท็บ"
            />
          )
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
    </div>
  )
}
