import fs from 'node:fs'
import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import { mockPosts } from '../src/data/mockPosts.js'
import { scrapeGroups, hasSession } from './scraper.js'
import { loadGroups, loadGroupsFull, saveGroups, groupLabel } from './groups.js'
import { loadKeywords, saveKeywords, getDefaults as getDefaultKeywords, loadExtras } from './keywords.js'
import { saveRound, listRounds, getRound, deleteRound, roundFilePath } from './history.js'
import { listSets, createSet, updateSet, deleteSet, IMAGES_DIR } from './postsets.js'
import { listSchedules, createSchedule, updateSchedule, deleteSchedule } from './schedules.js'
import { canPost, runSchedule, isPosting } from './poster.js'

dotenv.config()

const app = express()
app.use(cors())
app.use(express.json({ limit: '50mb' })) // large limit — post-set images arrive as base64
app.use('/api/postsets/images', express.static(IMAGES_DIR))

const PORT = process.env.PORT || 8787
const GEMINI_KEY = process.env.GEMINI_API_KEY
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash'

// ---------------------------------------------------------------------------
// 1) FETCH POSTS  — scrapes recent posts from each Facebook group locally
//    with Playwright (see server/scraper.js). Falls back to bundled demo
//    posts until you've run `npm run login` to create a session.
// ---------------------------------------------------------------------------
// Scraping takes a few minutes, so cache the result. Toggling keyword/AI mode
// then re-classifies the SAME posts instantly instead of re-scraping. The TTL
// must be comfortably longer than a scrape, or the cache expires before it's
// useful. Pass fresh=true (the "ดึงโพสต์ล่าสุด" button) to force a rescrape.
const SCRAPE_TTL_MS = 15 * 60 * 1000
let scrapeCache = { at: 0, minutes: 0, posts: null }
let inFlight = null // { minutes, promise } — dedupes concurrent scrapes

// onProgress({ percent, message }) reports scrape progress (0–80% of the whole
// job; classification takes the remaining 80–100%). onPosts(posts) fires with
// batches of newly-found posts (fresh scrapes only) so callers can stream
// results as they arrive.
async function fetchPosts(minutes, { fresh = false, onProgress = () => {}, onPosts = () => {}, signal } = {}) {
  if (!hasSession()) {
    return { source: 'demo', posts: mockPosts, cached: false }
  }
  const fresh_enough =
    !fresh &&
    scrapeCache.posts &&
    scrapeCache.minutes === minutes &&
    Date.now() - scrapeCache.at < SCRAPE_TTL_MS
  if (fresh_enough) {
    onProgress({ percent: 80, message: '⚡ ใช้ข้อมูลที่ดึงไว้ล่าสุด (cache)' })
    return { source: 'live', posts: scrapeCache.posts, cached: true }
  }
  // If a scrape for this window is already running (e.g. StrictMode double
  // fetch, or two browser tabs), reuse it instead of launching another.
  if (!fresh && inFlight && inFlight.minutes === minutes) {
    onProgress({ percent: 40, message: '⏳ รอผลการดึงที่กำลังทำอยู่...' })
    return { source: 'live', posts: await inFlight.promise, cached: true }
  }
  const promise = scrapeGroups(
    loadGroups(),
    minutes,
    (p) => onProgress({ percent: Math.round(p.percent * 0.8), message: p.message }),
    onPosts,
    signal,
  )
  inFlight = { minutes, promise }
  try {
    const posts = await promise
    scrapeCache = { at: Date.now(), minutes, posts }
    return { source: 'live', posts, cached: false }
  } finally {
    if (inFlight && inFlight.promise === promise) inFlight = null
  }
}

// ---------------------------------------------------------------------------
// 2) CLASSIFY  — sends posts to Gemini and gets back category + extracted info.
//    One batched call (with a strict JSON schema) keeps it fast and cheap.
// ---------------------------------------------------------------------------

