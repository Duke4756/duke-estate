import { useEffect, useState } from 'react'
import { addSourceCandidate, authorizeSource, controlSourceLane, getOwnerRulesStatus, getSourceCoverage, getSources, refreshOwnerRules, setSourceStatus } from '../api'

export default function SettingsView() {
  const [status, setStatus] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [sources, setSources] = useState([])
  const [coverage, setCoverage] = useState(null)
  const [sourceState, setSourceState] = useState(null)
  const [url, setUrl] = useState('')
  const load = async (refresh = false) => {
    setLoading(true); setError('')
    try {
      const [rules, sourceResult, coverageResult] = await Promise.all([refresh ? refreshOwnerRules() : getOwnerRulesStatus(), getSources(), getSourceCoverage()])
      setStatus(rules); setSources(sourceResult.sources || []); setSourceState(sourceResult.state); setCoverage(coverageResult)
    }
    catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])
  const act = async (action) => { setLoading(true); setError(''); try { await action(); await load() } catch (e) { setError(e.message); setLoading(false) } }
  return <main className="mx-auto max-w-5xl px-5 py-8">
    <div className="flex items-start justify-between gap-4"><div><h2 className="text-xl font-bold text-slate-800">⚙️ Owner Extraction Settings</h2><p className="mt-1 text-sm text-slate-500">กฎการดึงข้อมูลทำงานจากฐานข้อมูลในโปรแกรม</p></div><button disabled={loading} onClick={() => load(true)} className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{loading ? 'กำลังโหลด…' : '↻ Refresh Rules'}</button></div>
    {error && <p className="mt-4 rounded-xl bg-rose-50 p-3 text-sm text-rose-700">⚠️ {error}</p>}
    <div className="mt-5 grid gap-3 sm:grid-cols-3"><Stat label="Projects" value={status?.counts?.projects || 0} /><Stat label="Aliases" value={status?.counts?.aliases || 0} /><Stat label="Keywords" value={status?.counts?.keywords || 0} /></div>
    <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600"><p><b>โหลดล่าสุด:</b> {status?.loadedAt ? new Date(status.loadedAt).toLocaleString('th-TH') : 'ยังไม่เคยโหลด'}</p>{status?.lastError && <p className="mt-2 text-rose-600"><b>ข้อผิดพลาดล่าสุด:</b> {status.lastError}</p>}</div>
    <section className="mt-7 rounded-2xl border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-bold text-slate-800">Source Registry & Autopilot</h3><p className="text-xs text-slate-500">กลุ่มที่ค้นพบจะไม่ถูกเก็บข้อมูลจนกว่าจะยืนยันสิทธิ์</p></div><div className="flex gap-2"><button onClick={() => act(() => controlSourceLane('autopilot', sourceState?.autopilot_enabled ? 'stop' : 'start'))} className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-bold text-white">{sourceState?.autopilot_enabled ? 'หยุด Autopilot' : 'เริ่ม Autopilot'}</button><button onClick={() => act(() => controlSourceLane('backfill', sourceState?.backfill_enabled ? 'stop' : 'start'))} className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold">{sourceState?.backfill_enabled ? 'หยุด Backfill' : 'เริ่ม Backfill'}</button></div></div>
      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5"><Stat label="ค้นพบ" value={coverage?.counts?.discovered || 0} /><Stat label="เข้าถึงได้" value={coverage?.counts?.accessible || 0} /><Stat label="อนุญาต" value={coverage?.counts?.authorized || 0} /><Stat label="กำลังเก็บ" value={coverage?.counts?.active || 0} /><Stat label="หยุด/มีปัญหา" value={coverage?.counts?.unavailable || 0} /></div>
      <form className="mt-4 flex gap-2" onSubmit={(event) => { event.preventDefault(); if (!url.trim()) return; act(async () => { await addSourceCandidate({ url: url.trim(), discoveredVia: 'database_ui' }); setUrl('') }) }}><input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="วาง Facebook Group URL" className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" /><button className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-bold text-white">เพิ่มกลุ่ม</button></form>
      <div className="mt-4 max-h-80 overflow-auto rounded-xl border border-slate-200"><table className="w-full text-left text-xs"><thead className="sticky top-0 bg-slate-50 text-slate-500"><tr><th className="p-3">กลุ่ม</th><th className="p-3">สิทธิ์</th><th className="p-3">สถานะ</th><th className="p-3">Value</th><th className="p-3"></th></tr></thead><tbody>{sources.map((source) => <tr key={source.id} className="border-t border-slate-100"><td className="p-3"><a href={source.canonical_url} target="_blank" rel="noreferrer" className="font-semibold text-indigo-600">{source.group_name || source.source_group_id || source.canonical_url}</a></td><td className="p-3">{source.authorization_status}</td><td className="p-3">{source.status}</td><td className="p-3">{Number(source.unique_listing_yield || 0).toFixed(2)}</td><td className="p-3 text-right">{source.authorization_status !== 'AUTHORIZED' ? <button onClick={() => act(() => authorizeSource(source.id))} className="font-bold text-emerald-600">ยืนยันสิทธิ์</button> : <button onClick={() => act(() => setSourceStatus(source.id, source.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE'))} className="font-bold text-slate-600">{source.status === 'ACTIVE' ? 'พัก' : 'เปิด'}</button>}</td></tr>)}</tbody></table></div>
      <p className="mt-3 text-xs text-amber-700">{coverage?.disclaimer}</p>
    </section>
  </main>
}
function Stat({ label, value }) { return <div className="rounded-2xl border border-slate-200 bg-white p-5"><p className="text-xs text-slate-500">{label}</p><p className="mt-1 text-3xl font-bold text-slate-800">{Number(value).toLocaleString('th-TH')}</p></div> }
