import { chromium } from 'playwright'

const MISSING_EXECUTABLE = /executable doesn't exist|browser.*not found|playwright install/iu
const chromeFallbackTypes = new WeakSet()
export const LOW_RESOURCE_INTERACTIVE_ARGS = [
  '--renderer-process-limit=3',
  '--disable-background-networking',
  '--disable-component-update',
  '--disable-sync',
  '--disable-features=MediaRouter,GlobalMediaControls,OptimizationHints,Translate',
]

export async function reduceInteractiveContextLoad(context) {
  await context.route('**/*', (route) => {
    const type = route.request().resourceType()
    if (type === 'media' || type === 'font') return route.abort()
    return route.continue()
  })
}

/**
 * Launch Playwright's bundled Chromium when available and transparently fall
 * back to the locally installed Google Chrome. This keeps login, collection
 * and posting on the same browser policy after Playwright package upgrades.
 */
export async function launchBrowser(options = {}, browserType = chromium) {
  const configuredChannel = String(process.env.PLAYWRIGHT_CHANNEL || '').trim()
  if (configuredChannel) {
    return browserType.launch({ ...options, channel: configuredChannel })
  }
  if (chromeFallbackTypes.has(browserType)) {
    return browserType.launch({ ...options, channel: 'chrome' })
  }

  try {
    return await browserType.launch(options)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (!MISSING_EXECUTABLE.test(message)) throw error
    try {
      const browser = await browserType.launch({ ...options, channel: 'chrome' })
      chromeFallbackTypes.add(browserType)
      console.warn('  ℹ️ ใช้ Google Chrome ในเครื่องแทน Playwright Chromium (ระบบทำงานได้ตามปกติ)')
      return browser
    } catch (chromeError) {
      const chromeMessage = chromeError instanceof Error ? chromeError.message : String(chromeError)
      throw new Error(
        `เปิดเบราว์เซอร์ไม่สำเร็จ: ไม่พบทั้ง Playwright Chromium และ Google Chrome (${chromeMessage})`,
        { cause: chromeError },
      )
    }
  }
}
