import { useEffect, useState } from 'react'

// Realtime countdown to `runAt` (ISO). Ticks every second.
export default function Countdown({ runAt, className = '' }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  const ms = new Date(runAt).getTime() - now
  if (isNaN(ms)) return null

  if (ms <= 0) {
    return (
      <span className={`font-semibold text-emerald-600 ${className}`}>⏰ ถึงเวลาแล้ว</span>
    )
  }

  const total = Math.floor(ms / 1000)
  const d = Math.floor(total / 86400)
  const h = Math.floor((total % 86400) / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n) => String(n).padStart(2, '0')

  return (
    <span className={`font-mono tabular-nums ${className}`}>
      {d > 0 && `${d} วัน `}
      {pad(h)}:{pad(m)}:{pad(s)}
    </span>
  )
}
