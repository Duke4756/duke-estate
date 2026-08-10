export function createCoverageEstimator(db) {
  return {
    estimate() {
      const sources = db.prepare(`SELECT sg.*,sm.raw_posts_created,sm.unique_listing_clusters_created FROM source_groups sg LEFT JOIN source_metrics sm ON sm.source_group_id=sg.id`).all()
      const segments = new Map()
      for (const source of sources) {
        const tags = safeJson(source.tags_json)
        const axes = [tags.geography || ['ไม่ระบุพื้นที่'], tags.propertyType || ['ไม่ระบุประเภท'], tags.intent || ['ไม่ระบุเป้าหมาย'], tags.audience || ['ไม่ระบุกลุ่มลูกค้า']]
        for (const key of cartesian(axes)) {
          const segment = segments.get(key) || { key, discoveredSources: 0, authorizedSources: 0, activeSources: 0, uniqueListings: 0 }
          segment.discoveredSources += 1
          segment.authorizedSources += Number(source.authorization_status === 'AUTHORIZED')
          segment.activeSources += Number(source.status === 'ACTIVE')
          segment.uniqueListings += Number(source.unique_listing_clusters_created || 0)
          segments.set(key, segment)
        }
      }
      const rows = [...segments.values()].map((segment) => ({
        ...segment,
        gapScore: round(Math.min(1, 1 / (1 + segment.activeSources) + Number(segment.uniqueListings === 0) * 0.25)),
        confidence: segment.activeSources >= 3 ? 'medium' : 'low',
      })).sort((a, b) => b.gapScore - a.gapScore)
      const counts = db.prepare(`SELECT COUNT(*) discovered,SUM(authorization_status='AUTHORIZED') authorized,SUM(access_status='ACCESSIBLE') accessible,SUM(status='ACTIVE') active,SUM(status IN ('PAUSED','INACCESSIBLE','ERROR')) unavailable FROM source_groups`).get()
      return {
        generatedAt: new Date().toISOString(), counts, segments: rows,
        methodology: 'heuristic_source_diversity_and_unique_yield',
        disclaimer: 'เป็นค่าประมาณจากแหล่งที่ค้นพบและได้รับสิทธิ์ ไม่ใช่ coverage ของ Facebook ทั้งหมด',
      }
    },
  }
}

function cartesian(axes) { return axes.reduce((sets, values) => sets.flatMap((set) => values.map((value) => [...set, value])), [[]]).map((values) => values.join(' × ')) }
function safeJson(value) { try { return JSON.parse(value || '{}') } catch { return {} } }
function round(value) { return Math.round(value * 1000) / 1000 }
