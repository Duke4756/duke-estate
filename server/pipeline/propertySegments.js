export function splitPropertySegments(rawText) {
  const text = String(rawText || '').trim()
  if (!text) return []
  // A plain numbered line is usually a feature/lease-term list, not another
  // property. Split only when the author explicitly labels a room/unit/item.
  const blocks = text.split(/\n(?=(?:ห้อง|unit|รายการ)\s*(?:ที่\s*)?\d+\s*[.)-])/iu).map((item) => item.trim()).filter(Boolean)
  const propertyLike = blocks.filter((block) =>
    /(?:\d+\s*(?:ห้องนอน|bed|br|ตร\.?\s*ม\.?|sqm)|(?:ค่าเช่า|ราคาขาย|฿)\s*\d|\d[\d,]*\s*(?:บาท|thb)\/?เดือน)/iu.test(block),
  )
  return propertyLike.length >= 2 ? propertyLike : [text]
}
