import { importMarketingProperty, marketingPropertyStatus } from './marketingPlanImport.js'
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import { mockPosts } from '../src/data/mockPosts.js'
import { scrapeGroups, hasSession } from './scraper.js'
import { duplicateGroups, groupKey, loadGroups, loadGroupsFull, loadGroupsByCategory, saveGroups, groupLabel } from './groups.js'
import { resolveFacebookGroupNames } from './groupNameResolver.js'
import { loadKeywords, saveKeywords, getDefaults as getDefaultKeywords, loadExtras } from './keywords.js'
import { saveRound, listRounds, getRound, deleteRound, roundFilePath } from './history.js'
import { saveOwnerPosts, queryOwnerPosts, deleteOwnerPost } from './ownerPosts.js'
import { listSets, createSet, updateSet, refreshImportedSet, deleteSet, deleteSets, reorderSets, findSetBySourceUrl, isPublishableRentalPostSet, IMAGES_DIR } from './postsets.js'
import { previewMarketingPlan, parseMarketingPlan, buildPlanPlacements, resolveProjectId } from './aiMarketingPlan.js'
import { importPropertyUrl } from './propertyImporter.js'
import { disconnectJsaSession, finishJsaLogin, importJsaProperty, resolveJsaPropertyUrlByCd, jsaSessionStatus, refreshJsaSession, startJsaLogin } from './jsaSession.js'
import { listSchedules, createSchedule, createScheduleBatch, updateSchedule, deleteSchedule, clearAutoCampaignSchedules, recoverInterruptedSchedules, reclassifyUnverifiedAcceptedSchedules, remainingAccountPostGap, displayScheduleStatus, isVerifiedPostResult } from './schedules.js'
import { canPost, POST_EVIDENCE_DIR, reverifyUnconfirmedSchedules, runSchedule, isPosting } from './poster.js'
import { groupMembershipFor } from './groupMembershipStore.js'
import { createPropertyDataService } from './db/service.js'
import { createPropertiesRouter } from './routes/properties.js'
import { facebookLeadToRawPost, facebookPostIdentity } from './adapters/facebookGroupAdapter.js'
import { createCrawlStateRepository } from './db/repositories/crawlState.js'
import {
  accountSessionReady,
  listAccounts,
  renameAccount,
  startAccountLogin,
  accountLoginStatus,
  listAccountsVerified,
  finishAccountLogin,
  cancelAccountLogin,
  startGroupMembership,
  groupMembershipStatus,
  finishGroupMembership,
  cancelGroupMembership,
  removeAccount,
  interactiveAccountBrowserOpen,
} from './accounts.js'
import { getPostingSettings, savePostingSettings, isWithinPostingWindow, nextPostingWindowStart } from './postingSettings.js'
import { selectConcurrentDueSchedules } from './concurrentScheduler.js'
import { nextAccountOccurrence } from './accountPostPlan.js'
import { accountPostingRule, getAutoCampaign, includeAutoCampaignPostSet, materializeAutoCampaign, removeAutoCampaignPostSets, saveAutoCampaign, takeNextDiversePostSet } from './autoCampaigns.js'
import { classifyOwnerListingPosts } from './pipeline/ownerListingClassifier.js'
import { createOwnerListingExtractionService } from './services/ownerListingExtractionService.js'
import { createOwnerListingRepository } from './db/repositories/ownerListings.js'
import { createOwnerListingsRouter } from './routes/ownerListings.js'
import { resolveSearchMode } from './services/searchMode.js'
import { PostProcessingQueue } from './services/postProcessingQueue.js'
import { PropertyRepairJob } from './services/propertyRepairJob.js'
import { canonicalFacebookGroup, createSourceRegistry } from './services/sourceRegistry.js'
import { createAdaptiveScheduler } from './services/adaptiveScheduler.js'
import { createCoverageEstimator } from './services/coverageEstimator.js'
import { createSourcesRouter } from './routes/sources.js'
import { refreshListingFreshness } from './db/repositories/listingClusters.js'
import { pruneExtractionCache } from './db/repositories/cache.js'
import { PIPELINE_VERSION } from './pipeline/versions.js'
import { autopostReliability } from './autopostReliability.js'

dotenv.config()

const APP_ROLE = process.env.APP_ROLE || 'all'
const AUTOPOST_ENABLED = APP_ROLE !== 'search'
const PROCESSING_ENABLED = APP_ROLE !== 'autopost'

const app = express()
// The legacy Facebook search/raw-post pipeline has been retired. Keep old
// clients from starting a scrape while the property stock and autopost APIs
// remain available.
app.use('/api/leads', (_req, res) => res.status(410).json({ error: 'ระบบค้นหาและโพสต์ดิบถูกปิดใช้งานแล้ว' }))
let eventLoopLagMs = 0
let eventLoopExpectedAt = Date.now() + 1000
const eventLoopProbe = setInterval(() => {
  const now = Date.now()
  eventLoopLagMs = Math.max(0, now - eventLoopExpectedAt)
  eventLoopExpectedAt = now + 1000
}, 1000)
eventLoopProbe.unref()
app.use(cors())
app.use(express.json({ limit: '50mb' })) // large limit — post-set images arrive as base64
app.use('/api/postsets/images', express.static(IMAGES_DIR))
// Keep the action route before the static evidence handler. With
// `fallthrough: false`, express.static answers POST requests with 405 and the
// Finder action below would otherwise never run.
app.post('/api/autopost/evidence/open-folder', (_req, res) => {
  try {
    fs.mkdirSync(POST_EVIDENCE_DIR, { recursive: true })
    if (process.platform !== 'darwin') return res.status(400).json({ error: 'ปุ่มเปิด Finder รองรับ macOS เท่านั้น' })
    const child = spawn('open', [POST_EVIDENCE_DIR], { detached: true, stdio: 'ignore' })
    // A GUI launch can be rejected by macOS (for example when the process has
    // no active desktop session). Always consume the asynchronous spawn error;
    // otherwise one click can terminate the whole scheduler process.
    child.once('error', (error) => {
      console.error(`[evidence] เปิด Finder ไม่สำเร็จ: ${error.message}`)
    })
    child.unref()
    res.json({ ok: true, path: POST_EVIDENCE_DIR })
  } catch (error) {
    res.status(500).json({ error: `เปิดโฟลเดอร์ไม่สำเร็จ: ${error.message}` })
  }
})
app.use('/api/autopost/evidence', express.static(POST_EVIDENCE_DIR, { fallthrough: false, maxAge: '7d' }))
app.get('/api/autopost/reliability', (req, res) => {
  try {
    res.json(autopostReliability().summary({ hours: req.query.hours }))
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})
const propertyData = createPropertyDataService()
const cachePruneResult = pruneExtractionCache(propertyData.db, { pipelineVersion: PIPELINE_VERSION, maxEntries: 3000 })
if (cachePruneResult.obsolete || cachePruneResult.lru) console.log(`  🧹 ลด extraction cache ${cachePruneResult.obsolete + cachePruneResult.lru} รายการ · คงไว้ ${cachePruneResult.remaining}`)
const processingQueue = new PostProcessingQueue({
  db: propertyData.db,
  processor: (rawPost) => propertyData.ingest(rawPost, { useAI: Boolean(process.env.GEMINI_API_KEY) }),
  ownerOnly: true,
  rentOnly: true,
})
const propertyRepairJob = new PropertyRepairJob({ service: propertyData })
const sourceRegistry = createSourceRegistry(propertyData.db)
const adaptiveScheduler = createAdaptiveScheduler(propertyData.db, sourceRegistry)
const coverageEstimator = createCoverageEstimator(propertyData.db)
sourceRegistry.importLegacy(loadGroupsFull())
refreshListingFreshness(propertyData.db)
adaptiveScheduler.recoverStale()
processingQueue.on('event', (event) => {
  if (event.type !== 'COMPLETED' || !event.rawPostId) return
  const raw = propertyData.db.prepare('SELECT source_group_id FROM raw_posts WHERE id=?').get(event.rawPostId)
  const source = sourceRegistry.schedulable().find((item) => String(item.source_group_id || '') === String(raw?.source_group_id || ''))
  if (!source) return
  const ids = event.propertyIds || []
  if (!ids.length) return
  const placeholders = ids.map(() => '?').join(',')
  const roles = propertyData.db.prepare(`SELECT source_role,COUNT(*) count FROM properties WHERE id IN (${placeholders}) GROUP BY source_role`).all(...ids)
  const roleCount = Object.fromEntries(roles.map((row) => [row.source_role, row.count]))
  const clusters = propertyData.db.prepare(`SELECT COUNT(*) count FROM cluster_merge_audits WHERE action='CREATE' AND property_id IN (${placeholders})`).get(...ids).count
  sourceRegistry.recordCapture(source.id, { properties_created: ids.length, listing_instances_created: ids.length, unique_listing_clusters_created: clusters, owner_posts_found: roleCount.owner || 0, agent_posts_found: (roleCount.agent || 0) + (roleCount.co_agent || 0) })
})

function authorizedSourceUrls(urls) {
  const allowed = new Map(sourceRegistry.schedulable().map((source) => [canonicalFacebookGroup(source.canonical_url)?.identity, source.canonical_url]))
  return (urls || []).map((url) => canonicalFacebookGroup(url)).filter((item) => item && allowed.has(item.identity)).map((item) => allowed.get(item.identity))
}
if (PROCESSING_ENABLED) {
  processingQueue.recoverStaleJobs()
  processingQueue.kick()
}
const crawlState = createCrawlStateRepository(propertyData.db)
app.use('/api/properties', createPropertiesRouter(propertyData, processingQueue, propertyRepairJob))
app.use('/api/sources', createSourcesRouter({ db: propertyData.db, registry: sourceRegistry, scheduler: adaptiveScheduler, coverage: coverageEstimator, runJobs: runSourceJobs }))
const ownerListingExtraction = createOwnerListingExtractionService()
const ownerListingRepository = createOwnerListingRepository(propertyData.db)
const ownerRules = { snapshot: () => ({ config: {}, projects: [], aliases: [] }), status: () => ({ configured: false, source: 'database' }), refresh: async () => ({ configured: false, source: 'database' }) }
app.use('/api/owner-listings', createOwnerListingsRouter({ extractionService: ownerListingExtraction, repository: ownerListingRepository, rulesService: ownerRules }))
app.get('/api/owner-rules/status', (_req, res) => res.json(ownerRules.status()))
app.post('/api/owner-rules/refresh', async (_req, res) => res.json(await ownerRules.refresh()))
app.get('/api/processing-jobs/status', (_req, res) => res.json({ jobs: processingQueue.stats() }))
app.get('/api/raw-posts', (req, res) => {
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50))
  const rows = propertyData.db.prepare(`
    SELECT r.id, r.source_post_id, r.source_url, r.source_group_name, r.author_name,
      r.source_created_at, r.captured_at, r.ingestion_status, r.content_hash,
      j.status job_status, j.attempt_count, j.next_retry_at, j.last_error,
      c.classification, c.confidence classification_confidence,
      (SELECT COUNT(*) FROM properties p WHERE p.raw_post_id=r.id AND p.deleted_at IS NULL) property_count,
      (SELECT COUNT(*) FROM review_queue q WHERE q.raw_post_id=r.id AND q.status='open') review_count
    FROM raw_posts r
    LEFT JOIN post_processing_jobs j ON j.id=(SELECT id FROM post_processing_jobs WHERE raw_post_id=r.id ORDER BY id DESC LIMIT 1)
    LEFT JOIN raw_post_classifications c ON c.id=(SELECT id FROM raw_post_classifications WHERE raw_post_id=r.id ORDER BY id DESC LIMIT 1)
    ORDER BY COALESCE(r.captured_at,r.collected_at) DESC LIMIT ?
  `).all(limit)
  res.json({ posts: rows })
})
app.get('/api/raw-posts/:id', (req, res) => {
  const post = propertyData.db.prepare('SELECT * FROM raw_posts WHERE id=?').get(Number(req.params.id))
  if (!post) return res.status(404).json({ error: 'raw post not found' })
  const versions = propertyData.db.prepare('SELECT * FROM raw_post_versions WHERE raw_post_id=? ORDER BY captured_at DESC').all(post.id).map((item) => ({ ...item, metadata: JSON.parse(item.metadata_json || '{}') }))
  const processing = propertyData.db.prepare('SELECT * FROM processing_runs WHERE raw_post_id=? ORDER BY id DESC').all(post.id)
  res.json({ post: { ...post, media: JSON.parse(post.media_json || '{}'), warnings: JSON.parse(post.collection_warnings_json || '[]') }, versions, processing })
})