// Gemini structured-output schema (OpenAPI subset: UPPERCASE types, nullable).
const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    results: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          id: { type: 'STRING', description: 'The post id, copied exactly.' },
          category: {
            type: 'STRING',
            enum: ['renter', 'owner', 'seller', 'other'],
            description:
              'renter = person LOOKING FOR a room to rent. owner = landlord/agent offering a room. seller = selling/investing. other = unrelated.',
          },
          confidence: { type: 'NUMBER', description: '0..1 confidence.' },
          reason: { type: 'STRING', description: 'Short reason in Thai.' },
          extracted: {
            type: 'OBJECT',
            properties: {
              location: { type: 'STRING', nullable: true },
              budget: { type: 'STRING', nullable: true },
              roomType: { type: 'STRING', nullable: true },
              contact: { type: 'STRING', nullable: true },
            },
            required: ['location', 'budget', 'roomType', 'contact'],
          },
        },
        required: ['id', 'category', 'confidence', 'reason', 'extracted'],
      },
    },
  },
  required: ['results'],
}

const SYSTEM_PROMPT = `คุณเป็นผู้ช่วยคัดกรองลีดอสังหาริมทรัพย์ในกลุ่ม Facebook เกี่ยวกับคอนโด
เป้าหมายเดียวคือหา "ผู้ที่กำลังมองหาห้องเช่า" (renter = ฝั่งดีมานด์ คนที่อยากได้ห้อง)
ต้องแยกออกจาก "ฝั่งซัพพลาย" (เจ้าของ/เอเจนต์/คนขาย) ให้เด็ดขาด

นิยามหมวดหมู่:
- renter = คน "กำลังมองหา/อยากเช่า/ต้องการเช่า" ห้องสำหรับตัวเองหรือคนรู้จัก
    สัญญาณ: "หาคอนโดเช่า", "อยากเช่าห้อง", "ต้องการเช่า", "รับโอนสิทธิ์เช่า", "หาห้องให้น้อง",
            มักบอก "งบ/งบประมาณ ไม่เกิน X", โซนที่อยากได้, วันที่อยากเข้าอยู่ — แต่ "ไม่มี" ห้องมาเสนอ
- owner = เจ้าของ/เอเจนต์/นายหน้า ที่ "เสนอห้องให้เช่า" (ฝั่งซัพพลาย)
    สัญญาณ (ถ้าพบอย่างใดอย่างหนึ่ง = owner เสมอ แม้จะมีคำว่า "หา" ปนอยู่):
      • "ปล่อยเช่า", "ให้เช่า", "ให้เช่าเอง", "เจ้าของให้เช่า", "For Rent", "Available for rent", "ว่างให้เช่า"
      • บอกราคาค่าเช่าของห้องที่มี เช่น "35,000THB/Per Month", "เช่า 16,000/เดือน", "Rental @ ..."
      • บรรยายสเปกห้องที่มีอยู่: ชั้น (Floor), ขนาด (sqm/ตร.ม.), "1 Bedroom", "เฟอร์ครบ", "วิว"
      • "นัดชมห้อง", "Contact us to arrange a viewing", "Accept Agents", แฮชแท็กแนว #forrent #condorental
- seller = ประกาศ "ขาย" ห้อง / ขายดาวน์ / ชวนลงทุน / สัมมนา
- other = ไม่เกี่ยว เช่น โฆษณาอื่น ข่าว พูดคุยทั่วไป

กฎสำคัญ: ถ้าโพสต์กำลัง "เสนอ/โฆษณาห้อง" ให้คนอื่นมาเช่า = owner เท่านั้น ห้ามจัดเป็น renter
จัดเป็น renter เฉพาะเมื่อผู้โพสต์เป็น "ฝั่งที่ต้องการได้ห้อง" จริงๆ เท่านั้น

สำหรับ renter ให้ดึง: ทำเล/โซน, งบประมาณ, ประเภทห้อง, ช่องทางติดต่อ (เบอร์/line) เท่าที่มีในโพสต์
ถ้าไม่มีข้อมูลให้ใส่ null และให้ reason เป็นภาษาไทยสั้นๆ บอกว่าทำไมจัดหมวดนี้`

