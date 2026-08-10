import { pathToFileURL } from 'node:url'
import { launchBrowser } from '../browserLauncher.js'
import { createPropertyDataService } from '../db/service.js'
import { deterministicExtract } from '../pipeline/deterministicExtractor.js'

const COLLAPSED = /(?:\.\.\.|…)\s*(?:ดูเพิ่มเติม|see more)/iu

export async function hydrateMissingPrices({ limit = Infinity } = {}) {
  const service = createPropertyDataService()
  const rows = /** @type {Record<string, any>[]} */ (service.db.prepare(`
    SELECT p.id property_id, p.status, r.*
    FROM properties p
    JOIN raw_posts r ON r.id = p.raw_post_id
    WHERE p.deleted_at IS NULL
      AND p.rent_price_monthly IS NULL AND p.sale_price IS NULL
      AND r.source_url IS NOT NULL
    ORDER BY p.id DESC
  `).all()).slice(0, limit)
  const browser = await launchBrowser({
    headless: true,
    args: ['--disable-blink-features=AutomationControlled'],
  })
  const context = await browser.newContext({
    storageState: process.env.FB_SESSION_PATH || 'server/fb-session.json',
    viewport: { width: 1366, height: 900 },
    locale: 'th-TH',
  })
  const stats = { total: rows.length, expanded: 0, priced: 0, noPrice: 0, failed: 0 }
  try {
    for (const [index, row] of rows.entries()) {
      const page = await context.newPage()
      try {
        await page.goto(row.source_url, { waitUntil: 'domcontentloaded', timeout: 45_000 })
        await page.waitForTimeout(1_500)
        const messages = page.locator('[data-ad-comet-preview="message"]')
        const messageCount = await messages.count()
        const needle = normalize(row.raw_text).replace(/(?:ดูเพิ่มเติม|see more).*$/iu, '').slice(0, 80)
        let bestIndex = -1
        let bestScore = 0
        for (let messageIndex = 0; messageIndex < messageCount; messageIndex++) {
          const candidate = normalize(await messages.nth(messageIndex).innerText().catch(() => ''))
          const score = commonPrefix(needle, candidate)
          if (score > bestScore) {
            bestScore = score
            bestIndex = messageIndex
          }
        }
        if (bestIndex < 0 || bestScore < Math.min(20, needle.length)) throw new Error('source message not found')
        let message = messages.nth(bestIndex)
        const article = message.locator('xpath=ancestor::*[@role="article"][1]')
        const more = article.getByText(/^(?:ดูเพิ่มเติม|see more)$/iu).first()
        if (await more.isVisible().catch(() => false)) {
          await more.click({ force: true, timeout: 5_000 })
          await page.waitForTimeout(250)
          message = article.locator('[data-ad-comet-preview="message"]').first()
        }
        const fullText = (await message.innerText()).trim()
        if (fullText.length > row.raw_text.length && !COLLAPSED.test(fullText)) stats.expanded++
        const extraction = deterministicExtract(fullText)
        const extracted = extraction.properties[0]
        const hasPrice = Boolean(extracted?.rent_price_monthly || extracted?.sale_price)
        await service.ingest({
          source_adapter: row.source_adapter,
          source_post_id: row.source_post_id,
          source_url: row.source_url,
          source_group_id: row.source_group_id,
          source_group_name: row.source_group_name,
          author_name: row.author_name,
          raw_text: fullText,
          source_created_at: row.source_created_at,
          collector_version: 'facebook-permalink-hydrator-v1',
        })
        if (hasPrice) {
          applyPriceToProtectedRecord(service, row.property_id, fullText, extracted)
          stats.priced++
        } else {
          stats.noPrice++
        }
        console.log(`[${index + 1}/${rows.length}] ${hasPrice ? 'PRICE' : 'NO_PRICE'} ${row.source_url}`)
      } catch (error) {
        stats.failed++
        console.warn(`[${index + 1}/${rows.length}] FAILED ${row.source_url}: ${error instanceof Error ? error.message : error}`)
      } finally {
        await page.close().catch(() => {})
      }
    }
  } finally {
    await browser.close()
    service.close()
  }
  return stats
}

function applyPriceToProtectedRecord(service, propertyId, rawText, extracted) {
  const current = service.db.prepare('SELECT * FROM properties WHERE id = ? AND deleted_at IS NULL').get(propertyId)
  if (!current || (current.rent_price_monthly != null || current.sale_price != null)) return
  const patch = {
    rent_price_monthly: extracted.rent_price_monthly,
    sale_price: extracted.sale_price,
    currency: extracted.currency,
  }
  service.update(propertyId, patch, 'system_price_hydration')
  const insertEvidence = service.db.prepare(`
    INSERT INTO field_evidence(property_id, field_name, value_json, quote, confidence, validation_status)
    VALUES (?, ?, ?, ?, ?, 'valid')
  `)
  for (const field of ['rent_price_monthly', 'sale_price', 'currency']) {
    if (patch[field] == null) continue
    const item = extracted.evidence.find((entry) => entry.field === field)
    if (item?.quote && rawText.includes(item.quote)) {
      insertEvidence.run(propertyId, field, JSON.stringify(patch[field]), item.quote, item.confidence)
    }
  }
}

function normalize(value) {
  return String(value || '').replace(/\s+/gu, ' ').trim().toLowerCase()
}

function commonPrefix(first, second) {
  let index = 0
  while (index < first.length && index < second.length && first[index] === second[index]) index++
  return index
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify(await hydrateMissingPrices(), null, 2))
}
