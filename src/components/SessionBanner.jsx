// Persistent warning shown when there's no Facebook session (not logged in).
// Anything that connects to Playwright + Facebook (scraping, auto-posting) won't
// work with real data until the user runs `npm run login`.
export default function SessionBanner({ onRecheck, checking }) {
  return (
    <div className="bg-amber-50 border-b border-amber-200">
      <div className="max-w-6xl mx-auto px-5 py-2.5 flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm text-amber-800">
          ⚠️ <b>ยังไม่ได้เข้าสู่ระบบ Facebook</b> — การดึงโพสต์และโพสต์อัตโนมัติจะยังใช้ข้อมูลจริงไม่ได้
          <span className="hidden sm:inline text-amber-700">
            {' '}· รันคำสั่ง <code className="rounded bg-amber-100 px-1.5 py-0.5 font-mono text-xs">npm run login</code> ในโฟลเดอร์โปรเจกต์ก่อน
          </span>
        </p>
        <button
          onClick={onRecheck}
          disabled={checking}
          className="shrink-0 rounded-lg bg-amber-200/70 px-3 py-1 text-xs font-semibold text-amber-800 hover:bg-amber-200 disabled:opacity-50"
        >
          {checking ? 'กำลังตรวจ...' : '↻ ตรวจสอบอีกครั้ง'}
        </button>
      </div>
    </div>
  )
}
