// Resolve missing CDs through the same URL import/save flow as manual import.
export async function importMarketingProperty(cd, { listSets, resolveJsaPropertyUrlByCd, importPostSetFromUrl }) {
  const find = () => listSets().find((set) =>
    `${set.name || ''}\n${set.text || ''}`.toUpperCase().match(/\bCD-\d{6}\b/g)?.includes(cd))
  let postSet = find()
  const result = { resolve: postSet ? 'NOT_REQUIRED' : 'FAILED', jsaUrl: postSet?.sourceUrl || null, import: postSet ? 'NOT_REQUIRED' : 'NOT_ATTEMPTED', error: null }
  if (postSet) return { ...result, postSet }
  try {
    result.jsaUrl = await resolveJsaPropertyUrlByCd(cd)
    result.resolve = 'OK'
    result.import = 'FAILED'
    const saved = await importPostSetFromUrl(result.jsaUrl)
    postSet = find()
    if (!postSet || postSet.id !== saved.postset?.id) {
      throw Object.assign(new Error(`บันทึกแล้วแต่ตรวจไม่พบ Post Set ของ ${cd}`), { code: 'POST_SET_VERIFY_FAILED' })
    }
    result.import = 'OK'
    return { ...result, postSet }
  } catch (error) {
    result.error = { code: error.code || (result.resolve === 'OK' ? 'IMPORT_FAILED' : 'RESOLVE_FAILED'), message: error.message }
    return { ...result, postSet: null }
  }
}
