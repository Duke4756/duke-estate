import { useEffect, useMemo, useRef, useState } from 'react'
import { streamLeads, getHistoryRound, getHealth, extractOwnerListing } from './api'
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
import OwnerDatabaseView from './components/OwnerDatabaseView'
import GroupCrawlHistoryModal from './components/GroupCrawlHistoryModal'
import OwnerListingReviewQueue from './components/owner/OwnerListingReviewQueue'
import SettingsView from './components/SettingsView'

const APP_ROLE = import.meta.env.VITE_APP_ROLE || 'all'

export default function App() {
  const [appMode, setAppMode] = useState(APP_ROLE === 'search' ? 'owners' : 'autopost')
  const [leads, setLeads] = useState([])
  const [source, setSource] = useState('demo')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [filter, setFilter] = useState('renter')
  const [searchMode, setSearchMode] = useState('lead')
  const [selectedOwnerIds, setSelectedOwnerIds] = useState([])
  const [selectedLeadIds, setSelectedLeadIds] = useState([])
  const [extractingOwners, setExtractingOwners] = useState(false)
  const [reviewRefresh, setReviewRefresh] = useState(0)
  const [lastUpdated, setLastUpdated] = useState(null)
  // 'keyword' = fast rules (good for testing the scraper), 'ai' = Gemini.
  const [mode, setMode] = useState('keyword')
  const [minutes, setMinutes] = useState(180) // ช่วงเวลาที่ดึง (นาที)
  const [groupCategory, setGroupCategory] = useState('all')
  const [customGroupUrl, setCustomGroupUrl] = useState('')
  const [classifier, setClassifier] = useState(null)
  const [showGroups, setShowGroups] = useState(false)
  const [showKeywords, setShowKeywords] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [showGroupCrawlHistory, setShowGroupCrawlHistory] = useState(false)
  const [skippedGroupKeys, setSkippedGroupKeys] = useState([])
  const [groupHistoryConfigured, setGroupHistoryConfigured] = useState(false)
  const [viewingRound, setViewingRound] = useState(null) // history meta when reviewing a past round
  const [percent, setPercent] = useState(0)
  const [logs, setLogs] = useState([])
  const [hasSession, setHasSession] = useState(null) // null=unknown, false=not logged in
  const [checkingSession, setCheckingSession] = useState(false)
  const [notice, setNotice] = useState(null) // transient toast
  const esRef = useRef(null)
  const autoSavedOwnerIds = useRef(new Set())

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
      {
        minutes, mode, searchMode, fresh, groupCategory,
        customUrl: groupCategory === 'custom-url' ? customGroupUrl : '',
        skipGroups: groupCategory === 'custom-url' ? [] : skippedGroupKeys,
      },
      {
        onProgress: ({ percent, message }) => {
          if (typeof percent === 'number') setPercent(percent)
          if (message) setLogs((l) => [...l, message].slice(-60))
        },
        onPipeline: (event) => {
          const labels = { RAW_POST_SAVED: 'Raw post saved', DUPLICATE_SKIPPED: 'Duplicate skipped', JOB_QUEUED: 'Queued for processing', CLASSIFIED: `Classified: ${event.classification || ''}`, SEGMENTED: `Segmented: ${event.listingCount || 0} listings`, COMPLETED: 'Property saved', NEEDS_REVIEW: 'Needs review', RETRY_SCHEDULED: 'Retry scheduled', FAILED: 'Processing failed' }
          setLogs((items) => [...items, labels[event.type] || event.type].slice(-60))
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
          if (searchMode === 'owner_listing') {
            for (const post of leads.filter((item) => ['owner_rent', 'owner_sale', 'agent_listing', 'co_agent_listing'].includes(item.category))) {
              const sourceKey = `${post.id}:${post.text || ''}`
              if (autoSavedOwnerIds.current.has(sourceKey)) continue
              autoSavedOwnerIds.current.add(sourceKey)
              extractOwnerListing(post, false, true)
                .then(() => setReviewRefresh((value) => value + 1))
                .catch((saveError) => {
                  autoSavedOwnerIds.current.delete(sourceKey)
                  setError(`บันทึก Owner อัตโนมัติไม่สำเร็จ: ${saveError.message}`)
                })
            }
          }
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
    if (groupCategory === 'custom-url' && !/facebook\.com\/groups\//i.test(customGroupUrl)) {
      setNotice('⚠️ กรุณาวางลิงก์กลุ่ม Facebook ให้ถูกต้องก่อนเริ่มค้นหา')
      return
    }
    const ok = await checkSession()
    if (!ok) setNotice(NO_SESSION_MSG)
    load(true)
  }

  async function extractPosts(posts) {
    if (!posts.length || extractingOwners) return
    setExtractingOwners(true)
    setError(null)
    try {
      for (const post of posts) await extractOwnerListing(post, !['owner_rent', 'owner_sale', 'agent_listing', 'co_agent_listing'].includes(post.category), false)
      setSelectedOwnerIds([])
      setReviewRefresh((value) => value + 1)
    } catch (e) { setError(e.message) }
    finally { setExtractingOwners(false) }
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

  const acceptedOwners = useMemo(() => leads.filter((lead) => ['owner_rent', 'owner_sale', 'agent_listing', 'co_agent_listing'].includes(lead.category)), [leads])
  const unknownOwners = useMemo(() => leads.filter((lead) => lead.category === 'unknown'), [leads])
  const rejectedOwners = useMemo(() => leads.filter((lead) => !['owner_rent', 'owner_sale', 'agent_listing', 'co_agent_listing', 'unknown'].includes(lead.category)), [leads])
  const counts = searchMode === 'owner_listing'
    ? { owner: acceptedOwners.length, rejected: rejectedOwners.length, unknown: unknownOwners.length, all: leads.length }
    : { renter: renters.length, all: leads.length, other: others.length }

  const visible = searchMode === 'owner_listing'
    ? filter === 'owner' ? acceptedOwners : filter === 'rejected' ? rejectedOwners : filter === 'unknown' ? unknownOwners : leads
    : filter === 'renter' ? renters : filter === 'other' ? others : leads

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
      {appMode === 'settings' && <SettingsView />}
      {/* Keep the owner workspace mounted while switching tabs. Its collection
          stream therefore continues in the background instead of being
          cancelled by a navigation-only UI change. */}
      <div className={appMode === 'owners' ? '' : 'hidden'}>
        <OwnerDatabaseView />
      </div>

      <main
        className={`max-w-6xl mx-auto px-5 py-6 space-y-5 ${appMode === 'search' ? '' : 'hidden'}`}
      >
        {searchMode === 'lead' && <StatsBar total={leads.length} renters={renters.length} others={others.length} />}

        {error && (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
            ⚠️ {error}
          </div>
        )}

        <div className="flex items-center justify-between gap-3 flex-wrap">
          <FilterTabs mode={searchMode} active={filter} onChange={setFilter} counts={counts} />
          <div className="flex items-center gap-3 flex-wrap">
            <div className="inline-flex rounded-xl border border-slate-200 bg-white p-1">
              <button type="button" onClick={() => { setSearchMode('lead'); setFilter('renter'); setLeads([]) }} className={`rounded-lg px-3 py-1.5 text-xs font-bold ${searchMode === 'lead' ? 'bg-indigo-600 text-white' : 'text-slate-500'}`}>🎯 Lead</button>
              <button type="button" onClick={() => { setSearchMode('owner_listing'); setFilter('owner'); setLeads([]) }} className={`rounded-lg px-3 py-1.5 text-xs font-bold ${searchMode === 'owner_listing' ? 'bg-emerald-600 text-white' : 'text-slate-500'}`}>🏠 Property (Owner / Agent)</button>
            </div>
            <select
              value={groupCategory}
              onChange={(e) => setGroupCategory(e.target.value)}
              disabled={loading}
              className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-600"
            >
              <option value="all">ทุกชุดกลุ่ม</option>
              <option value="general">ชุดกลุ่มทั่วไป</option>
              <option value="pet">🐾 กลุ่มเลี้ยงสัตว์ได้</option>
              <option value="owner">กลุ่มเจ้าของโดยตรง</option>
              <option value="sale">กลุ่มซื้อ / ขาย</option>
              <option value="custom">กลุ่มกำหนดเอง</option>
              <option value="custom-url">🔗 ใช้ลิงก์นี้ครั้งเดียว</option>
            </select>
            {groupCategory === 'custom-url' && (
              <input
                value={customGroupUrl}
                onChange={(e) => setCustomGroupUrl(e.target.value)}
                placeholder="วางลิงก์กลุ่ม Facebook"
                disabled={loading}
                className="w-64 rounded-xl border border-indigo-200 bg-white px-3 py-1.5 text-sm outline-none focus:border-indigo-500"
              />
            )}
            <WindowSelect minutes={minutes} onChange={setMinutes} disabled={loading} />
            <ModeToggle mode={mode} onChange={setMode} disabled={loading} />
            <button
              onClick={() => setShowGroupCrawlHistory(true)}
              disabled={loading || groupCategory === 'custom-url'}
              className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-1.5 text-sm font-medium text-amber-700 hover:bg-amber-100 disabled:opacity-40"
            >
              🧭 ประวัติกลุ่ม{skippedGroupKeys.length ? ` · ข้าม ${skippedGroupKeys.length}` : ''}
            </button>
            <button
              onClick={() => setShowGroups(true)}
              className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
            >
              ⚙️ คลัง/ชุดกลุ่ม
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

        {searchMode === 'owner_listing' && <OwnerListingReviewQueue refreshToken={reviewRefresh} />}

        {searchMode === 'owner_listing' && selectedOwnerIds.length > 0 && <div className="sticky top-2 z-20 flex items-center justify-between rounded-2xl border border-indigo-200 bg-white p-3 shadow-lg"><span className="text-sm font-bold text-slate-700">เลือกแล้ว {selectedOwnerIds.length} โพสต์</span><button disabled={extractingOwners} onClick={() => extractPosts(leads.filter((lead) => selectedOwnerIds.includes(lead.id)))} className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{extractingOwners ? 'กำลัง Extract…' : 'AI Extract รายการที่เลือก'}</button></div>}

        {visible.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {visible
              .slice()
              .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
              .map((lead) => (
                <LeadCard key={lead.id} lead={lead} selected={searchMode === 'owner_listing' ? selectedOwnerIds.includes(lead.id) : selectedLeadIds.includes(lead.id)} onSelect={searchMode === 'owner_listing' ? (checked) => setSelectedOwnerIds((ids) => checked ? [...new Set([...ids, lead.id])] : ids.filter((id) => id !== lead.id)) : (checked) => setSelectedLeadIds((ids) => checked ? [...new Set([...ids, lead.id])] : ids.filter((id) => id !== lead.id))} onExtract={searchMode === 'owner_listing' ? () => extractPosts([lead]) : undefined} />
              ))}
          </div>
        ) : (
          !loading &&
          (leads.length === 0 ? (
            <EmptyState
              icon="👆"
              title="กดปุ่ม “ค้นหาต่อ · เก็บโพสต์ใหม่” เพื่อเริ่ม"
              subtitle="ระบบจะข้ามโพสต์ที่เคยพบ และไล่ย้อนหลังต่อจากระดับเดิมของแต่ละกลุ่ม"
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
          setSkippedGroupKeys([])
          setGroupHistoryConfigured(false)
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
      <GroupCrawlHistoryModal
        open={showGroupCrawlHistory}
        onClose={() => setShowGroupCrawlHistory(false)}
        currentSkipped={skippedGroupKeys}
        configured={groupHistoryConfigured}
        onApply={(keys) => {
          setSkippedGroupKeys(keys)
          setGroupHistoryConfigured(true)
        }}
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
