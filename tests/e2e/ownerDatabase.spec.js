import { expect, test } from '@playwright/test'

test('searches properties, combines filters, resets filters and links to the source', async ({ page }) => {
  const queries = []
  await page.route('**/api/**', (route) => route.fulfill({ json: {} }))
  await page.route('**/api/health', (route) => route.fulfill({ json: { hasSession: true, canPost: true } }))
  await page.route('**/api/properties?*', (route) => {
    const params = new URL(route.request().url()).searchParams
    queries.push(Object.fromEntries(params))
    return route.fulfill({ json: {
      posts: params.get('search') === 'missing' ? [] : [{
        id: 1, project_name_canonical: 'Aspire', rent_price_monthly: 18000,
        bedrooms: 3, area_sqm: 180, pet_policy: 'allowed', source_role: 'owner',
        permalink: 'https://facebook.com/groups/1/posts/1',
      }], total: 1, page: 1, pages: 1,
    } })
  })
  await page.goto('/')
  await page.getByRole('button', { name: /ฐานเจ้าของ/ }).click()
  await expect(page.getByText('180 ตร.ม.')).toBeVisible()
  await expect(page.getByRole('link', { name: 'เปิด ↗' })).toHaveAttribute('href', 'https://facebook.com/groups/1/posts/1')
  const search = page.getByPlaceholder('ค้นหาชื่อโครงการ ทำเล สถานี หรือเบอร์โทร...')
  await search.fill('Aspire')
  await page.getByRole('combobox', { name: /^ห้องนอน/ }).selectOption('3')
  await page.getByRole('button', { name: /ตัวกรองเพิ่มเติม/ }).click()
  await page.getByRole('combobox', { name: /^ประเภทรายการ/ }).selectOption('rent')
  await expect.poll(() => queries.at(-1)).toMatchObject({ search: 'Aspire', bedrooms: '3', intent: 'rent' })
  await page.getByRole('button', { name: 'ล้างทั้งหมด' }).click()
  await expect(search).toHaveValue('')
  await expect.poll(() => queries.at(-1)?.bedrooms || '').toBe('')
  await expect(page.getByText('180 ตร.ม.')).toBeVisible()
  await search.fill('missing')
  await expect(page.getByText('ไม่พบทรัพย์ที่ตรงกับเงื่อนไข ลองลดตัวกรองบางรายการ')).toBeVisible()
})