app.get('/api/accounts', async (req, res) => {
  try {
    // The dashboard polls this endpoint. Launching three Facebook browsers on
    // every expired verification-cache read can make the entire API appear
    // offline for minutes. Normal reads use the persisted scheduler status;
    // an explicit refresh still performs the live Facebook verification.
    res.json({ accounts: req.query.refresh === '1'
      ? await listAccountsVerified({ force: true })
      : listAccounts() })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})
app.put('/api/accounts/:id', (req, res) => {
  try { res.json({ account: renameAccount(req.params.id, req.body?.name) }) }
  catch (e) { res.status(400).json({ error: e.message }) }
})
app.post('/api/accounts/login/start', async (req, res) => {
  if (isPosting() || sessionKeepaliveRunning || postReverifyRunning || jsaSessionKeepaliveRunning) return res.status(409).json({ error: 'Chrome กำลังทำงานเบื้องหลัง กรุณารอสักครู่แล้วลองใหม่ เพื่อป้องกันเครื่องกระตุก' })
  try { res.json({ account: await startAccountLogin(req.body?.name) }) }
  catch (e) { res.status(500).json({ error: e.message }) }
})
app.post('/api/accounts/:id/login/start', async (req, res) => {
  if (isPosting() || sessionKeepaliveRunning || postReverifyRunning || jsaSessionKeepaliveRunning) return res.status(409).json({ error: 'Chrome กำลังทำงานเบื้องหลัง กรุณารอสักครู่แล้วลองใหม่ เพื่อป้องกันเครื่องกระตุก' })
  try { res.json({ account: await startAccountLogin(req.body?.name, req.params.id) }) }
  catch (e) { res.status(400).json({ error: e.message }) }
})
app.post('/api/accounts/:id/login/finish', async (req, res) => {
  try { res.json({ account: await finishAccountLogin(req.params.id) }) }
  catch (e) { res.status(400).json({ error: e.message }) }
})
app.get('/api/accounts/:id/login/status', async (req, res) => {
  try { res.json(await accountLoginStatus(req.params.id)) }
  catch (e) { res.status(400).json({ error: e.message }) }
})
app.post('/api/accounts/:id/login/cancel', async (req, res) => {
  await cancelAccountLogin(req.params.id); res.json({ ok: true })
})
app.delete('/api/accounts/:id', (req, res) => {
  try { res.json({ ok: removeAccount(req.params.id) }) }
  catch (e) { res.status(400).json({ error: e.message }) }
})
app.post('/api/accounts/:id/group-membership/start', async (req, res) => {
  try { res.json(await startGroupMembership(req.params.id, req.body?.groupUrl)) }
  catch (e) { res.status(400).json({ error: e.message }) }
})
app.get('/api/accounts/:id/group-membership/status', async (req, res) => {
  try { res.json(await groupMembershipStatus(req.params.id)) }
  catch (e) { res.status(400).json({ error: e.message }) }
})
app.post('/api/accounts/:id/group-membership/finish', async (req, res) => {
  try { res.json(await finishGroupMembership(req.params.id)) }
  catch (e) { res.status(400).json({ error: e.message }) }
})
app.post('/api/accounts/:id/group-membership/cancel', async (req, res) => {
  await cancelGroupMembership(req.params.id); res.json({ ok: true })
})

app.get('/api/posting-settings', (_req, res) => {
  const settings = getPostingSettings()
  res.json({
    settings,
    withinWindow: isWithinPostingWindow(new Date(), settings),
    nextWindowStart: nextPostingWindowStart(new Date(), settings).toISOString(),
  })
})
app.put('/api/posting-settings', (req, res) => {
  try {
    const settings = savePostingSettings(req.body)
    scheduleNextDueCheck()
    res.json({
      settings,
      withinWindow: isWithinPostingWindow(new Date(), settings),
      nextWindowStart: nextPostingWindowStart(new Date(), settings).toISOString(),
    })
  } catch (e) {
    res.status(400).json({ error: e.message })
  }
})

app.get('/api/auto-campaign', (_req, res) => {
  res.json({ campaign: getAutoCampaign() })
})
app.get('/api/auto-campaign/status', (_req, res) => {
  const statusNow = Date.now()
  const bangkokDay = (value = new Date()) => new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(value))
  const today = bangkokDay()
  const campaign = getAutoCampaign()
  const accounts = new Map(listAccounts().map((account) => [account.id, account.name]))
  const sets = listSets().filter(isPublishableRentalPostSet)
  const runs = listSchedules()
    .filter((schedule) => schedule.source === 'auto')
    .slice(0, 20)
    .map((schedule) => {
      const displayStatus = displayScheduleStatus(schedule, statusNow)
      const showUnconfirmed = displayStatus === 'unconfirmed'
      return ({
      id: schedule.id,
      accountId: schedule.accountId || 'primary',
      accountName: accounts.get(schedule.accountId || 'primary') || 'บัญชีหลัก',
      name: schedule.name,
      postSetId: schedule.postSetId,
      status: displayStatus,
      runAt: schedule.runAt,
      createdAt: schedule.createdAt,
      finishedAt: schedule.finishedAt || null,
      successCount: (schedule.results || []).filter(isVerifiedPostResult).length,
      unconfirmedCount: showUnconfirmed ? (schedule.results || []).filter((result) => Number(result.verificationVersion || 0) >= 4 && (result.pending || ['accepted', 'unconfirmed'].includes(result.verified))).length : 0,
      skippedCount: displayStatus === 'skipped' ? (schedule.results || []).filter((result) => Number(result.verificationVersion || 0) >= 4 && (result.pending || ['accepted', 'unconfirmed'].includes(result.verified))).length : 0,
      attemptCount: (schedule.results || []).length,
      lastError: [...(schedule.results || [])].reverse().find((result) => !result.ok)?.error || null,
      successfulResults: (schedule.results || []).filter(isVerifiedPostResult).map((result) => ({
        group: result.group,
        postUrl: result.postUrl || null,
        evidenceUrl: result.evidenceUrl || null,
        publishReceipt: result.publishReceipt || null,
        verified: result.verified,
        at: result.at || schedule.finishedAt || null,
      })),
      unconfirmedResults: showUnconfirmed ? (schedule.results || []).filter((result) => Number(result.verificationVersion || 0) >= 4 && (result.pending || ['accepted', 'unconfirmed'].includes(result.verified))).map((result) => ({
        group: result.group,
        evidenceUrl: result.evidenceUrl || null,
        at: result.at || schedule.finishedAt || null,
        error: result.error || 'ยังไม่พบ permalink ยืนยัน',
      })) : [],
      // Keep items available for manual review after the short "unconfirmed"
      // window becomes "skipped". They were previously hidden from the UI at
      // exactly the point where an operator still needed to inspect the group.
      reviewResults: (schedule.results || []).filter((result) =>
        Number(result.verificationVersion || 0) >= 4 && (result.pending || ['accepted', 'unconfirmed', 'submitted'].includes(result.verified))).map((result) => ({
        group: result.group,
        evidenceUrl: result.evidenceUrl || null,
        verified: result.verified,
        submitted: result.submitted === true,
        verificationExpired: result.verificationExpired === true,
        verificationAttempts: Number(result.verificationAttempts || 0),
        lastVerificationAt: result.lastVerificationAt || null,
        at: result.at || schedule.finishedAt || null,
        error: result.error || 'ยังไม่พบ permalink ยืนยัน',
      })),
      membershipResults: (schedule.results || []).filter((result) => /^(?:ยังไม่ได้เข้าร่วมกลุ่ม|กลุ่มกำลังรออนุมัติ)/.test(String(result.error || ''))).map((result) => ({
        group: result.group,
        error: result.error,
        at: result.at || schedule.finishedAt || null,
      })),
    })})
  const previewSettings = structuredClone(campaign)
  const previewReservedIds = [...new Set(listSchedules()
    .filter((schedule) => ['pending', 'posting', 'unconfirmed'].includes(schedule.status))
    .map((schedule) => schedule.postSetId)
    .filter(Boolean))]
  const availableInventory = sets.filter((set) => !previewReservedIds.includes(set.id))
  const inventory = {
    total: sets.length,
    available: availableInventory.length,
    empty: campaign.mode === 'account_schedule' ? sets.length === 0 : availableInventory.length === 0,
    blockedReason: availableInventory.length === 0 ? 'inventory_empty' : null,
  }
  const plans = campaign.accountIds.map((accountId) => {
    if (campaign.mode === 'account_schedule') {
      const rule = campaign.accountRules[accountId]
      const active = listSchedules().find((run) => run.accountId === accountId && run.source === 'auto' && ['pending', 'posting'].includes(run.status))
      const next = nextAccountOccurrence(rule, campaign.accountState?.[accountId]?.lastOccurrence, statusNow)
      const nextSet = sets.find((set) => set.id === (active?.postSetId || rule?.slots?.[0]?.postSetId))
      return { accountId, accountName: accounts.get(accountId) || 'บัญชีหลัก', nextRunAt: active?.runAt || (next === null ? null : new Date(next).toISOString()),
        nextPostSetId: nextSet?.id, nextPostSetName: next === null && !active ? 'ครบตามการตั้งค่าแล้ว' : nextSet?.name,
        state: next === null && !active ? 'completed' : nextSet ? 'ready' : 'inventory_empty', randomPostSet: false }
    }
    const nextSet = takeNextDiversePostSet({ settings: previewSettings, sets, reservedIds: previewReservedIds })
    if (nextSet) previewReservedIds.push(nextSet.id)
    return {
      accountId,
      accountName: accounts.get(accountId) || 'บัญชีหลัก',
      nextRunAt: nextSet ? (campaign.accountState?.[accountId]?.nextRunAt || null) : null,
      nextPostSetId: nextSet?.id || null,
      nextPostSetName: nextSet?.name || null,
      state: nextSet ? 'ready' : (sets.length === 0 ? 'inventory_empty' : 'waiting_inventory'),
      randomPostSet: false,
    }
  })
  const historyByDay = new Map()
  for (const schedule of listSchedules()) {
    const accountId = schedule.accountId || 'primary'
    for (const result of schedule.results || []) {
      if (!isVerifiedPostResult(result)) continue
      const postedAt = result.verifiedAt || result.at || schedule.finishedAt
      if (!postedAt) continue
      const day = bangkokDay(postedAt)
      const dayAccounts = historyByDay.get(day) || new Map()
      const current = dayAccounts.get(accountId) || { verified: 0, withEvidence: 0 }
      current.verified += 1
      if (result.evidenceUrl) current.withEvidence += 1
      dayAccounts.set(accountId, current)
      historyByDay.set(day, dayAccounts)
    }
  }
  const statsForDay = (date) => {
    const dayAccounts = historyByDay.get(date) || new Map()
    const accountStats = [...accounts].map(([accountId, accountName]) => ({
      accountId, accountName,
      verified: dayAccounts.get(accountId)?.verified || 0,
      withEvidence: dayAccounts.get(accountId)?.withEvidence || 0,
    }))
    return {
      date,
      total: accountStats.reduce((sum, item) => sum + item.verified, 0),
      withEvidence: accountStats.reduce((sum, item) => sum + item.withEvidence, 0),
      accounts: accountStats,
    }
  }
  const dailyHistory = Array.from({ length: 30 }, (_, index) =>
    statsForDay(bangkokDay(new Date(Date.now() - index * 86_400_000))))
  const todayStats = statsForDay(today)
  const dailyStats = {
    ...todayStats,
    history: dailyHistory,
  }
  res.json({ campaign, runs, plans, inventory, dailyStats, serverTime: new Date().toISOString() })
})
app.put('/api/auto-campaign', (req, res) => {
  try {
    if (req.body?.pauseOnly === true) {
      const campaign = saveAutoCampaign({ ...getAutoCampaign(), enabled: false })
      scheduleNextDueCheck()
      return res.json({ campaign })
    }
    const requestedAccounts = [...new Set((req.body?.accountIds || []).filter(Boolean))]
    const knownAccounts = new Set(listAccounts().map((account) => account.id))
    if (requestedAccounts.some((id) => !knownAccounts.has(id))) {
      return res.status(400).json({ error: 'พบบัญชีที่ไม่มีอยู่แล้ว กรุณาเลือกบัญชีใหม่' })
    }
    const knownSets = new Set(listSets().map((set) => set.id))
    if ((req.body?.postSetIds || []).some((id) => !knownSets.has(id))) {
      return res.status(400).json({ error: 'พบชุดโพสต์ที่ไม่มีอยู่แล้ว กรุณาเลือกใหม่' })
    }
    const { bad } = validGroups(req.body?.groups)
    if (bad.length) return res.status(400).json({ error: 'ลิงก์กลุ่มไม่ถูกต้อง:\n' + bad.join('\n') })
    const previousCampaign = getAutoCampaign()
    if (req.body?.mode === 'account_schedule') {
      const publishableSets = new Set(listSets().filter(isPublishableRentalPostSet).map((set) => set.id))
      const activeGroups = new Set(loadGroups().filter((group) => group.active !== false).map((group) => group.url))
      for (const accountId of requestedAccounts) {
        const rule = req.body.accountRules?.[accountId] || {}
        if (!Array.isArray(rule.slots) || rule.slots.some((slot) => !publishableSets.has(slot.postSetId))) throw new Error('เลือกทรัพย์เช่าที่พร้อมโพสต์ในสต็อกของแต่ละบัญชี')
        if (rule.slots.some((slot) => validGroups([slot.group]).bad.length || !activeGroups.has(slot.group))) throw new Error('เลือกกลุ่มที่เปิดใช้งานในแต่ละบัญชี')
        const firstTime = rule.time || rule.slots?.[0]?.time || '09:00'
        if (!rule.repeatDaily && JSON.stringify(rule) !== JSON.stringify(previousCampaign.accountRules?.[accountId]) && Date.parse(`${rule.startDate}T${firstTime}:00+07:00`) < Date.now()) throw new Error('เวลาโพสต์ครั้งเดียวต้องเป็นเวลาในอนาคต')
      }
    }
    let clearedRuns = 0
    const campaign = saveAutoCampaign({
      ...req.body,
      enabled: req.body?.restartNow === true ? true : req.body?.enabled,
    })
    if (campaign.mode === 'account_schedule') {
      for (const run of listSchedules()) {
        if (run.source !== 'auto' || run.status !== 'pending') continue
        const changed = previousCampaign.mode !== campaign.mode || !campaign.accountIds.includes(run.accountId)
          || JSON.stringify(previousCampaign.accountRules?.[run.accountId]) !== JSON.stringify(campaign.accountRules?.[run.accountId])
        if (changed) { updateSchedule(run.id, { status: 'canceled' }); clearedRuns += 1 }
      }
    } else if (req.body?.restartNow === true) clearedRuns = clearAutoCampaignSchedules()
    let createdRuns = 0
    if (req.body?.restartNow === true) {
      // Create the new two-post burst before the regular scheduler checks its
      // normal posting window. saveAutoCampaign reset account clocks to now.
      const readyAccountIds = listAccounts().filter((account) => account.ready).map((account) => account.id)
      createdRuns = materializeAutoCampaign({
        sets: listSets(),
        readyAccountIds,
        now: Date.now(),
        manualOverride: true,
      }).length
    }
    scheduleNextDueCheck()
    res.json({ campaign: getAutoCampaign(), clearedRuns, createdRuns })
    setImmediate(checkDueSchedules)
  } catch (error) {
    res.status(400).json({ error: error.message })
  }
})

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
let latestSearchSnapshot = { leads: [], updatedAt: null, complete: false }

