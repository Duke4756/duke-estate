import { describe, expect, it, vi } from 'vitest'
import { launchBrowser } from '../../server/browserLauncher.js'

describe('browser launcher', () => {
  it('falls back to installed Chrome when Playwright Chromium is missing', async () => {
    const chrome = { close: vi.fn() }
    const browserType = {
      launch: vi.fn()
        .mockRejectedValueOnce(new Error("Executable doesn't exist. Please run npx playwright install"))
        .mockResolvedValueOnce(chrome),
    }

    await expect(launchBrowser({ headless: true }, browserType)).resolves.toBe(chrome)
    expect(browserType.launch).toHaveBeenNthCalledWith(2, { headless: true, channel: 'chrome' })
  })

  it('does not hide unrelated browser launch errors', async () => {
    const failure = new Error('permission denied')
    const browserType = { launch: vi.fn().mockRejectedValue(failure) }
    await expect(launchBrowser({}, browserType)).rejects.toBe(failure)
    expect(browserType.launch).toHaveBeenCalledTimes(1)
  })
})
