import { describe, expect, it } from 'vitest'
import { getFeatureFlags, readFeatureFlag } from '../server/config/features.js'

describe('feature flags', () => {
  it('keeps all new architecture features disabled by default', () => {
    expect(getFeatureFlags({})).toEqual({
      propertyV2: false,
      projectProvider: false,
      localAuth: false,
    })
  })

  it('accepts only explicit true values', () => {
    expect(readFeatureFlag('TEST_FLAG', { TEST_FLAG: 'true' })).toBe(true)
    expect(readFeatureFlag('TEST_FLAG', { TEST_FLAG: 'ON' })).toBe(true)
    expect(readFeatureFlag('TEST_FLAG', { TEST_FLAG: '0' })).toBe(false)
  })
})