// One Gemini call for a batch of posts. Returns the results array or throws.
async function callGemini(batch) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [
        {
          role: 'user',
          parts: [
            {
              text:
                'จัดหมวดหมู่โพสต์ต่อไปนี้:\n\n' +
                JSON.stringify(
                  batch.map((p) => ({ id: p.id, text: p.text, author: p.author })),
                  null,
                  2,
                ),
            },
          ],
        },
      ],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: RESPONSE_SCHEMA,
        temperature: 0,
        maxOutputTokens: 8192,
      },
    }),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Gemini ${res.status}: ${body.slice(0, 200)}`)
  }
  const data = await res.json()
  const raw = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}'
  return JSON.parse(raw).results || []
}

// mode: 'keyword' = rules only (fast, no AI). 'ai' = Gemini in parallel
// batches (one big call is slow and truncates). Returns { leads, classifier }.
const AI_BATCH = 15
async function classifyPosts(posts, mode = 'ai', onProgress = () => {}) {
  if (mode === 'keyword' || !GEMINI_KEY || posts.length === 0) {
    onProgress({ percent: 95, message: `⚡ คัดกรอง ${posts.length} โพสต์ด้วย Keyword...` })
    return { leads: posts.map((p) => keywordFallback(p)), classifier: 'keyword' }
  }

  // Split into small batches and classify them concurrently.
  const batches = []
  for (let i = 0; i < posts.length; i += AI_BATCH) batches.push(posts.slice(i, i + AI_BATCH))
  onProgress({ percent: 82, message: `🤖 คัดกรอง ${posts.length} โพสต์ด้วย Gemini (${batches.length} ชุด)...` })

  let failed = 0
  let done = 0
  const settled = await Promise.all(
    batches.map((b) =>
      callGemini(b)
        .then((r) => {
          done++
          onProgress({
            percent: 82 + Math.round((done / batches.length) * 17),
            message: `🤖 คัดกรอง AI... (${done}/${batches.length} ชุด)`,
          })
          return r
        })
        .catch((err) => {
          console.warn('⚠️  Gemini batch failed, keyword fallback for it:', err.message)
          failed++
          done++
          return null // signal fallback for this batch
        }),
    ),
  )

  const byId = new Map()
  settled.flat().forEach((r) => {
    if (r && r.id) byId.set(r.id, r)
  })

  const leads = posts.map((p) => {
    const r = byId.get(p.id)
    return r ? { ...p, ...r } : keywordFallback(p)
  })
  const classifier =
    failed === batches.length ? 'keyword (AI ล้มเหลว)' : failed > 0 ? 'ai (บางส่วน keyword)' : 'ai'
  return { leads, classifier }
}

// Lightweight rule-based fallback (used when no GEMINI_API_KEY is set).
// Uses the user-customisable keyword list from server/keywords.json.
function keywordFallback(p) {
  const t = (p.text || '').toLowerCase()
  const kw = loadKeywords()

  const matchesAny = (list) => list.some((k) => t.includes(k.toLowerCase()))

  // Priority: a listing (owner) outranks the word "หา"; sellers next;
  // only then treat a "looking for" post as a renter lead.
  const offersRent = matchesAny(kw.owner)
  const sells = matchesAny(kw.seller)
  const wantsRent = matchesAny(kw.renter)

  let category = 'other'
  if (offersRent) category = 'owner'
  else if (sells) category = 'seller'
  else if (wantsRent) category = 'renter'

  const budget = (p.text.match(/(\d[\d,\.]{2,})\s*(บาท|\/เดือน|บ\.|k)?/i) || [])[0] || null
  const contact =
    (p.text.match(/0\d[\d\-\s]{7,}/) || [])[0] ||
    (p.text.match(/line[:\s]*\S+/i) || [])[0] ||
    null

  return {
    ...p,
    category,
    confidence: category === 'other' ? 0.4 : 0.6,
    reason: 'ประเมินจากคำสำคัญ',
    extracted: { location: null, budget, roomType: null, contact },
  }
}

// ---------------------------------------------------------------------------
// 3) API ROUTE
// ---------------------------------------------------------------------------
app.get('/api/leads', async (req, res) => {
  const minutes = Math.min(parseInt(req.query.minutes, 10) || 60, 24 * 60)
  const mode = req.query.mode === 'keyword' ? 'keyword' : 'ai'
  const fresh = req.query.fresh === '1'
  try {
    const { source, posts, cached } = await fetchPosts(minutes, { fresh })
    const { leads, classifier } = await classifyPosts(posts, mode)
    res.json({ source, mode, classifier, cached, count: leads.length, minutes, leads })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: err.message })
  }
})

// Same as /api/leads but streams live progress via Server-Sent Events.
// Emits: `progress` {percent, message}, then `done` {…leads} or `fail` {error}.
app.get('/api/leads/stream', async (req, res) => {
  const minutes = Math.min(parseInt(req.query.minutes, 10) || 60, 24 * 60)
  const mode = req.query.mode === 'keyword' ? 'keyword' : 'ai'
  const fresh = req.query.fresh === '1'

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no') // disable proxy buffering
  res.flushHeaders?.()

  // Abort signal: fires when the client disconnects (e.g. user clicks Stop).
  const ac = new AbortController()
  const { signal } = ac
  res.on('close', () => ac.abort())

  const send = (event, data) => {
    if (signal.aborted) return
    res.write(`event: ${event}\n`)
    res.write(`data: ${JSON.stringify(data)}\n\n`)
  }
  const onProgress = (evt) => send('progress', evt)

  try {
    send('progress', { percent: 0, message: '⏳ เริ่มต้น...' })

    let total = 0
    let lastClassifier = mode === 'keyword' ? 'keyword' : 'ai'
    const allLeads = [] // accumulate for saving this round to history
    // Classify each batch of freshly-scraped posts and stream it so cards show
    // up gradually instead of only at the very end.
    const onPosts = async (batch) => {
      if (!batch.length || signal.aborted) return
      const { leads, classifier } = await classifyPosts(batch, mode)
      lastClassifier = classifier
      total += leads.length
      allLeads.push(...leads)
      send('leads', { leads, classifier })
    }

    const { source, posts, cached } = await fetchPosts(minutes, { fresh, onProgress, onPosts, signal })

    if (signal.aborted) return // client disconnected — stop work

    // Cached / demo paths don't fire onGroup — classify and send once here.
    if (cached || source === 'demo') {
      const { leads, classifier } = await classifyPosts(posts, mode, onProgress)
      lastClassifier = classifier
      total = leads.length
      allLeads.push(...leads)
      send('leads', { leads, classifier })
    }

    // Save a fresh live search as an Excel round in history (not cached re-views).
    if (!cached && source === 'live' && allLeads.length) {
      try {
        await saveRound(allLeads, {
          minutes,
          mode,
          classifier: lastClassifier,
          groups: loadGroups().map(groupLabel),
        })
      } catch (e) {
        console.warn('⚠️  history save failed:', e.message)
      }
    }

    send('progress', { percent: 100, message: `✅ เสร็จสิ้น · ${total} โพสต์` })
    send('done', { source, mode, classifier: lastClassifier, cached, count: total, minutes })
  } catch (err) {
    if (signal.aborted) return // client gone — no point sending fail
    console.error(err)
    send('fail', { error: err.message })
  } finally {
    res.end()
  }
})

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    gemini: Boolean(GEMINI_KEY),
    model: GEMINI_MODEL,
    hasSession: hasSession(),
    canPost: canPost(),
    scraper: hasSession() ? 'local (session ready)' : 'demo (no session)',
    groups: loadGroups().map(groupLabel),
  })
})

// List the monitored groups.
app.get('/api/groups', (req, res) => {
  res.json({
    groups: loadGroupsFull().map((g) => ({ url: g.url, label: groupLabel(g.url), active: g.active })),
  })
})

// Replace the monitored-group list. Body: { groups: [{url, active}] } (URL
// strings are also accepted for backward compatibility).
app.put('/api/groups', (req, res) => {
  const input = Array.isArray(req.body?.groups) ? req.body.groups : null
  if (!input) return res.status(400).json({ error: 'groups must be an array' })
  const items = input
    .map((g) => ({
      url: (typeof g === 'string' ? g : g?.url || '').trim(),
      active: typeof g === 'object' ? g.active !== false : true,
    }))
    .filter((g) => g.url)
  const bad = items.filter((g) => !/facebook\.com\/groups\//i.test(g.url))
  if (bad.length) {
    return res.status(400).json({ error: 'ลิงก์กลุ่มไม่ถูกต้อง:\n' + bad.map((g) => g.url).join('\n') })
  }
  const saved = saveGroups(items)
  scrapeCache = { at: 0, minutes: 0, posts: null } // groups changed → invalidate cache
  const activeN = saved.filter((g) => g.active).length
  console.log(`  📝 อัปเดตกลุ่ม: ${saved.length} กลุ่ม (ใช้งาน ${activeN}): ${saved.map((g) => groupLabel(g.url) + (g.active ? '' : '(ปิด)')).join(', ')}`)
  res.json({ groups: saved.map((g) => ({ url: g.url, label: groupLabel(g.url), active: g.active })) })
})

// ---------------------------------------------------------------------------
// History — past search rounds, each stored as a local Excel file
// ---------------------------------------------------------------------------
app.get('/api/history', (_req, res) => {
  res.json({ rounds: listRounds() })
})

app.get('/api/history/:id', async (req, res) => {
  try {
    const round = await getRound(req.params.id)
    if (!round) return res.status(404).json({ error: 'not found' })
    res.json(round) // { meta, leads }
  } catch (err) {
    console.error('history read failed:', err)
    res.status(500).json({ error: err.message })
  }
})

// Download the raw .xlsx of a round.
app.get('/api/history/:id/excel', (req, res) => {
  const file = roundFilePath(req.params.id)
  if (!file) return res.status(404).json({ error: 'not found' })
  res.download(file)
})

app.delete('/api/history/:id', (req, res) => {
  deleteRound(req.params.id)
  res.json({ ok: true })
})

// ---------------------------------------------------------------------------
// Post Sets — reusable post content (text + images) for auto-posting
// ---------------------------------------------------------------------------
app.get('/api/postsets', (_req, res) => {
  res.json({ postsets: listSets() })
})

app.post('/api/postsets', (req, res) => {
  const { name, text, images } = req.body || {}
  if (!String(text || '').trim() && !(images || []).length) {
    return res.status(400).json({ error: 'ต้องมีข้อความหรือรูปภาพอย่างน้อยหนึ่งอย่าง' })
  }
  res.json({ postset: createSet({ name, text, images }) })
})

app.put('/api/postsets/:id', (req, res) => {
  const { name, text, keepImages, newImages } = req.body || {}
  const updated = updateSet(req.params.id, { name, text, keepImages, newImages })
  if (!updated) return res.status(404).json({ error: 'not found' })
  res.json({ postset: updated })
})

app.delete('/api/postsets/:id', (req, res) => {
  deleteSet(req.params.id)
  res.json({ ok: true })
})

// ---------------------------------------------------------------------------
// Schedules — plan to auto-post a set to groups at a time (executor is later)
// ---------------------------------------------------------------------------
function validGroups(groups) {
  const urls = (groups || []).map((g) => String(g).trim()).filter(Boolean)
  const bad = urls.filter((u) => !/facebook\.com\/groups\//i.test(u))
  return { urls, bad }
}

app.get('/api/schedules', (_req, res) => {
  res.json({ schedules: listSchedules() })
})

app.post('/api/schedules', (req, res) => {
  const { name, postSetId, groups, runAt } = req.body || {}
  const { urls, bad } = validGroups(groups)
  if (bad.length) return res.status(400).json({ error: 'ลิงก์กลุ่มไม่ถูกต้อง:\n' + bad.join('\n') })
  if (!urls.length) return res.status(400).json({ error: 'ต้องมีกลุ่มเป้าหมายอย่างน้อยหนึ่งกลุ่ม' })
  if (!postSetId) return res.status(400).json({ error: 'กรุณาเลือกชุดโพสต์' })
  res.json({ schedule: createSchedule({ name, postSetId, groups: urls, runAt }) })
})

app.put('/api/schedules/:id', (req, res) => {
  const patch = { ...req.body }
  if ('groups' in patch) {
    const { urls, bad } = validGroups(patch.groups)
    if (bad.length) return res.status(400).json({ error: 'ลิงก์กลุ่มไม่ถูกต้อง:\n' + bad.join('\n') })
    patch.groups = urls
  }
  const updated = updateSchedule(req.params.id, patch)
  if (!updated) return res.status(404).json({ error: 'not found' })
  res.json({ schedule: updated })
})

app.delete('/api/schedules/:id', (req, res) => {
  deleteSchedule(req.params.id)
  res.json({ ok: true })
})

// Run a schedule NOW (manual "โพสต์เลย"). Streams live progress via SSE — same
// pattern as /api/leads/stream. (GET, because EventSource can't POST.) Emits:
// `progress` {message}, then `done` {ok} or `fail` {error}. Per-group results
// are written onto the schedule as it runs; the UI polls /api/schedules to see
// them. Only one post run is allowed at a time (poster.js guards this).
const inflightRuns = new Set() // schedule ids mid-run (manual or auto)
app.get('/api/schedules/:id/run', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no') // disable proxy buffering
  res.flushHeaders?.()

  const ac = new AbortController()
  res.on('close', () => ac.abort())
  const send = (event, data) => {
    if (ac.signal.aborted) return
    res.write(`event: ${event}\n`)
    res.write(`data: ${JSON.stringify(data)}\n\n`)
  }

  const id = req.params.id
  if (!canPost()) {
    send('fail', { error: 'ยังไม่มี session — รัน "npm run login" ก่อน' })
    return res.end()
  }
  if (inflightRuns.has(id) || isPosting()) {
    send('fail', { error: 'มีการโพสต์กำลังทำงานอยู่ — รอจนเสร็จ' })
    return res.end()
  }

  inflightRuns.add(id)
  send('progress', { message: '⏳ เริ่มโพสต์...' })
  try {
    await runSchedule(id, { onStep: (msg) => send('progress', { message: msg }) })
    send('done', { ok: true })
  } catch (e) {
    send('fail', { error: e.message })
  } finally {
    inflightRuns.delete(id)
    res.end()
  }
})

// ---------------------------------------------------------------------------
// Keywords CRUD — user-customisable keyword lists for the rule-based classifier
// ---------------------------------------------------------------------------
app.get('/api/keywords', (_req, res) => {
  res.json({
    defaults: getDefaultKeywords(), // built-ins from keywords.defaults.json (read-only in UI)
    extras:   loadExtras(),         // user-added extras saved in keywords.json
    merged:   loadKeywords(),       // defaults + extras merged (what the classifier uses)
  })
})

app.put('/api/keywords', (req, res) => {
  // Body: { extras: { renter, owner, seller } } — only the user-added list
  const input = req.body?.extras
  if (!input || typeof input !== 'object') {
    return res.status(400).json({ error: 'body.extras must be an object with renter/owner/seller arrays' })
  }
  try {
    const saved = saveKeywords(input)
    console.log(`  📝 อัปเดต keywords extras: renter=${saved.renter.length}, owner=${saved.owner.length}, seller=${saved.seller.length}`)
    res.json({ extras: saved, merged: loadKeywords() })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.listen(PORT, () => {
  const groups = loadGroups()
  console.log(`\n  ✅ API ready → http://localhost:${PORT}`)
  console.log(`     Gemini:   ${GEMINI_KEY ? `configured (${GEMINI_MODEL})` : 'NOT set (keyword fallback)'}`)
  console.log(`     Scraper:  ${hasSession() ? 'local Playwright (session พร้อม)' : 'demo data — รัน "npm run login" ก่อน'} · ${groups.length} กลุ่ม`)
  console.log(`     Poster:   ${canPost() ? 'พร้อมโพสต์ (session พร้อม)' : 'ยังไม่พร้อม — รัน "npm run login" ก่อน'}`)
  console.log(`     Groups:   ${groups.map(groupLabel).join(', ')}\n`)
})

