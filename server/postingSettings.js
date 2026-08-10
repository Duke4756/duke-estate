import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FILE = path.join(__dirname, 'autopost', 'posting-settings.json')
const DEFAULTS = {
  enabled: true,
  startTime: '08:00',
  endTime: '22:00',
  timezone: 'Asia/Bangkok',
}

function validTime(value) {
  return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value)
}

export function getPostingSettings() {
  try {
    const saved = JSON.parse(fs.readFileSync(FILE, 'utf8'))
    return {
      ...DEFAULTS,
      ...saved,
      timezone: DEFAULTS.timezone,
    }
  } catch {
    return { ...DEFAULTS }
  }
}

export function savePostingSettings(input = {}) {
  if (!validTime(input.startTime) || !validTime(input.endTime)) {
    throw new Error('เวลาเริ่มและเวลาสิ้นสุดต้องอยู่ในรูปแบบ HH:mm')
  }
  if (input.startTime === input.endTime) {
    throw new Error('เวลาเริ่มและเวลาสิ้นสุดต้องไม่เท่ากัน')
  }
  const settings = {
    enabled: input.enabled !== false,
    startTime: input.startTime,
    endTime: input.endTime,
    timezone: DEFAULTS.timezone,
    updatedAt: new Date().toISOString(),
  }
  fs.mkdirSync(path.dirname(FILE), { recursive: true })
  fs.writeFileSync(FILE, JSON.stringify(settings, null, 2))
  return settings
}

function bangkokParts(date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: DEFAULTS.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
  return Object.fromEntries(parts.map(({ type, value }) => [type, value]))
}

function minutesOf(time) {
  const [hour, minute] = time.split(':').map(Number)
  return hour * 60 + minute
}

export function isWithinPostingWindow(date = new Date(), settings = getPostingSettings()) {
  if (!settings.enabled) return false
  const parts = bangkokParts(date)
  const now = Number(parts.hour) * 60 + Number(parts.minute)
  const start = minutesOf(settings.startTime)
  const end = minutesOf(settings.endTime)
  return start < end ? now >= start && now < end : now >= start || now < end
}

export function nextPostingWindowStart(date = new Date(), settings = getPostingSettings()) {
  const parts = bangkokParts(date)
  const currentMinutes = Number(parts.hour) * 60 + Number(parts.minute)
  const startMinutes = minutesOf(settings.startTime)
  const endMinutes = minutesOf(settings.endTime)
  const inside = settings.enabled && (startMinutes < endMinutes
    ? currentMinutes >= startMinutes && currentMinutes < endMinutes
    : currentMinutes >= startMinutes || currentMinutes < endMinutes)
  if (inside) return new Date(date)

  const bangkokMidnightUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    0, 0, 0, 0,
  ) - 7 * 60 * 60 * 1000
  let dayOffset = 0
  if (startMinutes < endMinutes) {
    if (currentMinutes >= endMinutes) dayOffset = 1
  } else if (currentMinutes >= endMinutes && currentMinutes < startMinutes) {
    dayOffset = 0
  }
  return new Date(bangkokMidnightUtc + dayOffset * 86_400_000 + startMinutes * 60_000)
}

