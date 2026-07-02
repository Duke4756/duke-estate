import { useEffect, useState } from 'react'
import { getKeywords, saveKeywordsApi } from '../api'

const CATEGORY_META = {
  renter: { emoji: '🔍', label: 'ผู้หาเช่า', sublabel: 'Renter', chipClass: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  owner:  { emoji: '🏠', label: 'เจ้าของ/นายหน้า', sublabel: 'Owner', chipClass: 'bg-amber-100 text-amber-700 border-amber-200' },
  seller: { emoji: '💰', label: 'ผู้ขาย', sublabel: 'Seller', chipClass: 'bg-rose-100 text-rose-700 border-rose-200' },
}

// Mirror of server/keywords.defaults.json — shown immediately on open
// (before the API responds) and used as fallback if API is on old code.
const BUILTIN_DEFAULTS = {
  renter: [
    'หาเช่า', 'อยากเช่า', 'ต้องการเช่า', 'มองหาห้อง', 'หาห้อง',
    'หาคอนโด', 'รับโอนสิทธิ์เช่า', 'หาห้องให้', 'looking for room',
    'looking for condo', 'need room', 'ต้องการห้อง',
    'หาเช่าคอนโด', 'หาเช่าห้อง', 'หาที่เช่า', 'หาที่พัก', 'หาห้องพัก',
    'หาสตูดิโอ', 'หาหอพัก', 'หาหอ', 'อยากได้ห้อง', 'อยากได้คอนโด',
    'อยากได้ที่พัก', 'ใครมีห้องว่าง', 'มีห้องว่างไหม', 'มีห้องเช่าไหม',
    'ใครปล่อยเช่าบ้าง', 'ใครปล่อยห้อง', 'จะเช่า', 'ขอเช่า', 'สนใจเช่า',
    'หาเช่าด่วน', 'หาห้องด่วน', 'ต้องการเช่าด่วน', 'แนะนำคอนโด',
    'แนะนำห้องเช่า', 'แนะนำห้อง', 'เช่าใกล้', 'เช่าแถว', 'เช่าย่าน',
    'เช่าโซน', 'หาห้องใกล้', 'หาคอนโดใกล้', 'หาห้องแถว', 'หาคอนโดแถว',
    'งบเช่า', 'งบไม่เกิน', 'งบประมาณ', 'budget', 'ย้ายเข้า', 'จะย้ายเข้า',
    'อยากย้ายเข้า', 'รับเซ้ง', 'รับเซ้งร้าน',
    'หาซื้อ', 'อยากซื้อ', 'ต้องการซื้อ', 'มองหาซื้อ', 'สนใจซื้อ',
    'จะซื้อ', 'ขอซื้อ', 'หาซื้อคอนโด', 'หาซื้อห้อง', 'หาซื้อบ้าน',
    'หาซื้อด่วน', 'ต้องการซื้อด่วน', 'รับซื้อ', 'รับซื้อคอนโด',
    'รับซื้อห้อง', 'รับซื้อบ้าน', 'รับโอน', 'รับโอนคอนโด', 'รับโอนห้อง',
    'หาดาวน์', 'รับดาวน์', 'อยากมีคอนโด', 'อยากมีบ้าน', 'อยากมีห้อง',
    'กู้ได้', 'กู้ผ่าน', 'วงเงินกู้', 'งบซื้อ', 'หาบ้าน', 'หาทาวน์เฮ้าส์',
    'หาทาวน์โฮม', 'หาบ้านเดี่ยว', 'หาที่ดิน',
    'want to rent', 'looking to rent', 'interested in renting',
    'want to buy', 'looking to buy', 'interested in buying',
    'need apartment', 'looking for apartment', 'need condo',
    'need a place', 'any room available', 'room available?', 'looking for studio',
  ],
  owner: [
    'ปล่อยเช่า', 'ให้เช่าเอง', 'เจ้าของให้เช่า', 'ให้เช่า',
    'ว่างให้เช่า', 'นัดชมห้อง', 'for rent', 'available for rent',
    'rental @', '/per month', '/เดือน', 'arrange viewing', 'accept agents',
    'ปล่อยห้อง', 'ห้องว่าง', 'ห้องว่างให้เช่า', 'เจ้าของโพสต์เอง',
    'เจ้าของปล่อยเอง', 'owner post', 'ห้องพร้อมอยู่', 'พร้อมเข้าอยู่',
    'ready to move in', 'เฟอร์ครบ', 'fully furnished', 'เครื่องใช้ไฟฟ้าครบ',
    'ราคาเช่า', 'ค่าเช่า', 'ค่าเช่ารวม', 'ค่าส่วนกลาง', 'รวมส่วนกลาง',
    'เช่ารายวัน', 'เช่ารายเดือน', 'ห้องสวย', 'วิวสวย', 'วิวแม่น้ำ',
    'วิวเมือง', 'ชั้นสูง', 'high floor', 'river view', 'city view',
    'สัญญา 1 ปี', 'ขั้นต่ำ 1 ปี', 'minimum 1 year',
    'ประกัน 2 เดือน', 'ล่วงหน้า 1 เดือน', 'deposit',
    'สนใจทัก', 'สนใจติดต่อ', 'สนใจ inbox', 'รับนายหน้า', 'accept agent',
    'บาท/เดือน', 'thb/month', 'baht/month', 'sqm', 'ตร.ม.', 'ตรม.',
    '1 bed', '2 bed', '1 bedroom', '2 bedroom', 'studio room', 'ห้อง studio',
    'duplex', 'penthouse',
    '#forrent', '#condoforrent', '#ให้เช่า', '#ปล่อยเช่า', '#คอนโดให้เช่า', '#ห้องให้เช่า',
  ],
  seller: [
    'ขายดาวน์', 'ขายคอนโด', 'ขายห้อง', 'ลงทุน', 'ผลตอบแทน', 'สัมมนา', 'for sale',
    'ขายขาด', 'ขายด่วน', 'ขายถูก', 'ขายต่ำกว่าตลาด', 'ขายใต้ราคา', 'ราคาพิเศษ',
    'ต่ำกว่าราคาประเมิน', 'โอนฟรี', 'ฟรีโอน', 'ฟรีค่าโอน', 'ฟรีค่าใช้จ่ายวันโอน',
    'ผ่อนดาวน์', 'ผ่อนตรง', 'ผ่อนกับโครงการ', 'ผ่อนกับเจ้าของ',
    'เปิดจอง', 'pre-sale', 'presale', 'ราคาเปิดตัว', 'ราคาพรีเซล',
    'บ้านมือสอง', 'คอนโดมือสอง', 'ขายพร้อมผู้เช่า', 'rental yield', 'yield',
    'ราคาขาย', 'ล้านบาท', '#forsale', '#ขายคอนโด', '#ขายดาวน์',
    'เก็งกำไร', 'capital gain', 'passive income',
    'โปรโมชั่น', 'promotion', 'ส่วนลด', 'discount',
    'ขายเท', 'ขายทิ้ง', 'ขายบ้าน', 'ขายที่ดิน', 'ขายทาวน์เฮ้าส์', 'ขายทาวน์โฮม',
    'โครงการใหม่', 'คอนโดใหม่', 'new launch', 'new project', 'ขายต่อ', 'ขายเปลี่ยนมือ',
  ],
}

export default function KeywordsModal({ open, onClose, onSaved }) {
  // Start with built-in defaults so chips show immediately, before API responds
  const [defaults, setDefaults] = useState(BUILTIN_DEFAULTS)
  const [extras, setExtras]     = useState({ renter: [], owner: [], seller: [] })
  const [draft, setDraft]       = useState('')
  const [loading, setLoading]   = useState(false)
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState(null)
  const [activeTab, setActiveTab] = useState('renter')
  const [showDefaults, setShowDefaults] = useState(true)

  useEffect(() => {
    if (!open) return
    setError(null)
    setDraft('')
    setLoading(true)
    getKeywords()
      .then((d) => {
        // Use server-returned defaults if available (may differ when file is edited)
        if (d.defaults && Object.keys(d.defaults).length) setDefaults(d.defaults)
        setExtras(d.extras || { renter: [], owner: [], seller: [] })
      })
      .catch(() => {
        // API on old code — silently keep BUILTIN_DEFAULTS, extras stay empty
      })
      .finally(() => setLoading(false))
  }, [open])

  if (!open) return null

  const cat  = activeTab
  const meta = CATEGORY_META[cat]
  const defList   = defaults[cat] || []
  const extraList = extras[cat]   || []

  function addKeyword() {
    const v = draft.trim().toLowerCase()
    if (!v) return
    if ([...defList, ...extraList].includes(v)) { setError('มีคำนี้อยู่แล้ว'); return }
    setExtras({ ...extras, [cat]: [...extraList, v] })
    setDraft('')
    setError(null)
  }

  function removeExtra(kw) {
    setExtras({ ...extras, [cat]: extraList.filter((k) => k !== kw) })
  }

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      await saveKeywordsApi(extras)
      onSaved()
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-2xl bg-white shadow-xl flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4 shrink-0">
          <div>
            <h2 className="text-base font-bold text-slate-800">🏷️ ตั้งค่า Keyword คัดกรอง</h2>
            <p className="text-xs text-slate-400 mt-0.5">
              ใช้ในโหมด ⚡ Keyword · Defaults มาจาก{' '}
              <code className="bg-slate-100 px-1 rounded text-slate-500">keywords.defaults.json</code>
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none ml-4">
            ✕
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-slate-100 px-5 gap-0 shrink-0">
          {Object.entries(CATEGORY_META).map(([key, m]) => {
            const total = (defaults[key]?.length || 0) + (extras[key]?.length || 0)
            return (
              <button
                key={key}
                onClick={() => { setActiveTab(key); setError(null); setDraft('') }}
                className={`px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px flex items-center gap-1.5 ${
                  activeTab === key
                    ? 'border-indigo-500 text-indigo-700'
                    : 'border-transparent text-slate-400 hover:text-slate-600'
                }`}
              >
                {m.emoji} {m.label}
                <span className={`text-[10px] rounded-full px-1.5 py-0.5 font-semibold ${
                  activeTab === key ? 'bg-indigo-100 text-indigo-600' : 'bg-slate-100 text-slate-500'
                }`}>
                  {total}
                </span>
              </button>
            )
          })}
        </div>

        {/* Body — scrollable */}
        <div className="flex-1 overflow-auto px-5 py-4 space-y-4">
          {/* Default keywords section */}
          <div className="space-y-2">
            <button
              onClick={() => setShowDefaults((v) => !v)}
              className="w-full flex items-center justify-between group"
            >
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                  ค่าเริ่มต้น (Default)
                </span>
                <span className="rounded-full bg-slate-100 text-slate-500 text-[10px] font-bold px-1.5 py-0.5">
                  {defList.length}
                </span>
                {loading && (
                  <span className="text-[10px] text-slate-400 animate-pulse">กำลังโหลด...</span>
                )}
              </div>
              <span className="text-[10px] text-slate-400 group-hover:text-slate-600 transition">
                {showDefaults ? '▲ ซ่อน' : '▼ แสดง'}
              </span>
            </button>

            {showDefaults && (
              <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-3 space-y-2">
                <p className="text-[11px] text-slate-400">
                  มาจาก <code className="bg-white border border-slate-200 rounded px-1 py-0.5">keywords.defaults.json</code>{' '}
                  — แก้ไขได้จากไฟล์โดยตรง ไม่ถูก commit
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {defList.length === 0 ? (
                    <span className="text-xs text-slate-400 italic">ไม่มีค่าเริ่มต้น</span>
                  ) : (
                    defList.map((kw) => (
                      <span
                        key={kw}
                        className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${meta.chipClass}`}
                      >
                        {kw}
                      </span>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          {/* User extras section */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                เพิ่มเติมโดยผู้ใช้
              </span>
              <span className="rounded-full bg-indigo-100 text-indigo-600 text-[10px] font-bold px-1.5 py-0.5">
                {extraList.length}
              </span>
            </div>

            <div className="flex flex-wrap gap-2 min-h-[2.5rem]">
              {extraList.length === 0 ? (
                <p className="text-xs text-slate-400 self-center">ยังไม่มี — เพิ่มด้านล่าง</p>
              ) : (
                extraList.map((kw) => (
                  <span
                    key={kw}
                    className="inline-flex items-center gap-1.5 rounded-full bg-indigo-50 border border-indigo-200 px-3 py-1.5 text-sm text-indigo-700"
                  >
                    {kw}
                    <button
                      onClick={() => removeExtra(kw)}
                      className="text-indigo-300 hover:text-rose-500 font-bold text-xs leading-none"
                    >
                      ✕
                    </button>
                  </span>
                ))
              )}
            </div>

            {/* Add input */}
            <div className="flex gap-2">
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addKeyword()}
                placeholder={`เพิ่ม keyword สำหรับ "${meta.label}"...`}
                className="flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-200"
              />
              <button
                onClick={addKeyword}
                className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 transition"
              >
                + เพิ่ม
              </button>
            </div>
          </div>

          {error && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-2.5 text-xs text-rose-700">
              ⚠️ {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3 shrink-0">
          <span className="text-xs text-slate-400">
            รวม {defList.length + extraList.length} คำ
            <span className="text-slate-300 mx-1">·</span>
            <span className="text-slate-400">{defList.length} default</span>
            {extraList.length > 0 && (
              <span className="text-indigo-500"> + {extraList.length} เพิ่มเติม</span>
            )}
          </span>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="rounded-xl px-4 py-2 text-sm font-medium text-slate-500 hover:text-slate-700"
            >
              ยกเลิก
            </button>
            <button
              onClick={handleSave}
              disabled={saving || loading}
              className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50 transition"
            >
              {saving ? 'กำลังบันทึก...' : 'บันทึก'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