// onProgress({ percent, message }) reports scrape progress (0–80% of the whole
// job; classification takes the remaining 80–100%). onPosts(posts) fires with
// batches of newly-found posts (fresh scrapes only) so callers can stream
// results as they arrive.
async function fetchPosts(minutes, { fresh = false, onProgress = () => {}, onPosts = () => {}, signal, groups, searchMode = 'lead', sourceBudget = null } = {}) {
  if (!hasSession()) {
    return { source: 'demo', posts: mockPosts, cached: false }
  }
  const targetGroups = Array.isArray(groups) ? groups : loadGroups()
  if (targetGroups.length === 0) {
    onProgress({ percent: 100, message: '⏭️ ข้ามทุกกลุ่มตามตัวเลือกของผู้ใช้' })
    return { source: 'live', posts: [], cached: false }
  }
  // A post stored by the Lead pipeline is not necessarily processed by the
  // Property pipeline. Do not let Lead checkpoints hide Owner/Agent listings.
  const knownPostIds = new Set(propertyData.db.prepare(`
    SELECT source_post_id FROM raw_posts
    WHERE source_adapter = 'facebook_group' AND source_post_id IS NOT NULL
  `).all().map((row) => String(row.source_post_id)))
  // Prevent parallel group workers from processing the same post at the same
  // time. Pending identities are deliberately not persisted as checkpoints:
  // only successfully saved posts become permanently known.
  const pendingPostIds = new Set()
  const identityOf = (post) => facebookPostIdentity(post.permalink, post.id)
  const isKnown = (post) => {
    const identity = identityOf(post)
    return knownPostIds.has(identity) || pendingPostIds.has(identity)
  }
  const groupKey = targetGroups.slice().sort().join('|')
  const fresh_enough =
    !fresh &&
    scrapeCache.posts &&
    scrapeCache.minutes === minutes && scrapeCache.groupKey === groupKey &&
    Date.now() - scrapeCache.at < SCRAPE_TTL_MS
  if (fresh_enough) {
    onProgress({ percent: 80, message: '⚡ ใช้ข้อมูลที่ดึงไว้ล่าสุด (cache)' })
    return { source: 'live', posts: scrapeCache.posts, cached: true }
  }
  // If a scrape for this window is already running (e.g. StrictMode double
  // fetch, or two browser tabs), reuse it instead of launching another.
  if (inFlight && inFlight.minutes === minutes && inFlight.groupKey === groupKey) {
    onProgress({ percent: 40, message: '⏳ รอผลการดึงที่กำลังทำอยู่...' })
    return { source: 'live', posts: await inFlight.promise, cached: true }
  }
  const persistBatch = async (batch, metadata = {}) => {
    let persistedIds = []
    try {
      persistedIds = await onPosts(batch, metadata) || []
      return persistedIds
    } finally {
      const persisted = new Set(persistedIds.map(String))
      for (const post of batch) {
        const identity = identityOf(post)
        if (!identity) continue
        pendingPostIds.delete(identity)
        if (!persisted.has(identity)) continue
        crawlState.markSeen({
          sourcePostId: identity,
          groupUrl: metadata.groupUrl,
          sourceUrl: post.permalink,
          text: post.text,
        })
        knownPostIds.add(identity)
      }
    }
  }
  const promise = scrapeGroups(
    targetGroups,
    minutes,
    (p) => onProgress({ percent: Math.round(p.percent * 0.8), message: p.message }),
    persistBatch,
    signal,
    {
      isKnown,
      onDiscovered(post, { groupUrl }) {
        const identity = identityOf(post)
        if (!identity) return
        pendingPostIds.add(identity)
      },
      getDepth(groupUrl, baseDepth) {
        const recommended = crawlState.recommendedDepth(groupUrl, baseDepth)
        return sourceBudget?.pages ? Math.min(recommended, Number(sourceBudget.pages)) : recommended
      },
      getResumeDepth(groupUrl) {
        return Number(crawlState.get(groupUrl)?.last_depth) || 0
      },
      onGroupStart(groupUrl) {
        crawlState.start(groupUrl)
        const source = sourceRegistry.schedulable().find((item) => canonicalFacebookGroup(item.canonical_url)?.identity === canonicalFacebookGroup(groupUrl)?.identity)
        if (source) onProgress({ percent: 1, message: `กำลังตรวจ source: ${source.group_name || source.canonical_url}` })
      },
      onGroupComplete(groupUrl, stats) {
        if (!stats.failed) crawlState.complete(groupUrl, stats)
        const source = sourceRegistry.schedulable().find((item) => canonicalFacebookGroup(item.canonical_url)?.identity === canonicalFacebookGroup(groupUrl)?.identity)
        if (source) sourceRegistry.recordCapture(source.id, { posts_seen: stats.seen || stats.total || 0, raw_posts_created: stats.newCount || stats.new || 0, duplicate_raw_posts: stats.known || 0, scroll_units_used: stats.depth || 0, capture_failures: stats.failed ? 1 : 0 })
      },
    },
  )
  inFlight = { minutes, groupKey, promise }
  try {
    const posts = await promise
    scrapeCache = { at: Date.now(), minutes, groupKey, posts }
    return { source: 'live', posts, cached: false }
  } finally {
    if (inFlight && inFlight.promise === promise) inFlight = null
  }
}

