export function evidence(rawText, match, value, source = 'rule') {
  return {
    quote: match[0],
    start: match.index,
    end: match.index + match[0].length,
    value,
    source,
  }
}

export function quoteExists(rawText, item) {
  if (!item || typeof item.quote !== 'string') return false
  const raw = String(rawText || '')
  if (Number.isInteger(item.start) && Number.isInteger(item.end)) {
    return raw.slice(item.start, item.end) === item.quote
  }
  return raw.includes(item.quote)
}