// ---------------------------------------------------------------------------
// Auto-post scheduler — every 30s, fire any schedule whose runAt has passed.
// Only one run at a time (poster.js enforces it via the `running` flag), and we
// skip schedules already mid-run or while no session exists.
//
// Safety: a schedule whose runAt is more than STALE_MS in the past is NOT
// auto-fired (it's likely stale from a server outage — auto-posting public FB
// content by surprise is hard to undo). It's left pending with a console
// warning; the user can still force it via "โพสต์เลย" in the UI.
// ---------------------------------------------------------------------------
const STALE_MS = 10 * 60 * 1000 // skip schedules overdue by more than 10 min
function checkDueSchedules() {
  if (isPosting() || !canPost()) return
  const now = Date.now()
  const due = listSchedules().find((s) => {
    if (s.status !== 'pending' || inflightRuns.has(s.id)) return false
    const t = new Date(s.runAt).getTime()
    if (isNaN(t)) return false
    if (t > now) return false // not yet
    if (now - t > STALE_MS) {
      console.log(`  ⏭️  ข้าม "${s.name}" (${s.id}) — เลยเวลามากเกินไป กด "โพสต์เลย" เพื่อบังคับ`)
      return false
    }
    return true
  })
  if (!due) return
  inflightRuns.add(due.id)
  console.log(`  ⏰  auto-post: "${due.name}" ถึงเวลาแล้ว → ${due.groups.length} กลุ่ม`)
  runSchedule(due.id, { onStep: (m) => console.log(`     · ${m}`) })
    .catch((e) => console.warn(`  ⚠️  auto-post ล้มเหลว (${due.id}):`, e.message))
    .finally(() => inflightRuns.delete(due.id))
}
setInterval(checkDueSchedules, 30_000)