let sourceJobDrain = null
function runSourceJobs({ manual = false, maxJobs = Number.POSITIVE_INFINITY } = {}) {
  if (sourceJobDrain) return sourceJobDrain
  sourceJobDrain = (async () => {
    let job
    let processedJobs = 0
    while (processedJobs < maxJobs && (job = adaptiveScheduler.claim(`server-${process.pid}`))) {
      const source = sourceRegistry.get(job.source_group_id)
      const state = propertyData.db.prepare('SELECT * FROM source_autopilot_state WHERE id=1').get() || {}
      const enabled = manual || (job.lane === 'BACKFILL' ? state.backfill_enabled : state.autopilot_enabled)
      if (!enabled || !source) {
        propertyData.db.prepare("UPDATE source_crawl_jobs SET status='CANCELLED',completed_at=?,locked_at=NULL,locked_by=NULL,updated_at=? WHERE id=?").run(new Date().toISOString(), new Date().toISOString(), job.id)
        continue
      }
      processedJobs += 1
      const counters = { posts_seen: 0, raw_posts_created: 0, duplicate_raw_posts: 0 }
      try {
        const result = await fetchPosts(job.lane === 'BACKFILL' ? 7 * 24 * 60 : 24 * 60, {
          fresh: true, groups: [source.canonical_url], sourceBudget: job.budget,
          onPosts(batch) {
            counters.posts_seen += batch.length
            const persisted = []
            for (const post of batch) {
              const captured = processingQueue.captureAndEnqueue(facebookLeadToRawPost({ ...post, crawlRunId: job.id }))
              if (captured.inserted) counters.raw_posts_created += 1
              else counters.duplicate_raw_posts += 1
              const identity = facebookPostIdentity(post.permalink, post.id)
              if (identity) persisted.push(identity)
            }
            return persisted
          },
        })
        const checkpoint = result.posts.map((post) => facebookPostIdentity(post.permalink, post.id)).find(Boolean) || job.checkpoint_before
        adaptiveScheduler.complete(job.id, { checkpoint, metrics: counters })
      } catch (error) {
        adaptiveScheduler.fail(job.id, error)
      }
    }
  })().finally(() => { sourceJobDrain = null })
  return sourceJobDrain
}

const sourceSchedulerTimer = setInterval(() => {
  // The Auto Post process must never launch Facebook collection browsers.
  // Search/ingestion and publishing use separate application roles so three
  // posting accounts retain their own CPU, memory and browser capacity.
  if (!PROCESSING_ENABLED) return
  const state = propertyData.db.prepare('SELECT * FROM source_autopilot_state WHERE id=1').get() || {}
  if (state.autopilot_enabled) adaptiveScheduler.plan({ lane: 'FRESHNESS' })
  if (state.backfill_enabled) adaptiveScheduler.plan({ lane: 'BACKFILL' })
  if (state.autopilot_enabled || state.backfill_enabled) void runSourceJobs()
  refreshListingFreshness(propertyData.db)
}, 60_000)
sourceSchedulerTimer.unref?.()

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

async function ingestStructuredPosts(leads) {
  const persistedIds = []
  for (const lead of leads) {
    try {
      await propertyData.ingest(facebookLeadToRawPost(lead))
      const identity = facebookPostIdentity(lead.permalink, lead.id)
      if (identity) persistedIds.push(identity)
    } catch (error) {
      // The legacy owner JSON remains authoritative during rollout. A failure
      // in the versioned pipeline is visible in logs but cannot break search.
      console.warn('⚠️  structured property ingest failed:', error.message)
    }
  }
  return persistedIds
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
  const minutes = Math.min(parseInt(req.query.minutes, 10) || 60, 7 * 24 * 60)
  const mode = req.query.mode === 'keyword' ? 'keyword' : 'ai'
  const searchMode = resolveSearchMode(req.query.searchMode)
  const fresh = req.query.fresh === '1'
  try {
    const { source, posts, cached } = await fetchPosts(minutes, { fresh, searchMode })
    const { leads, classifier } = searchMode === 'owner_listing'
      ? classifyOwnerListingPosts(posts, ownerRules.snapshot())
      : await classifyPosts(posts, mode)
    if (searchMode === 'lead' && leads.length) {
      saveOwnerPosts(leads)
      await ingestStructuredPosts(leads)
    }
    res.json({ source, mode, searchMode, classifier, cached, count: leads.length, minutes, leads })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: err.message })
  }
})

