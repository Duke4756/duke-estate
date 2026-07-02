function timeAgo(iso) {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 1) return 'เมื่อสักครู่'
  if (mins < 60) return `${mins} นาทีที่แล้ว`
  const h = Math.floor(mins / 60)
  return `${h} ชม.ที่แล้ว`
}

const CATEGORY = {
  renter: {
    label: '🎯 ผู้หาห้องเช่า',
    ring: 'ring-emerald-200',
    badge: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  },
  owner: {
    label: '🏢 เจ้าของ / ปล่อยเช่า',
    ring: 'ring-slate-200',
    badge: 'bg-slate-50 text-slate-500 border-slate-200',
  },
  seller: {
    label: '💰 ขาย / ลงทุน',
    ring: 'ring-slate-200',
    badge: 'bg-slate-50 text-slate-500 border-slate-200',
  },
  other: {
    label: '⚪ อื่นๆ',
    ring: 'ring-slate-200',
    badge: 'bg-slate-50 text-slate-400 border-slate-200',
  },
}

function Field({ icon, label, value }) {
  if (!value) return null
  return (
    <div className="flex items-center gap-1.5 text-xs">
      <span>{icon}</span>
      <span className="text-slate-400">{label}:</span>
      <span className="font-medium text-slate-700">{value}</span>
    </div>
  )
}

export default function LeadCard({ lead }) {
  const cat = CATEGORY[lead.category] || CATEGORY.other
  const isLead = lead.category === 'renter'
  const x = lead.extracted || {}

  // Ensure the link goes to Facebook. Older/edge data may hold a relative
  // href (e.g. "?__cft__=…" or "/stories/…") — resolve it against facebook.com.
  const rawLink = lead.permalink || ''
  const postUrl = /^https?:\/\//i.test(rawLink)
    ? rawLink
    : 'https://www.facebook.com/' + rawLink.replace(/^\/+/, '')

  return (
    <article
      className={`rounded-2xl bg-white border border-slate-200 p-4 ${
        isLead ? `ring-2 ${cat.ring}` : ''
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-slate-200 to-slate-300 grid place-items-center text-sm font-bold text-slate-600 shrink-0">
            {lead.author?.[0]?.toUpperCase() || '?'}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-800 truncate">
              {lead.author}
            </p>
            <p className="text-[11px] text-slate-400">
              {timeAgo(lead.createdAt)}
              {lead.group && (
                <>
                  {' · '}
                  <span
                    title={lead.group}
                    className="text-indigo-400 font-medium"
                  >
                    📁 {lead.group.length > 22 ? lead.group.slice(0, 22) + '…' : lead.group}
                  </span>
                </>
              )}
            </p>
          </div>
        </div>
        <span
          className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${cat.badge}`}
        >
          {cat.label}
        </span>
      </div>

      <p className="mt-3 text-sm text-slate-700 whitespace-pre-line leading-relaxed">
        {lead.text}
      </p>

      {isLead && (x.budget || x.location || x.contact || x.roomType) && (
        <div className="mt-3 rounded-xl bg-emerald-50/60 border border-emerald-100 p-3 grid grid-cols-1 sm:grid-cols-2 gap-y-1.5 gap-x-4">
          <Field icon="📍" label="ทำเล" value={x.location} />
          <Field icon="💵" label="งบ" value={x.budget} />
          <Field icon="🛏️" label="ประเภท" value={x.roomType} />
          <Field icon="📞" label="ติดต่อ" value={x.contact} />
        </div>
      )}

      <div className="mt-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="h-1.5 w-20 rounded-full bg-slate-100 overflow-hidden">
            <div
              className={`h-full ${isLead ? 'bg-emerald-500' : 'bg-slate-300'}`}
              style={{ width: `${Math.round((lead.confidence || 0) * 100)}%` }}
            />
          </div>
          <span className="text-[11px] text-slate-400">
            มั่นใจ {Math.round((lead.confidence || 0) * 100)}%
          </span>
        </div>
        <a
          href={postUrl}
          target="_blank"
          rel="noreferrer"
          className="text-xs font-semibold text-indigo-600 hover:text-indigo-700"
        >
          เปิดโพสต์ →
        </a>
      </div>

      {lead.reason && (
        <p className="mt-2 text-[11px] text-slate-400 italic">
          เหตุผล AI: {lead.reason}
        </p>
      )}
    </article>
  )
}
