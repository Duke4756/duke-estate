// Lightweight in-process coordinator for browser work. Locks are scoped to a
// Facebook account so unrelated accounts can continue while one is busy.
const locks = new Map()
const waiters = new Map()

function queueFor(accountId) {
  if (!waiters.has(accountId)) waiters.set(accountId, [])
  return waiters.get(accountId)
}

function grant(accountId, activity) {
  const lock = { accountId, activity, acquiredAt: new Date().toISOString() }
  locks.set(accountId, lock)
  let released = false
  return {
    lock,
    release() {
      if (released) return
      released = true
      if (locks.get(accountId) !== lock) return
      locks.delete(accountId)
      const queue = queueFor(accountId)
      const next = queue.shift()
      if (!queue.length) waiters.delete(accountId)
      if (next) next.resolve(grant(accountId, next.activity))
    },
  }
}

export function tryAcquireAccount(accountId = 'primary', activity = 'BROWSER') {
  if (locks.has(accountId)) return null
  return grant(accountId, activity)
}

export function acquireAccount(accountId = 'primary', activity = 'BROWSER') {
  const immediate = tryAcquireAccount(accountId, activity)
  if (immediate) return Promise.resolve(immediate)
  return new Promise((resolve) => queueFor(accountId).push({ activity, resolve }))
}

export function accountBrowserState(accountId = 'primary') {
  const lock = locks.get(accountId)
  return lock ? { state: lock.activity, acquiredAt: lock.acquiredAt } : { state: 'IDLE', acquiredAt: null }
}

export function browserBrokerSnapshot() {
  return [...new Set([...locks.keys(), ...waiters.keys()])].map((accountId) => ({
    accountId,
    ...accountBrowserState(accountId),
    waiting: waiters.get(accountId)?.length || 0,
  }))
}