// Same as /api/leads but streams live progress via Server-Sent Events.
// Emits: `progress` {percent, message}, then `done` {…leads} or `fail` {error}.
app.get('/api/leads/stream', async (req, res) => {
  const minutes = Math.min(parseInt(req.query.minutes, 10) || 60, 7 * 24 * 60)
  const mode = req.query.mode === 'keyword' ? 'keyword' : 'ai'
  const searchMode = resolveSearchMode(req.query.searchMode)
  const fresh = req.query.fresh === '1'
  const groupCategory = String(req.query.groupCategory || 'all')
  const customUrl = String(req.query.customUrl || '').trim()
  const categoryGroups = customUrl
    ? (/facebook\.com\/groups\//i.test(customUrl) ? [customUrl] : [])
    : loadGroupsByCategory(groupCategory)
  const skippedGroupKeys = new Set(
    String(req.query.skipGroups || '').split(',').map((value) => value.trim().toLowerCase()).filter(Boolean),
  )
  if (customUrl) sourceRegistry.addCandidate({ url: customUrl, discoveredVia: 'current_page', evidenceUrl: customUrl })
  const selectedGroups = authorizedSourceUrls(categoryGroups).filter((url) => !skippedGroupKeys.has(groupKey(url)))
  if (customUrl && !categoryGroups.length) return res.status(400).end()

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no') // disable proxy buffering
  res.flushHeaders?.()

  // The crawl and processing queue are backend work. Closing EventSource must
  // not cancel them; it only stops delivery to that browser connection.
  const ac = new AbortController()
  const { signal } = ac

  const send = (event, data) => {
    if (res.destroyed || res.writableEnded) return
    res.write(`event: ${event}\n`)
    res.write(`data: ${JSON.stringify(data)}\n\n`)
  }
  const onProgress = (evt) => send('progress', evt)
  const counters = { postsFound: 0, rawPostsInserted: 0, duplicatesSkipped: 0, jobsQueued: 0, jobsCompleted: 0, propertiesCreated: 0, propertiesUpdated: 0, reviewItemsCreated: 0, failedJobs: 0 }
  const queueEvent = (event) => {
    if (event.type === 'COMPLETED') { counters.jobsCompleted++; counters.propertiesCreated += event.propertyIds?.length || 0 }
    if (event.type === 'NEEDS_REVIEW') { counters.reviewItemsCreated++ }
    if (event.type === 'FAILED') counters.failedJobs++
    send('pipeline', { ...event, counters: { ...counters } })
  }
  processingQueue.on('event', queueEvent)

  try {
    send('progress', { percent: 0, message: '⏳ เริ่มต้น...' })
    if (categoryGroups.length && !selectedGroups.length) send('source', { type: 'WAITING_AUTHORIZATION', message: 'พบกลุ่มแล้ว แต่ยังไม่ได้รับสิทธิ์ให้เก็บข้อมูล', discovered: categoryGroups.length })
    if (fresh) latestSearchSnapshot = { leads: [], updatedAt: new Date().toISOString(), complete: false }

    let total = 0
    let lastClassifier = mode === 'keyword' ? 'keyword' : 'ai'
    const allLeads = [] // accumulate for saving this round to history
    const uiTasks = new Set()
    const crawlRunId = `crawl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    propertyData.db.prepare(`INSERT INTO crawl_runs(id,status,groups_json,counters_json,started_at) VALUES (?, 'RUNNING', ?, '{}', ?)`).run(crawlRunId, JSON.stringify(selectedGroups), new Date().toISOString())
    // Classify each batch of freshly-scraped posts and stream it so cards show
    // up gradually instead of only at the very end.
    const onPosts = (batch, metadata = {}) => {
      if (!batch.length) return []
      counters.postsFound += batch.length
      const persistedIds = []
      for (const post of batch) {
        const captured = processingQueue.captureAndEnqueue(facebookLeadToRawPost({ ...post, crawlRunId }))
        if (captured.inserted) counters.rawPostsInserted++
        else counters.duplicatesSkipped++
        if (captured.queued) counters.jobsQueued++
        const identity = facebookPostIdentity(post.permalink, post.id)
        if (identity && (captured.inserted || captured.queued || !captured.contentChanged)) persistedIds.push(identity)
        send('pipeline', { type: captured.inserted ? 'RAW_POST_SAVED' : 'DUPLICATE_SKIPPED', rawPostId: captured.rawPost.id, sourceUrl: captured.rawPost.source_url, groupUrl: metadata.groupUrl, counters: { ...counters } })
      }
      // UI classification is intentionally detached from crawler persistence.
      const task = Promise.resolve(searchMode === 'owner_listing'
        ? classifyOwnerListingPosts(batch, ownerRules.snapshot())
        : classifyPosts(batch, mode)).then(({ leads, classifier }) => {
          lastClassifier = classifier; total += leads.length; allLeads.push(...leads)
          latestSearchSnapshot = mergeSearchSnapshot(latestSearchSnapshot, leads, false)
          if (searchMode === 'lead') saveOwnerPosts(leads)
          send('leads', { leads, classifier })
        }).catch((error) => console.warn('UI classification failed:', error.message)).finally(() => uiTasks.delete(task))
      uiTasks.add(task)
      return persistedIds
    }

    const { source, posts, cached } = await fetchPosts(minutes, { fresh, onProgress, onPosts, signal, groups: selectedGroups, searchMode })

    await Promise.allSettled([...uiTasks])

    if (signal.aborted) return // client disconnected — stop work

    // Cached / demo paths don't fire onGroup — classify and send once here.
    if (cached || source === 'demo') {
      const { leads, classifier } = searchMode === 'owner_listing'
        ? classifyOwnerListingPosts(posts, ownerRules.snapshot())
        : await classifyPosts(posts, mode, onProgress)
      lastClassifier = classifier
      total = leads.length
      allLeads.push(...leads)
      latestSearchSnapshot = mergeSearchSnapshot(latestSearchSnapshot, leads, false)
      send('leads', { leads, classifier })
    }

    // Keep history as fresh-run audit files, but make the owner database
    // idempotent so it can be populated from live cache re-views as well.
    if (searchMode === 'lead' && !cached && source === 'live' && allLeads.length) {
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
    if (searchMode === 'lead' && (cached || source === 'demo') && allLeads.length) {
      try {
        const ownerResult = saveOwnerPosts(allLeads)
        console.log(`  🏠 owner database: +${ownerResult.added}, total ${ownerResult.total}`)
      } catch (e) {
        console.warn('⚠️  owner database save failed:', e.message)
      }
    }

    const rememberedPosts = crawlState.countSeen()
    send('progress', {
      percent: 100,
      message: `✅ เสร็จสิ้น · ใหม่ ${total} โพสต์ · ระบบจำแล้ว ${rememberedPosts} โพสต์`,
    })
    latestSearchSnapshot = mergeSearchSnapshot(latestSearchSnapshot, allLeads, true)
    propertyData.db.prepare(`UPDATE crawl_runs SET status='COMPLETED', counters_json=?, completed_at=? WHERE id=?`).run(JSON.stringify(counters), new Date().toISOString(), crawlRunId)
    send('done', {
      source,
      mode,
      searchMode,
      classifier: lastClassifier,
      cached,
      count: total,
      rememberedPosts,
      minutes,
      counters,
    })
  } catch (err) {
    if (signal.aborted) return // client gone — no point sending fail
    console.error(err)
    send('fail', { error: err.message })
  } finally {
    processingQueue.off('event', queueEvent)
    res.end()
  }
})

// Import the most recent search snapshot without scraping Facebook or calling
// Gemini again. Search batches are already persisted incrementally; this
// endpoint is intentionally idempotent and gives the owner workspace an
// explicit "pull latest results" action.
app.post('/api/properties/import-latest', async (_req, res) => {
  const leads = latestSearchSnapshot.leads
  if (!leads.length) {
    const total = propertyData.query({ page: 1, pageSize: 10 }).total
    return res.json({
      ok: true,
      imported: 0,
      available: 0,
      total,
      complete: true,
      alreadySaved: true,
    })
  }
  try {
    const before = propertyData.query({ page: 1, pageSize: 10 }).total
    await ingestStructuredPosts(leads)
    const after = propertyData.query({ page: 1, pageSize: 10 }).total
    res.json({
      ok: true,
      imported: Math.max(0, after - before),
      available: leads.length,
      total: after,
      complete: latestSearchSnapshot.complete,
      updatedAt: latestSearchSnapshot.updatedAt,
    })
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) })
  }
})

function mergeSearchSnapshot(snapshot, leads, complete) {
  const byId = new Map((snapshot.leads || []).map((lead) => [lead.id, lead]))
  for (const lead of leads || []) byId.set(lead.id, lead)
  return {
    leads: [...byId.values()],
    updatedAt: new Date().toISOString(),
    complete: complete || snapshot.complete,
  }
}

// This endpoint is polled by the watchdog every 15 seconds. It must never do
// network or browser work: an earlier version verified every Facebook account
// here, so slow Facebook pages caused overlapping Chrome launches, starved the
// scheduler, and eventually made the watchdog kill an otherwise-live backend.
app.get('/api/health', (_req, res) => {
  const accounts = listAccounts()
  res.json({
    ok: true,
    gemini: Boolean(GEMINI_KEY),
    model: GEMINI_MODEL,
    hasSession: hasSession(),
    canPost: accounts.some((account) => account.ready),
    postGapMinutes: Math.ceil(remainingAccountPostGap('primary') / 60_000),
    postGapMinutesByAccount: Object.fromEntries(accounts.map((account) => [
      account.id,
      Math.ceil(remainingAccountPostGap(account.id) / 60_000),
    ])),
    scraper: hasSession() ? 'local (session ready)' : 'demo (no session)',
    groups: loadGroups().map(groupLabel),
  })
})

let systemOverviewCache = { at: 0, value: null }
app.get('/api/system-overview', (_req, res) => {
  const now = Date.now()
  if (systemOverviewCache.value && now - systemOverviewCache.at < 10_000) return res.json(systemOverviewCache.value)
  const schedules = listSchedules()
  const sets = listSets()
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0)
  const todaySchedules = schedules.filter((item) => Date.parse(item.finishedAt || item.runAt || item.createdAt || 0) >= todayStart.getTime())
  const memory = process.memoryUsage()
  const value = {
    sampledAt: new Date(now).toISOString(),
    performance: { eventLoopLagMs, heapMb: Math.round(memory.heapUsed / 1048576), rssMb: Math.round(memory.rss / 1048576), uptimeHours: Math.round(process.uptime() / 36) / 100 },
    database: {
      properties: propertyData.db.prepare('SELECT COUNT(*) count FROM properties').get().count,
      rawPosts: propertyData.db.prepare('SELECT COUNT(*) count FROM raw_posts').get().count,
      postSets: sets.length,
      companySets: sets.length,
      ownerSets: 0,
    },
    posting: {
      period: 'today', resetAt: '00:00 Asia/Bangkok',
      pending: todaySchedules.filter((item) => item.status === 'pending').length,
      posting: todaySchedules.filter((item) => item.status === 'posting').length,
      failed: todaySchedules.filter((item) => item.status === 'failed').length,
      completed: todaySchedules.filter((item) => item.status === 'done').length,
      evidence: todaySchedules.reduce((count, item) => count + (item.results || []).filter((result) => result.evidenceUrl).length, 0),
    },
  }
  value.health = value.performance.eventLoopLagMs > 500 || value.performance.heapMb > 900 ? 'critical' : value.performance.eventLoopLagMs > 150 || value.performance.heapMb > 600 ? 'warning' : 'healthy'
  systemOverviewCache = { at: now, value }
  res.json(value)
})

// List the monitored groups.
app.get('/api/groups/crawl-history', (_req, res) => {
  const historyByKey = new Map(crawlState.list().map((state) => [state.source_group_key, state]))
  res.json({
    groups: loadGroupsFull().map((group) => ({
      ...group,
      label: group.name || groupLabel(group.url),
      key: groupKey(group.url),
      crawl: historyByKey.get(groupKey(group.url)) || null,
    })),
  })
})

app.get('/api/groups', (req, res) => {
  res.json({
    groups: loadGroupsFull().map((g) => ({ ...g, label: g.name || groupLabel(g.url) })),
  })
})

app.post('/api/groups/resolve-names', async (req, res) => {
  const urls = Array.isArray(req.body?.urls) ? req.body.urls : loadGroupsFull().map((group) => group.url)
  try {
    const resolved = await resolveFacebookGroupNames(urls)
    const byUrl = new Map(resolved.filter((item) => item.ok).map((item) => [item.url, item]))
    const current = loadGroupsFull()
    const saved = saveGroups(current.map((group) => ({
      ...group,
      name: byUrl.get(group.url)?.name || group.name || '',
      memberCount: byUrl.get(group.url)?.memberCount || group.memberCount || null,
    })))
    res.json({ groups: saved.map((group) => ({ ...group, label: group.name || groupLabel(group.url) })), resolved })
  } catch (error) {
    res.status(500).json({ error: `เปิด Facebook เพื่อตรวจชื่อกลุ่มไม่สำเร็จ: ${error.message}` })
  }
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
      category: typeof g === 'object' ? String(g.category || 'general').trim() : 'general',
      name: typeof g === 'object' ? String(g.name || '').trim() : '',
      memberCount: typeof g === 'object' && Number.isFinite(Number(g.memberCount)) ? Number(g.memberCount) : null,
      marketingTags: typeof g === 'object' && Array.isArray(g.marketingTags) ? [...new Set(g.marketingTags.map((tag) => String(tag).trim().toUpperCase()).filter(Boolean))] : [],
      projectTags: typeof g === 'object' && Array.isArray(g.projectTags) ? [...new Set(g.projectTags.map((tag) => String(tag).trim()).filter(Boolean))] : [],
      projectIds: typeof g === 'object' && Array.isArray(g.projectIds) ? [...new Set(g.projectIds.map((tag) => String(tag).trim()).filter(Boolean))] : [],
      notes: typeof g === 'object' ? String(g.notes || '') : '',
    }))
    .filter((g) => g.url)
  const bad = items.filter((g) => !/facebook\.com\/groups\//i.test(g.url))
  if (bad.length) {
    return res.status(400).json({ error: 'ลิงก์กลุ่มไม่ถูกต้อง:\n' + bad.map((g) => g.url).join('\n') })
  }
  const duplicates = duplicateGroups(items)
  if (duplicates.length) {
    return res.status(409).json({
      error: 'ไม่สามารถเพิ่มได้ เนื่องจากมีกลุ่มนี้อยู่แล้ว:\n' + duplicates.join('\n'),
    })
  }
  const saved = saveGroups(items)
  for (const group of saved) {
    const source = sourceRegistry.addCandidate({ url: group.url, name: group.name, discoveredVia: 'group_settings', evidenceText: 'ผู้ใช้เพิ่มในหน้าตั้งค่ากลุ่ม' })
    if (group.active) sourceRegistry.authorize(source.id, { authorized: true, accessible: true, reference: 'group_settings' })
    else sourceRegistry.setStatus(source.id, 'PAUSED')
  }
  scrapeCache = { at: 0, minutes: 0, posts: null } // groups changed → invalidate cache
  const activeN = saved.filter((g) => g.active).length
  console.log(`  📝 อัปเดตกลุ่ม: ${saved.length} กลุ่ม (ใช้งาน ${activeN}): ${saved.map((g) => groupLabel(g.url) + (g.active ? '' : '(ปิด)')).join(', ')}`)
  res.json({ groups: saved.map((g) => ({ ...g, label: g.name || groupLabel(g.url) })) })
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
// Owner listing database — accumulates owner-category posts from live searches
// ---------------------------------------------------------------------------
app.get('/api/owner-posts', (req, res) => {
  res.json(queryOwnerPosts(req.query))
})

app.delete('/api/owner-posts/:identity', (req, res) => {
  deleteOwnerPost(req.params.identity)
  res.json({ ok: true })
})

// ---------------------------------------------------------------------------
// Post Sets — reusable post content (text + images) for auto-posting
// ---------------------------------------------------------------------------
app.get('/api/postsets', (_req, res) => {
  res.json({ postsets: listSets() })
})

app.post('/api/marketing-plan/preview', (req, res) => {
  try { res.json({ plan: previewMarketingPlan(req.body?.plan, { sets: listSets(), groups: loadGroupsFull() }) }) }
  catch (error) { res.status(400).json({ error: error.message }) }
})
app.post('/api/marketing-plan/retry-property', (req, _res, next) => {
  req.body = { plan: { version: 1, properties: [req.body?.property] } }
  req.marketingRetry = true
  next()
}, applyMarketingPlanHandler)
app.post('/api/marketing-plan/apply', applyMarketingPlanHandler)
async function applyMarketingPlanHandler(req, res) {
  try {
    const parsed = parseMarketingPlan(req.body?.plan)
    const groups = loadGroupsFull()
    const projects = propertyData.listProjects()
    const accountIds = listAccounts().filter((account) => account.ready).map((account) => account.id)
    const memberships = (accountId, groupUrl) => groupMembershipFor(accountId, groupUrl)
    const resolvedProperties = []
    const slotsByAccount = Object.fromEntries(accountIds.map((id) => [id, []]))
    for (const item of parsed.properties) {
      const importedResult = await importMarketingProperty(item.cd, {
        listSets, resolveJsaPropertyUrlByCd, importPostSetFromUrl,
      })
      const { postSet, ...importDetails } = importedResult
      const importStatus = postSet ? 'READY' : 'IMPORT_FAILED'
      const importError = importDetails.error?.code || null
      const resolvedProjectId = resolveProjectId(item, projects, postSet ? `${postSet.name}\n${postSet.text}` : '')
      const base = { ...item, projectId: resolvedProjectId, postSetId: postSet?.id || null }
      const placementResult = postSet && !(item.projectSpecific && !resolvedProjectId) ? buildPlanPlacements(base, groups.filter(group => group.enabled !== false && group.active !== false && (!item.groupTags.length || (group.marketingTags || []).some(tag => item.groupTags.includes(String(tag).toUpperCase())) || (resolvedProjectId && (group.projectIds || []).map(String).includes(String(resolvedProjectId))))), accountIds, memberships) : { groups: [], placements: [], rounds: [] }
      const matchingGroups = groups.filter(group => group.enabled !== false && group.active !== false && (!item.groupTags.length || (group.marketingTags || []).some(tag => item.groupTags.includes(String(tag).toUpperCase())) || (resolvedProjectId && (group.projectIds || []).map(String).includes(String(resolvedProjectId)))))
      const status = marketingPropertyStatus({ postSet, projectSpecific: item.projectSpecific, resolvedProjectId, matchingGroups, placements: placementResult.placements, requested: item.placements })
      for (const placement of placementResult.placements) slotsByAccount[placement.accountId]?.push({ postSetId: postSet.id, group: placement.group, time: placement.preferredTimeWindow?.start || '09:00', round: placement.round })
      resolvedProperties.push({ ...item, ...importDetails, placementsCreated: placementResult.placements.length, resolvedProjectId, postSetId: postSet?.id || null, importStatus, importError, resolvedGroups: placementResult.groups.slice(0, item.placements), eligibleAccounts: [...new Set(placementResult.placements.map((p) => p.accountId))], placements: placementResult.placements, rounds: placementResult.rounds, status })
    }
    const usedAccounts = accountIds.filter((id) => slotsByAccount[id]?.length)
    const startDate = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10)
    const accountRules = Object.fromEntries(usedAccounts.map((id) => [id, { startDate, repeatDaily: true, slots: slotsByAccount[id] }]))
    const campaign = !req.marketingRetry && usedAccounts.length ? saveAutoCampaign({ mode: 'account_schedule', enabled: false, accountIds: usedAccounts, accountRules, postSetIds: [], groups: [], groupMode: 'selected', postSetMode: 'all', intervalMinutes: 30, priorityNewHours: 72 }) : null
    const planFile = path.join(process.cwd(), 'server', 'autopost', 'ai-marketing-plans.json')
    let history = []; try { history = JSON.parse(fs.readFileSync(planFile, 'utf8')) } catch {}
    const result = { ...parsed, importedAt: new Date().toISOString(), campaignId: campaign ? `ai_${Date.now()}` : null, properties: resolvedProperties }
    fs.mkdirSync(path.dirname(planFile), { recursive: true }); fs.writeFileSync(planFile, JSON.stringify([...history, result], null, 2))
    res.json({ campaign, plan: result, summary: { properties: resolvedProperties.length, ready: resolvedProperties.filter((p) => p.status === 'READY').length, failed: resolvedProperties.filter((p) => p.status !== 'READY').length, totalPlacements: resolvedProperties.reduce((n, p) => n + p.placements.length, 0) } })
  } catch (error) { res.status(400).json({ error: error.message }) }
}
app.get('/api/marketing-plan/export', (_req, res) => { const file = path.join(process.cwd(), 'server', 'autopost', 'ai-marketing-plans.json'); try { res.json({ plans: JSON.parse(fs.readFileSync(file, 'utf8')) }) } catch { res.json({ plans: [] }) } })

app.get('/api/postsets/jsa-session', (_req, res) => res.json(jsaSessionStatus()))
app.post('/api/postsets/jsa-session/start', async (req, res) => {
  if (isPosting() || sessionKeepaliveRunning || postReverifyRunning || jsaSessionKeepaliveRunning) return res.status(409).json({ error: 'Chrome กำลังทำงานเบื้องหลัง กรุณารอสักครู่แล้วลองใหม่ เพื่อป้องกันเครื่องกระตุก' })
  try { res.json(await startJsaLogin(req.body?.url)) }
  catch (error) { res.status(500).json({ error: error.message }) }
})
app.post('/api/postsets/jsa-session/finish', async (_req, res) => {
  try { res.json(await finishJsaLogin()) }
  catch (error) { res.status(400).json({ error: error.message }) }
})
app.delete('/api/postsets/jsa-session', async (_req, res) => res.json(await disconnectJsaSession()))

app.post('/api/postsets/import-preview', async (req, res) => {
  const sourceUrl = String(req.body?.url || '').trim()
  if (!sourceUrl) return res.status(400).json({ error: 'กรุณาวางลิงก์ประกาศ' })
  const duplicate = findSetBySourceUrl(sourceUrl)
  if (duplicate) return res.status(409).json({ error: `ลิงก์นี้ถูกนำเข้าแล้วในชุด “${duplicate.name}”`, duplicateId: duplicate.id })
  try {
    const isJsaAdmin = (() => { try { return /(^|\.)jsa\.co\.th$/i.test(new URL(sourceUrl).hostname) && /^\/admin\/property\/view\//i.test(new URL(sourceUrl).pathname) } catch { return false } })()
    res.json({ preview: isJsaAdmin ? await importJsaProperty(sourceUrl) : await importPropertyUrl(sourceUrl) })
  } catch (error) {
    const message = error?.name === 'TimeoutError' ? 'เว็บไซต์ใช้เวลาตอบกลับนานเกินไป' : error.message
    res.status(400).json({ error: message || 'ดึงข้อมูลจากลิงก์ไม่สำเร็จ' })
  }
})

async function importPostSetFromUrl(sourceUrl, { propertyType, deal } = {}) {
  const duplicate = findSetBySourceUrl(sourceUrl)
  if (duplicate?.images?.length) return { postset: listSets().find((set) => set.id === duplicate.id), duplicate: true }
    const isJsaAdmin = (() => { try { return /(^|\.)jsa\.co\.th$/i.test(new URL(sourceUrl).hostname) && /^\/admin\/property\/view\//i.test(new URL(sourceUrl).pathname) } catch { return false } })()
    const imported = isJsaAdmin ? await importJsaProperty(sourceUrl) : await importPropertyUrl(sourceUrl)
    if (!String(imported.text || '').trim() && !(imported.images || []).length) throw new Error('ไม่พบข้อความหรือรูปจากประกาศนี้')
    const postset = duplicate ? refreshImportedSet(duplicate.id, { ...imported, propertyType, deal }) : createSet({ ...imported, propertyType, deal })
    includeAutoCampaignPostSet(postset.id)
    return { postset }
}

app.post('/api/postsets/import', async (req, res) => {
  const sourceUrl = String(req.body?.url || '').trim()
  const propertyType = req.body?.propertyType
  const deal = req.body?.deal
  if (!sourceUrl) return res.status(400).json({ error: 'กรุณาวางลิงก์ประกาศ' })
  try {
    res.json(await importPostSetFromUrl(sourceUrl, { propertyType, deal }))
  } catch (error) {
    const message = error?.name === 'TimeoutError' ? 'เว็บไซต์ใช้เวลาตอบกลับนานเกินไป' : error.message
    res.status(400).json({ error: message || 'นำเข้าจากลิงก์ไม่สำเร็จ' })
  }
})

app.post('/api/postsets', (req, res) => {
  const { name, text, images, sourceUrl, kind, propertyType, deal } = req.body || {}
  if (!String(text || '').trim() && !(images || []).length) {
    return res.status(400).json({ error: 'ต้องมีข้อความหรือรูปภาพอย่างน้อยหนึ่งอย่าง' })
  }
  const duplicate = sourceUrl && findSetBySourceUrl(sourceUrl)
  if (duplicate) return res.status(409).json({ error: `ลิงก์นี้ถูกนำเข้าแล้วในชุด “${duplicate.name}”` })
  res.json({ postset: createSet({ name, text, images, sourceUrl, kind, propertyType, deal }) })
})

app.put('/api/postsets/:id', (req, res) => {
  const { name, text, keepImages, newImages, imageOrder, deal, propertyType, kind } = req.body || {}
  const updated = updateSet(req.params.id, { name, text, keepImages, newImages, imageOrder, deal, propertyType, kind })
  if (!updated) return res.status(404).json({ error: 'not found' })
  res.json({ postset: updated })
})

app.delete('/api/postsets/:id', (req, res) => {
  deleteSet(req.params.id)
  removeAutoCampaignPostSets([req.params.id])
  res.json({ ok: true })
})

app.put('/api/postsets-order', (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids : null
  if (!ids) return res.status(400).json({ error: 'ids must be an array' })
  res.json({ postsets: reorderSets(ids) })
})

app.post('/api/postsets/bulk-delete', (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids : null
  if (!ids) return res.status(400).json({ error: 'ids must be an array' })
  const deletedIds = deleteSets(ids)
  removeAutoCampaignPostSets(deletedIds)
  res.json({ deletedIds })
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
  const { name, postSetId, groups, runAt, groupMode, accountId } = req.body || {}
  const { urls, bad } = validGroups(groups)
  if (bad.length) return res.status(400).json({ error: 'ลิงก์กลุ่มไม่ถูกต้อง:\n' + bad.join('\n') })
  if (!urls.length) return res.status(400).json({ error: 'ต้องมีกลุ่มเป้าหมายอย่างน้อยหนึ่งกลุ่ม' })
  if (groupMode && !['selected', 'random'].includes(groupMode)) return res.status(400).json({ error: 'รูปแบบการเลือกกลุ่มไม่ถูกต้อง' })
  if (groupMode !== 'random' && (urls.length < 1 || urls.length > 3)) {
    return res.status(400).json({ error: 'โหมดเลือกกลุ่มเอง เลือกได้ 1-3 กลุ่มต่อเวลา' })
  }
  if (!postSetId) return res.status(400).json({ error: 'กรุณาเลือกชุดโพสต์' })
  if (!listAccounts().some((account) => account.id === (accountId || 'primary') && account.ready)) return res.status(400).json({ error: 'บัญชีที่เลือกยังไม่พร้อมใช้งาน' })
  const schedule = createSchedule({ name, postSetId, groups: urls, runAt, groupMode, accountId })
  scheduleNextDueCheck()
  res.json({ schedule })
})

// Plan several post sets in one ordered queue. The random offset is applied
// forward only, so it varies the visible timestamps without breaking the
// requested minimum interval or the account-level 30-minute safety gap.
app.post('/api/schedules/batch', (req, res) => {
  const { name, postSetIds, groups, runAt, groupMode, intervalMinutes, jitterMinutes = 0, accountId } = req.body || {}
  const { urls, bad } = validGroups(groups)
  if (bad.length) return res.status(400).json({ error: 'ลิงก์กลุ่มไม่ถูกต้อง:\n' + bad.join('\n') })
  if (!urls.length) return res.status(400).json({ error: 'ต้องมีกลุ่มเป้าหมายอย่างน้อยหนึ่งกลุ่ม' })
  if (!Array.isArray(postSetIds) || !postSetIds.length) return res.status(400).json({ error: 'กรุณาเลือกชุดโพสต์อย่างน้อยหนึ่งชุด' })
  if (groupMode && !['selected', 'random'].includes(groupMode)) return res.status(400).json({ error: 'รูปแบบการเลือกกลุ่มไม่ถูกต้อง' })
  if (groupMode !== 'random' && (urls.length < 1 || urls.length > 3)) {
    return res.status(400).json({ error: 'โหมดเลือกกลุ่มเอง เลือกได้ 1-3 กลุ่มต่อเวลา' })
  }
  if (!postSetIds.every((id) => listSets().some((set) => set.id === id))) {
    return res.status(400).json({ error: 'พบชุดโพสต์ที่ไม่มีอยู่แล้ว กรุณาเลือกใหม่' })
  }
  if (!listAccounts().some((account) => account.id === (accountId || 'primary') && account.ready)) {
    return res.status(400).json({ error: 'บัญชีที่เลือกยังไม่พร้อมใช้งาน' })
  }
  const start = new Date(runAt).getTime()
  if (Number.isNaN(start) || start <= Date.now()) return res.status(400).json({ error: 'วันและเวลาเริ่มต้นต้องอยู่ในอนาคต' })
  try {
    const schedules = createScheduleBatch({
      name,
      postSetIds,
      groups: urls,
      groupMode,
      startAt: runAt,
      intervalMinutes,
      jitterMinutes,
      accountId,
    })
    scheduleNextDueCheck()
    res.json({ schedules })
  } catch (e) {
    res.status(400).json({ error: e.message })
  }
})

app.put('/api/schedules/:id', (req, res) => {
  const patch = { ...req.body }
  if ('groups' in patch) {
    const { urls, bad } = validGroups(patch.groups)
    if (bad.length) return res.status(400).json({ error: 'ลิงก์กลุ่มไม่ถูกต้อง:\n' + bad.join('\n') })
    patch.groups = urls
  }
  if ('groupMode' in patch && !['selected', 'random'].includes(patch.groupMode)) {
    return res.status(400).json({ error: 'รูปแบบการเลือกกลุ่มไม่ถูกต้อง' })
  }
  if ((patch.groupMode || 'selected') !== 'random' && patch.groups && (patch.groups.length < 1 || patch.groups.length > 3)) {
    return res.status(400).json({ error: 'โหมดเลือกกลุ่มเอง เลือกได้ 1-3 กลุ่มต่อเวลา' })
  }
  const updated = updateSchedule(req.params.id, patch)
  if (!updated) return res.status(404).json({ error: 'not found' })
  scheduleNextDueCheck()
  res.json({ schedule: updated })
})

app.delete('/api/schedules/:id', (req, res) => {
  deleteSchedule(req.params.id)
  scheduleNextDueCheck()
  res.json({ ok: true })
})

// Run a schedule NOW (manual "โพสต์เลย"). Streams live progress via SSE — same
// pattern as /api/leads/stream. (GET, because EventSource can't POST.) Emits:
// `progress` {message}, then `done` {ok} or `fail` {error}. Per-group results
// are written onto the schedule as it runs; the UI polls /api/schedules to see
// them. Different accounts may run together; each account has its own lock.
const inflightRuns = new Set() // schedule ids mid-run (manual or auto)
app.get('/api/schedules/:id/run', async (req, res) => {
  if (!AUTOPOST_ENABLED) return res.status(403).json({ error: 'โปรแกรมค้นหาโพสต์ปิดระบบเผยแพร่อัตโนมัติไว้เพื่อความปลอดภัย' })
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
  const requestedSchedule = listSchedules().find((schedule) => schedule.id === id)
  const requestedAccountId = requestedSchedule?.accountId || 'primary'
  if (inflightRuns.has(id) || isPosting(requestedAccountId)) {
    send('fail', { error: 'บัญชีนี้กำลังโพสต์งานอื่นอยู่ — รอจนเสร็จ' })
    return res.end()
  }

  inflightRuns.add(id)
  send('progress', { message: '⏳ เริ่มโพสต์...' })
  try {
    const results = await runSchedule(id, { onStep: (msg) => send('progress', { message: msg }) })
    const successes = results.filter((result) => result.ok)
    if (successes.length === 0) {
      const reason = results.find((result) => result.error)?.error || 'Facebook ไม่ยืนยันการโพสต์'
      send('fail', { error: reason })
    } else {
      send('done', { ok: true, partial: successes.length !== results.length })
    }
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
    defaults: getDefaultKeywords(),
    extras:   loadExtras(),
    merged:   loadKeywords(),
    keywords: loadKeywords(),
  })
})

app.put('/api/keywords', (req, res) => {
  const input = req.body?.keywords || req.body?.extras
  if (!input || typeof input !== 'object') {
    return res.status(400).json({ error: 'body.keywords must be an object with renter/owner/seller arrays' })
  }
  try {
    const saved = saveKeywords(input)
    console.log(`  📝 อัปเดต keywords: renter=${saved.renter.length}, owner=${saved.owner.length}, seller=${saved.seller.length}`)
    res.json({ keywords: saved, merged: saved })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

let apiListening = false
app.listen(PORT, () => {
  // Mutate persistent queue state only after this process owns the API port.
  // A duplicate process that fails with EADDRINUSE must never mark the real
  // worker's active schedules as interrupted.
  const recoveredSchedules = recoverInterruptedSchedules()
  if (recoveredSchedules) console.warn(`  ⚠️ กู้ ${recoveredSchedules} รายการที่ค้างสถานะกำลังโพสต์จากรอบก่อน`)
  if (reclassifyUnverifiedAcceptedSchedules()) {
    console.warn('  🕓 ปรับผลเก่าที่ไม่มี permalink จาก “สำเร็จ” เป็น “ยังไม่ยืนยัน” แล้ว')
  }
  apiListening = true
  if (AUTOPOST_ENABLED) checkDueSchedules()
  const groups = loadGroups()
  console.log(`\n  ✅ API ready → http://localhost:${PORT}`)
  console.log(`     Gemini:   ${GEMINI_KEY ? `configured (${GEMINI_MODEL})` : 'NOT set (keyword fallback)'}`)
  console.log(`     Scraper:  ${hasSession() ? 'local Playwright (session พร้อม)' : 'demo data — รัน "npm run login" ก่อน'} · ${groups.length} กลุ่ม`)
  console.log(`     Poster:   ${canPost() ? 'พร้อมโพสต์ (session พร้อม)' : 'ยังไม่พร้อม — รัน "npm run login" ก่อน'}`)
  console.log(`     Groups:   ${groups.map(groupLabel).join(', ')}\n`)
})

// Keep every saved Facebook account warm even when it has no post scheduled.
// The verification visit also writes Facebook's rotated cookies back to that
// account's storage-state file (see accounts.js). A single shared run avoids
// opening overlapping browsers if a slow Facebook response crosses an interval.
const SESSION_KEEPALIVE_MS = Math.max(
  30 * 60_000,
  Number(process.env.FB_SESSION_KEEPALIVE_MS) || 6 * 60 * 60_000,
)
let sessionKeepaliveRunning = false
async function keepFacebookSessionsWarm() {
  if (sessionKeepaliveRunning || interactiveAccountBrowserOpen() || jsaSessionStatus().loginOpen) return
  if (listAccounts().some((account) => isPosting(account.id))) {
    const retry = setTimeout(keepFacebookSessionsWarm, 5 * 60_000)
    retry.unref()
    console.log('  ⏳ เลื่อนต่ออายุ Facebook Session เพราะมีงานกำลังโพสต์')
    return
  }
  sessionKeepaliveRunning = true
  try {
    const accounts = await listAccountsVerified({ force: true })
    const ready = accounts.filter((account) => account.ready).length
    console.log(`  🔄 ต่ออายุ Facebook Session แล้ว ${ready}/${accounts.length} บัญชี`)
  } catch (error) {
    console.warn(`  ⚠️ ต่ออายุ Facebook Session ไม่สำเร็จ: ${error.message}`)
  } finally {
    sessionKeepaliveRunning = false
  }
}
const sessionKeepaliveTimer = setInterval(keepFacebookSessionsWarm, SESSION_KEEPALIVE_MS)
sessionKeepaliveTimer.unref()
const initialSessionKeepaliveTimer = setTimeout(keepFacebookSessionsWarm, 30_000)
initialSessionKeepaliveTimer.unref()

// Keep JSA authentication available for manual imports.
const JSA_SESSION_KEEPALIVE_MS = Math.max(30 * 60_000, Number(process.env.JSA_SESSION_KEEPALIVE_MS) || 2 * 60 * 60_000)
let jsaSessionKeepaliveRunning = false
async function keepJsaSessionWarm() {
  if (!AUTOPOST_ENABLED || !apiListening || jsaSessionKeepaliveRunning || sessionKeepaliveRunning || postReverifyRunning) return
  if (!jsaSessionStatus().connected || jsaSessionStatus().loginOpen || interactiveAccountBrowserOpen() || isPosting()) return
  jsaSessionKeepaliveRunning = true
  try {
    const status = await refreshJsaSession()
    if (!status.skipped) console.log(`  🔄 ต่ออายุ JSA Session แล้ว${status.lastRefreshedAt ? ` · ${status.lastRefreshedAt}` : ''}`)
  } catch (error) {
    console.warn(`  ⚠️ ต่ออายุ JSA Session ไม่สำเร็จ: ${error.message}`)
  } finally {
    jsaSessionKeepaliveRunning = false
  }
}
const jsaSessionKeepaliveTimer = setInterval(keepJsaSessionWarm, JSA_SESSION_KEEPALIVE_MS)
jsaSessionKeepaliveTimer.unref()
const initialJsaSessionKeepaliveTimer = setTimeout(keepJsaSessionWarm, 2 * 60_000)
initialJsaSessionKeepaliveTimer.unref()

// ---------------------------------------------------------------------------
// Auto-post scheduler. It sets a timer for the nearest due item (with a short
// fallback check), and is also called immediately on startup. This prevents a
// queue from waiting for an arbitrary polling interval after the server wakes
// up or a new schedule is created.
//
// Safety: a schedule whose runAt is more than STALE_MS in the past is NOT
// auto-fired (it's likely stale from a server outage — auto-posting public FB
// content by surprise is hard to undo). It's left pending with a console
// warning; the user can still force it via "โพสต์เลย" in the UI. Crucially,
// it is marked as failed rather than being left as a misleading "pending" row.
// ---------------------------------------------------------------------------
const STALE_MS = 60 * 60 * 1000 // skip schedules overdue by more than 60 min
const MAX_SCHEDULER_WAIT_MS = 5_000
let nextDueTimer = null

function markStaleSchedules(now) {
  const knownAccountIds = new Set(listAccounts().map((account) => account.id))
  for (const schedule of listSchedules()) {
    if (schedule.status !== 'pending' || inflightRuns.has(schedule.id)) continue
    const accountId = schedule.accountId || 'primary'
    if (!knownAccountIds.has(accountId)) {
      const message = 'บัญชีของคิวนี้ถูกลบแล้ว — ปิดคิวเก่าเพื่อไม่ให้กีดขวางงานปัจจุบัน'
      updateSchedule(schedule.id, {
        status: 'failed',
        results: (schedule.groups || []).map((group) => ({ group, ok: false, error: message, at: new Date().toISOString() })),
        finishedAt: new Date().toISOString(),
      })
      continue
    }
    if (!accountSessionReady(accountId)) continue
    const dueAt = new Date(schedule.runAt).getTime()
    if (!Number.isFinite(dueAt) || dueAt > now || now - dueAt <= STALE_MS) continue

    const message = 'เลยเวลาตั้งไว้เกิน 60 นาที จึงไม่โพสต์อัตโนมัติเพื่อป้องกันการโพสต์ผิดเวลา — กด “โพสต์เลย” หากยังต้องการโพสต์'
    const results = (schedule.groups || []).map((group) => ({
      group,
      ok: false,
      error: message,
      at: new Date().toISOString(),
    }))
    updateSchedule(schedule.id, { status: 'failed', results, finishedAt: new Date().toISOString() })
    console.warn(`  ⏭️  ข้าม "${schedule.name}" (${schedule.id}) — ${message}`)
  }
}

function scheduleNextDueCheck() {
  if (!AUTOPOST_ENABLED) return
  if (nextDueTimer) clearTimeout(nextDueTimer)
  const now = Date.now()
  const plannedSchedules = listSchedules()
  const nextAt = plannedSchedules
    .filter((schedule) => schedule.status === 'pending' && !inflightRuns.has(schedule.id))
    .map((schedule) => new Date(schedule.runAt).getTime())
    .filter(Number.isFinite)
    .reduce((earliest, dueAt) => Math.min(earliest, dueAt), Infinity)
  // A due item can remain pending while the FB session is unavailable. Do not
  // spin every 250ms in that state; the next regular check is enough, and a
  // run that finishes calls checkDueSchedules() immediately for the next item.
  const untilNext = nextAt - now
  const delay = Number.isFinite(nextAt)
    ? (untilNext <= 0 ? MAX_SCHEDULER_WAIT_MS : Math.max(250, Math.min(MAX_SCHEDULER_WAIT_MS, untilNext)))
    : MAX_SCHEDULER_WAIT_MS
  nextDueTimer = setTimeout(() => {
    nextDueTimer = null
    checkDueSchedules()
  }, delay)
}

function checkDueSchedules() {
  if (!AUTOPOST_ENABLED || !apiListening) return
  if (interactiveAccountBrowserOpen() || jsaSessionStatus().loginOpen) {
    scheduleNextDueCheck()
    return
  }
  const now = Date.now()
  recoverRetryableBrowserFailures(now)
  // Always turn a due campaign clock into a persistent schedule before any
  // background browser can defer publishing. This removes the old state where
  // the UI showed a time in the past but there was no queue item to execute.
  const readyAccountIds = listAccounts().filter((account) => account.ready).map((account) => account.id)
  const autoCreated = materializeAutoCampaign({
    sets: listSets(),
    readyAccountIds,
    now,
  })
  if (autoCreated.length) {
    console.log(`  ♻️ สร้างคิวอัตโนมัติ ${autoCreated.length} รายการ แยกตามบัญชี`)
  }
  markStaleSchedules(now)
  // The session warmer also launches Chrome. Never begin a publishing browser
  // while it is active; keepFacebookSessionsWarm performs the inverse check,
  // so the two jobs cannot race regardless of which timer fires first.
  if (sessionKeepaliveRunning) {
    scheduleNextDueCheck()
    return
  }
  if (!canPost()) {
    scheduleNextDueCheck()
    return
  }
  // A single Mac Chrome instance can consume several GB while Facebook is
  // composing photos. Running one browser per account concurrently eventually
  // drives macOS into heavy memory compression and makes every timer/API look
  // frozen. Keep account clocks independent but execute browser work serially.
  if (isPosting()) {
    scheduleNextDueCheck()
    return
  }
  const currentCampaign = getAutoCampaign()
  const schedules = listSchedules().filter((run) => run.source !== 'auto' || (currentCampaign.enabled && currentCampaign.accountIds.includes(run.accountId)))
  // Owner-direct inventory is paid/priority marketing. Once an Owner burst is
  // created, finish every spaced group in that burst before ordinary JSA work.
  // Keeping future Owner items in this filtered list also prevents a normal
  // post from slipping into the deliberate 30-minute safety gaps.
  const eligibleSchedules = schedules
  const accountIds = [...new Set(eligibleSchedules.map((schedule) => schedule.accountId || 'primary'))]
  const dueSchedules = selectConcurrentDueSchedules({
    schedules: eligibleSchedules,
    now,
    inflightIds: [...inflightRuns],
    runningAccountIds: accountIds.filter((accountId) => isPosting(accountId)),
    readyAccountIds: accountIds.filter((accountId) => accountSessionReady(accountId)),
    remainingGapByAccount: Object.fromEntries(accountIds.map((accountId) => [accountId, remainingAccountPostGap(accountId, now)])),
  })
  if (!dueSchedules.length) {
    scheduleNextDueCheck()
    return
  }
  for (const due of dueSchedules.slice(0, 1)) {
    const accountId = due.accountId || 'primary'
    inflightRuns.add(due.id)
    console.log(`  ⏰  auto-post [${accountId}]: "${due.name}" ถึงเวลาแล้ว → ${due.groups.length} กลุ่ม`)
    runSchedule(due.id, { onStep: (m) => console.log(`     · [${accountId}] ${m}`) })
      .catch((e) => console.warn(`  ⚠️  auto-post ล้มเหลว (${due.id}):`, e.message))
      .finally(() => {
        inflightRuns.delete(due.id)
        checkDueSchedules()
      })
  }
}

function recoverRetryableBrowserFailures(now = Date.now()) {
  for (const schedule of listSchedules()) {
    if (schedule.status !== 'failed' || Number(schedule.autoRetryCount || 0) >= 2) continue
    const results = schedule.results || []
    const browserClosedBeforeSubmit = results.length > 0 && results.every((result) => {
      const message = String(result.error || '')
      return !result.submitted && /target page, context or browser has been closed|browser.*closed|context.*closed/i.test(message)
    })
    if (!browserClosedBeforeSubmit) continue
    const failedAt = Date.parse(schedule.finishedAt || schedule.updatedAt || 0) || 0
    if (now - failedAt < 30_000) continue
    updateSchedule(schedule.id, {
      status: 'pending',
      runAt: new Date(now).toISOString(),
      results: [],
      finishedAt: null,
      autoRetryCount: Number(schedule.autoRetryCount || 0) + 1,
      autoRetryReason: 'browser-closed-before-submit',
    })
    console.warn(`  ♻️ กู้คิว ${schedule.id} อัตโนมัติ เพราะเบราว์เซอร์ปิดก่อนกดโพสต์`)
  }
}

// Permalink indexing can lag behind the composer acknowledgement. Verify one
// submitted result at a time and never resubmit the room while it is pending.
const POST_REVERIFY_INTERVAL_MS = Math.max(60_000, Number(process.env.POST_REVERIFY_INTERVAL_MS) || 2 * 60_000)
// Recovery is part of normal posting, not an opt-in maintenance task. It only
// searches for already-submitted posts and never presses the Post button.
const POST_REVERIFY_ENABLED = process.env.POST_REVERIFY_ENABLED !== 'false'
let postReverifyRunning = false
async function runPostReverification() {
  if (!AUTOPOST_ENABLED || !POST_REVERIFY_ENABLED || postReverifyRunning) return
  postReverifyRunning = true
  try {
    await reverifyUnconfirmedSchedules({ maxResults: 3, onStep: (message) => console.log(`  ${message}`) })
  } finally {
    postReverifyRunning = false
  }
}
const postReverifyTimer = setInterval(runPostReverification, POST_REVERIFY_INTERVAL_MS)
postReverifyTimer.unref()
const initialPostReverifyTimer = setTimeout(runPostReverification, 45_000)
initialPostReverifyTimer.unref()
