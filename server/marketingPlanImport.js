// Resolve missing CDs through the same URL import/save flow as manual import.
export async function importMarketingProperty(cd, { listSets, resolveJsaPropertyUrlByCd, importPostSetFromUrl }) {
  const find = () => listSets().find((set) =>
    `${set.name || ''}\n${set.text || ''}`.toUpperCase().match(/\bCD-\d{6}\b/g)?.includes(cd))
  let postSet
  try { postSet = find() } catch (error) { return { postSet: null, resolve: 'FAILED', import: 'NOT_ATTEMPTED', jsaUrl: null, error: { code: 'STOCK_READ_FAILED', message: error.message } } }
  const result = { resolve: postSet ? 'NOT_REQUIRED' : 'FAILED', jsaUrl: postSet?.sourceUrl || null, import: postSet ? 'NOT_REQUIRED' : 'NOT_ATTEMPTED', error: null }
  if (postSet) return { ...result, postSet }
  try {
    console.info(`[marketing-plan] ${cd} resolve start`)
    result.jsaUrl = await resolveJsaPropertyUrlByCd(cd)
    result.resolve = 'OK'
    console.info(`[marketing-plan] ${cd} resolve OK ${result.jsaUrl}`)
    console.info(`[marketing-plan] ${cd} import start`)
    result.import = 'FAILED'
    await importPostSetFromUrl(result.jsaUrl)
    postSet = find()
    if (!postSet || !postSet.id) {
      throw Object.assign(new Error(`บันทึกแล้วแต่ตรวจไม่พบ Post Set ของ ${cd}`), { code: 'POST_SET_VERIFY_FAILED' })
    }
    result.import = 'OK'
    console.info(`[marketing-plan] ${cd} import OK postSet=${postSet.id}`)
    return { ...result, postSet }
  } catch (error) {
    result.error = { code: error.code || (result.resolve === 'OK' ? 'IMPORT_FAILED' : 'RESOLVE_FAILED'), message: error.message }
    console.info(`[marketing-plan] ${cd} failed code=${result.error.code}`)
    return { ...result, postSet: null }
  }
}

export function marketingPropertyStatus({ postSet, projectSpecific, resolvedProjectId, matchingGroups, placements, requested }) {
  if (!postSet) return 'IMPORT_FAILED'
  if (projectSpecific && !resolvedProjectId) return 'PROJECT_UNRESOLVED'
  if (!matchingGroups.length) return 'NO_MATCHING_GROUP'
  if (placements.length < requested) return 'NO_MEMBER_ACCOUNT'
  return 'READY'
}
