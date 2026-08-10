import process from 'node:process'

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on'])

export function readFeatureFlag(name, env = process.env) {
  return TRUE_VALUES.has(String(env[name] ?? '').trim().toLowerCase())
}

export function getFeatureFlags(env = process.env) {
  return Object.freeze({
    propertyV2: readFeatureFlag('PROPERTY_V2_ENABLED', env),
    projectProvider: readFeatureFlag('PROJECT_PROVIDER_ENABLED', env),
    localAuth: readFeatureFlag('LOCAL_AUTH_ENABLED', env),
  })
}
