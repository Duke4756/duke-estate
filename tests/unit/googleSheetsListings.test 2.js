import { describe, expect, it, vi } from 'vitest'
import { createGoogleSheetsListingsService, LISTING_HEADERS, listingRow } from '../../server/services/googleSheetsListings.js'

const env = { GOOGLE_SHEETS_SPREADSHEET_ID: 'sheet-1', GOOGLE_SERVICE_ACCOUNT_EMAIL: 'service@example.com', GOOGLE_PRIVATE_KEY: 'private-key' }

describe('Google Sheets listings service', () => {
  it('maps the twelve Listings columns in order', () => {
    const row = listingRow({ date: '2026-08-02', project: 'Test', price: 18000, bedrooms: 1, roomType: 'Plus', pet: 'Unknown', location: 'Bangkok', ownerName: 'Owner', phone: '080', facebookLink: 'https://facebook.com/post', postText: 'text', note: 'note' })
    expect(row).toHaveLength(LISTING_HEADERS.length)
    expect(row.slice(0, 3)).toEqual(['2026-08-02', 'Test', '18000'])
  })
  it('creates the header once and appends with RAW input', async () => {
    const values = { get: vi.fn().mockResolvedValue({ data: { values: [] } }), update: vi.fn().mockResolvedValue({ data: {} }), append: vi.fn().mockResolvedValue({ data: { updates: { updatedRange: 'Listings!A2:L2' } } }) }
    const result = await createGoogleSheetsListingsService({ env, sheetsClient: { spreadsheets: { values } } }).appendListing({ project: 'Test' })
    expect(values.update).toHaveBeenCalledOnce()
    expect(values.append.mock.calls[0][0]).toMatchObject({ range: 'Listings!A:L', valueInputOption: 'RAW' })
    expect(result.updatedRange).toBe('Listings!A2:L2')
  })
  it('rejects missing server configuration without exposing a key', async () => {
    await expect(createGoogleSheetsListingsService({ env: {} }).appendListing({})).rejects.toMatchObject({ code: 'GOOGLE_SHEETS_NOT_CONFIGURED' })
  })
})
