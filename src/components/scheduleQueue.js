const timeValue = (value) => {
  const time = new Date(value || 0).getTime()
  return Number.isFinite(time) ? time : 0
}

export function filterAndSortSchedules(schedules, {
  query = '',
  status = 'all',
  account = 'all',
  sort = 'runSoon',
} = {}) {
  const needle = String(query).trim().toLocaleLowerCase('th')
  const filtered = schedules.filter((schedule) => {
    const haystack = [
      schedule.name,
      schedule.setName,
      schedule.accountName,
      ...(schedule.groups || []),
    ].join(' ').toLocaleLowerCase('th')
    return (status === 'all' || schedule.status === status)
      && (account === 'all' || (schedule.accountId || 'primary') === account)
      && (!needle || haystack.includes(needle))
  })

  return filtered.sort((a, b) => {
    if (sort === 'newest') return timeValue(b.createdAt || b.runAt) - timeValue(a.createdAt || a.runAt)
    if (sort === 'oldest') return timeValue(a.createdAt || a.runAt) - timeValue(b.createdAt || b.runAt)
    if (sort === 'runLate') return timeValue(b.runAt) - timeValue(a.runAt)
    // Pending/active work stays above history, then nearest run time first.
    const rank = { posting: 0, pending: 1, failed: 2, done: 3, canceled: 4 }
    return (rank[a.status] ?? 5) - (rank[b.status] ?? 5)
      || timeValue(a.runAt) - timeValue(b.runAt)
  })
}

export function paginateSchedules(schedules, page, pageSize) {
  const size = Math.max(1, Number(pageSize) || 20)
  const pages = Math.max(1, Math.ceil(schedules.length / size))
  const safePage = Math.min(pages, Math.max(1, Number(page) || 1))
  const start = (safePage - 1) * size
  return {
    items: schedules.slice(start, start + size),
    page: safePage,
    pages,
    total: schedules.length,
  }
}
