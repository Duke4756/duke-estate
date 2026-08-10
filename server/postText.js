// Remove floor details at the final publishing boundary. This protects old
// saved post sets as well as newly imported ones without deleting useful room
// data from the internal property record.
export function removeFloorDetails(value) {
  return String(value || '')
    .split(/\r?\n/)
    .map((line) => line
      .replace(/(?:อยู่)?ชั้น(?:ที่)?\s*(?:\d{1,3}(?:\s*[-–—]\s*\d{1,3})?|สูง|กลาง|ต่ำ)(?:\s*(?:ขึ้นไป|ลงมา))?/giu, '')
      .replace(/(?:\d{1,3}(?:st|nd|rd|th)\s+floor|(?:high|mid(?:dle)?|low)\s+floor|floor\s*[:：]?\s*(?:\d{1,3}(?:\s*[-–—]\s*\d{1,3})?|high|mid(?:dle)?|low))/giu, '')
      .replace(/\s*([|•·,;/])\s*(?=$|[|•·,;/])/g, '$1')
      .replace(/^\s*[•·|,;:/-]+\s*$/, '')
      .replace(/^\s*[|,;:/-]+\s*/, '')
      .replace(/[ \t]{2,}/g, ' ')
      .trim())
    .filter(Boolean)
    .join('\n')
    .trim()
}

export const CONTACT_ONLY_CTA = '📩 สนใจนัดชมห้อง ติดต่อ Line หรือโทรเท่านั้น (ไม่เห็นแชท Facebook)'

export function preparePostText(value) {
  return removeFloorDetails(value)
    .split(/\r?\n/)
    .map((line) => /สนใจ.*(?:นัดชม|ชมห้อง|สอบถาม)/iu.test(line) ? CONTACT_ONLY_CTA : line)
    .filter((line) => !/(?:ทัก|ส่งข้อความทาง)\s*(?:แชท|inbox)(?!.*(?:Line|ไลน์|โทร|Tel))/iu.test(line))
    .join('\n')
    .trim()
}
