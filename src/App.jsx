import { useEffect, useMemo, useState } from 'react'
import { fetchLeads } from './api'
import Header from './components/Header'
import StatsBar from './components/StatsBar'
import FilterTabs from './components/FilterTabs'
import ModeToggle from './components/ModeToggle'
import WindowSelect from './components/WindowSelect'
import GroupsModal from './components/GroupsModal'
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

  // fresh=true re-scrapes Facebook; false reuses the server's cached scrape.
  async function load(fresh = false) {
    setLoading(true)
    setError(null)
    try {
      const data = await fetchLeads({ minutes, mode, fresh })
      setLeads(data.leads || [])
      setSource(data.source || 'demo')
      setClassifier(data.classifier || null)
      setLastUpdated(new Date().toLocaleTimeString('th-TH'))
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  // Toggling mode re-classifies the cached scrape (fast). Changing the time
  // window triggers a fresh scrape on the server (cache is keyed by minutes).
  useEffect(() => {
    load(false)
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

        {loading ? (
          <EmptyState
            icon="⏳"
            title={
              mode === 'keyword'
                ? 'กำลังดึงโพสต์ + คัดกรองด้วย Keyword...'
                : 'กำลังดึงโพสต์ + วิเคราะห์ด้วย Gemini AI...'
            }
          />
        ) : visible.length === 0 ? (
          <EmptyState
            title="ยังไม่มีโพสต์ในหมวดนี้"
            subtitle="ลองกด “ดึงโพสต์ล่าสุด” อีกครั้ง หรือสลับแท็บ"
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {visible
              .slice()
              .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
              .map((lead) => (
                <LeadCard key={lead.id} lead={lead} />
              ))}
          </div>
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
    </div>
  )
}
