import { expect, test } from '@playwright/test'

test('filters columns, reviews evidence, edits, opens source, deletes and undoes a property', async ({ page }) => {
  let deleted = false
  let confirmed = false
  let rent = 18000
  let currency = 'THB'
  const propertyQueries = []
  const property = () => ({
    id: 1,
    project_name_raw: null,
    project_name_canonical: null,
    project_id: null,
    transaction_type: 'rent',
    rent_price_monthly: rent,
    currency,
    sale_price: null,
    area_sqm: 180,
    bedrooms: 3,
    pet_policy: 'allowed',
    overall_confidence: 0.65,
    status: confirmed ? 'confirmed' : 'pending_review',
    author: 'Owner',
    permalink: 'https://facebook.com/groups/1/posts/1',
    raw_text: 'ปล่อยเช่า 3 ห้องนอน 180 ตร.ม. ค่าเช่า 18,000 บาท/เดือน เลี้ยงสัตว์ได้',
    evidence: [
      { field: 'area_sqm', quote: '180 ตร.ม.', confidence: 0.98 },
      { field: 'rent_price_monthly', quote: 'ค่าเช่า 18,000 บาท/เดือน', confidence: 0.96 },
    ],
    warnings: ['project_name_missing'],
    duplicateReasons: ['content_hash'],
    verified_nearest_transit: 'BTS On Nut',
    verified_transit_distance_m: 200,
    transit_source_url: 'https://example.com/verified-station',
  })
  await page.route('**/api/health', (route) => route.fulfill({ json: { hasSession: true, canPost: true } }))
  await page.route('**/api/properties?*', (route) => {
    propertyQueries.push(route.request().url())
    return route.fulfill({
      json: { posts: deleted ? [] : [property()], total: deleted ? 0 : 1, page: 1, pages: 1 },
    })
  })
  await page.route('**/api/properties/1', async (route) => {
    if (route.request().method() === 'PUT') {
      const body = route.request().postDataJSON()
      if ('rent_price_monthly' in body) rent = body.rent_price_monthly
      if ('currency' in body) currency = body.currency
      if (body.status === 'confirmed') confirmed = true
      return route.fulfill({ json: { property: property(), auditEventId: 2 } })
    }
    if (route.request().method() === 'DELETE') {
      deleted = true
      return route.fulfill({ json: { auditEventId: 3 } })
    }
    return route.continue()
  })
  await page.route('**/api/properties/undo/3', (route) => {
    deleted = false
    return route.fulfill({ json: { property: property() } })
  })
  await page.goto('/')
  await page.getByRole('button', { name: /ฐานเจ้าของ/ }).click()
  await expect(page.getByText('180 ตร.ม.')).toBeVisible()
  await page.getByPlaceholder('พิมพ์ชื่อโครงการ').fill('Aspire')
  await expect.poll(() => propertyQueries.some((url) => url.includes('project=Aspire'))).toBe(true)
  await expect(page.getByRole('link', { name: /โพสต์ต้นฉบับ/ })).toHaveAttribute(
    'href',
    'https://facebook.com/groups/1/posts/1',
  )
  await page.getByRole('button', { name: 'หลักฐาน' }).click()
  await expect(page.getByText('“180 ตร.ม.”')).toBeVisible()
  await page.getByRole('button', { name: '×' }).click()
  page.once('dialog', (dialog) => dialog.accept('19000'))
  await page.getByRole('button', { name: 'แก้ไข' }).click()
  await expect(page.getByText('19,000 บาท')).toBeVisible()
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: 'ลบ' }).click()
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect(page.getByText('180 ตร.ม.')).toBeVisible()
})
