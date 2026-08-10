import { useEffect, useMemo, useState } from 'react'
import { getStructuredProperties, getTransitStations, startAiPropertyUpdate, getAiPropertyUpdateStatus, refreshSourcesNow, getSourceSchedulerStatus } from '../api'

const EMPTY_FILTERS = { search: '', intent: '', sourceRole: '', bedrooms: '', bathrooms: '', roomType: '', pet: '', system: '', stationId: '', minPrice: '', maxPrice: '', minArea: '', maxArea: '', sort: 'newest' }

export default function OwnerDatabaseView() {
  const [rows, setRows] = useState(/** @type {any[]} */ ([]))
  const [filters, setFilters] = useState(EMPTY_FILTERS)
  const [stations, setStations] = useState(/** @type {any[]} */ ([]))
  const [page, setPage] = useState(1)
  const [meta, setMeta] = useState({ total: 0, pages: 1 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [repair, setRepair] = useState(/** @type {any} */ ({ status: 'idle' }))
  const [sourceUpdate, setSourceUpdate] = useState(/** @type {any} */ ({ status: 'idle', phase: '' }))

  const activeCount = useMemo(() => Object.entries(filters).filter(([key, value]) => key !== 'sort' && value !== '').length, [filters])
  const setFilter = (key, value) => setFilters((current) => ({ ...current, [key]: value }))

  async function load(targetPage = page, targetFilters = filters) {
    setLoading(true); setError('')
    try {
      const data = await getStructuredProperties({ ...targetFilters, page: targetPage, pageSize: 20 })
      setRows(data.posts || []); setPage(data.page || 1); setMeta({ total: data.total || 0, pages: data.pages || 1 })
    } catch (e) { setError(e instanceof Error ? e.message : 'โหลดฐานข้อมูลไม่สำเร็จ') }
    finally { setLoading(false) }
  }
  useEffect(() => { getTransitStations({ system: filters.system }).then((data) => setStations(data.stations || [])).catch(() => setStations([])) }, [filters.system])
  useEffect(() => { const timer = setTimeout(() => { setPage(1); load(1, filters) }, 320); return () => clearTimeout(timer) }, [filters])
  useEffect(() => {
    if (repair.status !== 'running') return undefined
    const timer = setInterval(async () => {
      try { const next = await getAiPropertyUpdateStatus(); setRepair(next); if (next.status === 'completed') load(1, filters) } catch { /* keep last progress */ }
    }, 1200)
    return () => clearInterval(timer)
  }, [repair.status])
  useEffect(() => {
    if (sourceUpdate.status !== 'running') return undefined
    let startingRepair = false
    const timer = setInterval(async () => {
      try {
        const status = await getSourceSchedulerStatus()
        const active = (status.jobs || []).filter((item) => ['PENDING','RUNNING','RETRY'].includes(item.status)).reduce((sum, item) => sum + Number(item.count || 0), 0)
        setSourceUpdate((current) => ({ ...current, activeJobs: active, phase: active ? `กำลังดึงโพสต์ใหม่ · เหลือ ${active} งาน` : 'กำลังตรวจและซ่อมข้อมูล' }))
        if (!active && !startingRepair) {
          startingRepair = true; clearInterval(timer)
          const nextRepair = await startAiPropertyUpdate()
          setRepair(nextRepair); setSourceUpdate({ status: 'completed', phase: 'ดึงโพสต์ใหม่เสร็จแล้ว' }); await load(1, filters)
        }
      } catch (e) { clearInterval(timer); setSourceUpdate({ status: 'failed', phase: '', error: e instanceof Error ? e.message : 'อัปเดตไม่สำเร็จ' }) }
    }, 1500)
    return () => clearInterval(timer)
  }, [sourceUpdate.status])

  function clearFilters() { setFilters(EMPTY_FILTERS); setShowAdvanced(false) }
  async function updateOwnerDatabase() {
    try {
      setError(''); setSourceUpdate({ status: 'running', phase: 'กำลังเตรียมดึงโพสต์ใหม่', activeJobs: 0 })
      await refreshSourcesNow()
    } catch (e) { setSourceUpdate({ status: 'failed', phase: '', error: e instanceof Error ? e.message : 'เริ่มอัปเดตไม่สำเร็จ' }) }
  }

  return <main className="min-h-screen bg-slate-50 pb-16 text-slate-900">
    <div className="mx-auto max-w-[1680px] px-5 py-6 lg:px-7">
      <header className="mb-4 flex flex-wrap items-end justify-between gap-4">
        <div><div className="mb-2 flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-violet-600" /><span className="text-xs font-bold text-violet-700">Duke Estate</span></div><h1 className="text-2xl font-bold tracking-tight text-slate-900">ฐานข้อมูลทรัพย์</h1><p className="mt-1 text-sm text-slate-500">ค้นหาและคัดกรองข้อมูลจากโพสต์ทั้งหมดในระบบ</p></div>
        <div className="flex items-center gap-4"><button disabled={sourceUpdate.status === 'running' || repair.status === 'running'} onClick={updateOwnerDatabase} className="rounded-xl bg-violet-600 px-4 py-2.5 text-xs font-semibold text-white shadow-sm hover:bg-violet-700 disabled:cursor-wait disabled:opacity-60">{sourceUpdate.status === 'running' ? sourceUpdate.phase : repair.status === 'running' ? 'กำลังซ่อมข้อมูล...' : '↻ อัปเดตฐานเจ้าของ'}</button><div className="text-right"><p className="text-2xl font-bold tabular-nums text-slate-900">{meta.total.toLocaleString('th-TH')}</p><p className="text-xs text-slate-400">รายการที่พบ</p></div></div>
      </header>

      {sourceUpdate.status !== 'idle' && <div className={`mb-4 rounded-xl border px-4 py-3 text-xs ${sourceUpdate.status === 'failed' ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-sky-100 bg-sky-50 text-sky-800'}`}><strong>{sourceUpdate.phase || 'อัปเดตฐานเจ้าของ'}</strong>{sourceUpdate.error && <p className="mt-1">{sourceUpdate.error}</p>}</div>}
      {repair.status !== 'idle' && <div className={`mb-4 rounded-xl border px-4 py-3 text-xs ${repair.status === 'failed' ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-violet-100 bg-violet-50 text-violet-800'}`}><div className="flex flex-wrap items-center justify-between gap-2"><strong>{repair.phase}</strong><span>{repair.processed || 0}/{repair.found || 0} รายการ</span></div>{repair.status !== 'failed' && <p className="mt-1 text-violet-600">ชื่อโครงการ {repair.projectsMatched || 0} · สถานี {repair.stationsMatched || 0} · แก้ไข {repair.fieldsUpdated || 0} fields · ยังไม่แน่ใจ {repair.uncertain || 0}</p>}{repair.error && <p className="mt-1">{repair.error}</p>}</div>}

      <div className="mb-4 flex h-11 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm focus-within:border-violet-400 focus-within:ring-4 focus-within:ring-violet-100">
        <span className="grid w-11 place-items-center text-base text-slate-400">⌕</span><input value={filters.search} onChange={(e) => setFilter('search', e.target.value)} placeholder="ค้นหาชื่อโครงการ ทำเล สถานี หรือเบอร์โทร..." className="min-w-0 flex-1 bg-transparent pr-4 text-sm outline-none placeholder:text-slate-400" />
        {filters.search && <button onClick={() => setFilter('search', '')} className="px-4 text-xs font-semibold text-slate-400 hover:text-slate-700">ล้าง</button>}
      </div>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="grid gap-px bg-slate-200 sm:grid-cols-2 xl:grid-cols-4">
          <FilterSelect label="ห้องนอน" value={filters.bedrooms} onChange={(v) => setFilter('bedrooms', v)} options={[["","ทั้งหมด"],["0","สตูดิโอ"],["1","1 ห้องนอน"],["2","2 ห้องนอน"],["3","3 ห้องนอน"],["4","4 ห้องนอน"]]} />
          <FilterSelect label="รูปแบบห้อง" value={filters.roomType} onChange={(v) => setFilter('roomType', v)} options={[["","ทั้งหมด"],["duplex","Duplex"],["penthouse","Penthouse"],["loft","Loft"],["studio","Studio"],["double_volume","Double Volume"]]} />
          <FilterSelect label="สัตว์เลี้ยง" value={filters.pet} onChange={(v) => setFilter('pet', v)} options={[["","ทั้งหมด"],["allowed","เลี้ยงได้"],["not_allowed","ไม่อนุญาต"]]} />
          <FilterSelect label="ระบบรถไฟฟ้า" value={filters.system} onChange={(v) => setFilters((f) => ({ ...f, system: v, stationId: '' }))} options={[["","ทุกระบบ"],["BTS","BTS"],["MRT","MRT"],["ARL","Airport Rail Link"]]} />
          <FilterSelect label="ประเภทรายการ" value={filters.intent} onChange={(v) => setFilter('intent', v)} options={[["","เช่าและขาย"],["rent","ให้เช่า"],["sale","ขาย"],["rent_and_sale","เช่าหรือขาย"]]} />
          <FilterSelect label="ผู้ลงประกาศ" value={filters.sourceRole} onChange={(v) => setFilter('sourceRole', v)} options={[["","ทั้งหมด"],["owner","เจ้าของ"],["agent","เอเจนต์"],["co_agent","Co-Agent"]]} />
          <FilterSelect label="เรียงลำดับ" value={filters.sort} onChange={(v) => setFilter('sort', v)} options={[["newest","ล่าสุด"],["price_asc","ราคาต่ำ → สูง"],["price_desc","ราคาสูง → ต่ำ"],["area_desc","พื้นที่มาก → น้อย"]]} />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-4 py-3">
          <button onClick={() => setShowAdvanced((v) => !v)} className="text-xs font-semibold text-slate-600 hover:text-violet-700">{showAdvanced ? 'ซ่อนตัวกรองเพิ่มเติม' : 'ตัวกรองเพิ่มเติม'}</button>
          <div className="flex items-center gap-3"><span className="text-xs text-slate-400">ใช้ตัวกรอง {activeCount} รายการ</span>{activeCount > 0 && <button onClick={clearFilters} className="text-xs font-semibold text-violet-700 hover:text-violet-900">ล้างทั้งหมด</button>}</div>
        </div>
        {showAdvanced && <div className="grid gap-3 border-t border-slate-200 bg-slate-50 p-4 sm:grid-cols-2 xl:grid-cols-4">
          <CompactSelect label="สถานี" value={filters.stationId} onChange={(v) => setFilter('stationId', v)}><option value="">ทุกสถานี</option>{stations.map((station) => <option key={station.id} value={station.id}>{station.systemCode} {station.canonicalNameTh}</option>)}</CompactSelect>
          <NumberFilter label="ราคาต่ำสุด" value={filters.minPrice} onChange={(v) => setFilter('minPrice', v)} suffix="บาท" />
          <NumberFilter label="ราคาสูงสุด" value={filters.maxPrice} onChange={(v) => setFilter('maxPrice', v)} suffix="บาท" />
          <NumberFilter label="พื้นที่ต่ำสุด" value={filters.minArea} onChange={(v) => setFilter('minArea', v)} suffix="ตร.ม." />
          <NumberFilter label="พื้นที่สูงสุด" value={filters.maxArea} onChange={(v) => setFilter('maxArea', v)} suffix="ตร.ม." />
          <CompactSelect label="ห้องน้ำ" value={filters.bathrooms} onChange={(v) => setFilter('bathrooms', v)}><option value="">ทั้งหมด</option>{[1,2,3,4,5].map((n) => <option key={n} value={n}>{n} ห้องน้ำ</option>)}</CompactSelect>
        </div>}
      </section>

      {error && <div className="mt-4 border-l-4 border-red-600 bg-red-50 p-4 text-sm font-semibold text-red-800">{error}</div>}

      <section className="mt-5 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto"><table className="w-full min-w-[1260px] table-fixed text-left text-xs"><colgroup><col className="w-[23%]" /><col className="w-[11%]" /><col className="w-[9%]" /><col className="w-[8%]" /><col className="w-[9%]" /><col className="w-[8%]" /><col className="w-[12%]" /><col className="w-[9%]" /><col className="w-[9%]" /><col className="w-[7%]" /></colgroup><thead className="border-b border-slate-300 bg-[#eef1f4] text-[10px] font-bold text-slate-500"><tr>{['ทรัพย์','ราคา','ห้อง','รูปแบบ','สัตว์เลี้ยง','พื้นที่','สถานีอ้างอิง','ผู้ลงประกาศ','ติดต่อ',''].map((h) => <th key={h} className="px-3 py-3">{h}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{loading ? <State text="กำลังค้นหาทรัพย์..." /> : rows.length === 0 ? <State text="ไม่พบทรัพย์ที่ตรงกับเงื่อนไข ลองลดตัวกรองบางรายการ" /> : rows.map((row) => <PropertyRow key={row.id} row={row} />)}</tbody></table></div>
      </section>

      {meta.pages > 1 && <div className="mt-5 flex items-center justify-between border-t border-slate-300 pt-4"><p className="text-xs font-bold uppercase tracking-wider text-slate-400">Page {page} / {meta.pages}</p><div className="flex gap-2"><PageButton disabled={page <= 1 || loading} onClick={() => load(page - 1)}>← ก่อนหน้า</PageButton><PageButton disabled={page >= meta.pages || loading} onClick={() => load(page + 1)}>ถัดไป →</PageButton></div></div>}

    </div>
  </main>
}

function FilterSelect({ label, value, onChange, options }) { return <label className="flex h-16 flex-col justify-center bg-white px-4"><span className="block text-[10px] font-semibold text-slate-400">{label}</span><select value={value} onChange={(e) => onChange(e.target.value)} className="mt-1 w-full cursor-pointer bg-transparent text-sm font-semibold text-slate-800 outline-none">{options.map(([v, text]) => <option key={v} value={v}>{text}</option>)}</select></label> }
function CompactSelect({ label, value, onChange, children }) { return <label className="block"><span className="text-[10px] font-semibold text-slate-500">{label}</span><select value={value} onChange={(e) => onChange(e.target.value)} className="mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm outline-none focus:border-violet-400">{children}</select></label> }
function NumberFilter({ label, value, onChange, suffix }) { return <label className="block"><span className="text-[10px] font-semibold text-slate-500">{label}</span><div className="mt-1 flex h-10 rounded-lg border border-slate-300 bg-white focus-within:border-violet-400"><input type="number" min="0" value={value} onChange={(e) => onChange(e.target.value)} className="min-w-0 flex-1 rounded-lg px-3 text-sm outline-none" /><span className="grid place-items-center px-2 text-[10px] text-slate-400">{suffix}</span></div></label> }
function PropertyRow({ row }) { const name = row.project_name_canonical || row.project_name_raw || 'ไม่ระบุชื่อโครงการ'; return <tr className="h-[52px] group hover:bg-slate-50"><td className="px-3 py-2.5"><p className="truncate font-bold text-slate-900" title={name}>{name}</p><p className="mt-0.5 truncate text-[10px] text-slate-400">{row.group || row.zone || row.district || 'แหล่งข้อมูล Facebook'}</p></td><Cell strong>{formatPrice(row)}</Cell><Cell>{bedroomLabel(row.bedrooms, row.bathrooms)}</Cell><Cell><Tag>{roomTypeLabel(row.room_type)}</Tag></Cell><Cell><PetBadge value={row.pet_policy} /></Cell><Cell>{row.area_sqm ? `${Number(row.area_sqm).toLocaleString('th-TH')} ตร.ม.` : '—'}</Cell><Cell>{primaryTransitLabel(row.transitStations)}</Cell><Cell><RoleBadge value={row.source_role} /></Cell><Cell>{row.contact_phone || row.contact_name || '—'}</Cell><td className="px-3 py-2.5 text-right">{row.permalink ? <a href={row.permalink} target="_blank" rel="noreferrer" className="inline-flex rounded-md border border-slate-300 px-2.5 py-1.5 text-[10px] font-semibold text-slate-600 transition hover:border-violet-400 hover:text-violet-700">เปิด ↗</a> : '—'}</td></tr> }
function Cell({ children, strong = false }) { return <td className={`truncate whitespace-nowrap px-3 py-2.5 ${strong ? 'font-bold text-slate-900' : 'text-slate-600'}`}>{children || '—'}</td> }
function State({ text }) { return <tr><td colSpan={10} className="p-20 text-center text-sm font-semibold text-slate-400">{text}</td></tr> }
function PageButton(props) { return <button {...props} className="border border-slate-900 px-5 py-2.5 text-xs font-black disabled:cursor-not-allowed disabled:opacity-30 hover:not-disabled:bg-black hover:not-disabled:text-white" /> }
function Tag({ children }) { return children === '—' ? '—' : <span className="border border-slate-300 bg-slate-50 px-2 py-1 text-[10px] font-black uppercase tracking-wider">{children}</span> }
function PetBadge({ value }) { if (value === 'allowed') return <span className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-700"><i className="h-1.5 w-1.5 rounded-full bg-emerald-500" />เลี้ยงได้</span>; if (value === 'not_allowed') return <span className="text-xs font-bold text-rose-700">ไม่อนุญาต</span>; return <span className="text-slate-300">—</span> }
function RoleBadge({ value }) { if (value === 'owner') return <span className="rounded-md bg-violet-50 px-2 py-1 text-[10px] font-semibold text-violet-700">เจ้าของ</span>; if (value === 'agent') return <span className="rounded-md bg-sky-50 px-2 py-1 text-[10px] font-semibold text-sky-700">เอเจนต์</span>; if (value === 'co_agent') return <span className="rounded-md bg-amber-50 px-2 py-1 text-[10px] font-semibold text-amber-700">Co-Agent</span>; return <span className="text-slate-300">—</span> }
function formatPrice(row) { const value = row.rent_price_monthly || row.sale_price; if (!value) return '—'; return `${Number(value).toLocaleString('th-TH')} ${row.rent_price_monthly ? '/เดือน' : 'บาท'}` }
function bedroomLabel(bedrooms, bathrooms) { const bed = bedrooms === 0 ? 'Studio' : bedrooms != null ? `${bedrooms} นอน` : '—'; return bathrooms != null ? `${bed} · ${bathrooms} น้ำ` : bed }
function roomTypeLabel(value) { return ({ duplex: 'Duplex', penthouse: 'Penthouse', loft: 'Loft', studio: 'Studio', double_volume: 'Double Volume' })[value] || '—' }
function primaryTransitLabel(items = []) { const station = items.find((item) => item.status === 'matched' && item.isPrimary) || items.find((item) => item.status === 'matched'); return station?.canonicalNameTh ? `${station.systemCode} ${station.canonicalNameTh}` : '—' }
