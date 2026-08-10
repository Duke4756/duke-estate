export const GROUP_SETS = [
  { id: 'general', label: 'ทั่วไป' },
  { id: 'pet', label: '🐾 เลี้ยงสัตว์ได้' },
  { id: 'owner', label: 'เจ้าของโดยตรง' },
  { id: 'sale', label: 'ซื้อ / ขาย' },
  { id: 'custom', label: 'กำหนดเอง' },
]

export function groupSetLabel(id) {
  return GROUP_SETS.find((set) => set.id === id)?.label || id || 'ทั่วไป'
}

// Select a reusable group set while preserving the per-post safety limit used
// by "selected" mode. Random mode may keep the whole set as its candidate pool.
export function selectGroupSet(library, setId, mode = 'random') {
  const urls = (library || [])
    .filter((group) => group.active !== false && group.category === setId)
    .map((group) => group.url)
  return mode === 'selected' ? urls.slice(0, 3) : urls
}
