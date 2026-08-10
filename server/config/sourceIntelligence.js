export const SOURCE_INTELLIGENCE_ENABLED = !['0','false'].includes(String(globalThis.process?.env?.SOURCE_INTELLIGENCE_ENABLED || '1').toLowerCase())

export const SOURCE_TAXONOMY = {
  intent: ['ขาย','ซื้อ','เช่า','ปล่อยเช่า','เจ้าของตรง','owner post','co-agent','for rent','for sale'],
  propertyType: ['คอนโด','บ้าน','ทาวน์โฮม','ที่ดิน','อาคารพาณิชย์','โกดัง','สำนักงาน','condo','house','land','warehouse','office'],
  geography: ['กรุงเทพ','bangkok','สุขุมวิท','sukhumvit','ลาดพร้าว','รัชดา','bts','mrt','arl'],
  audience: ['ไทย','english','chinese','expat','student','pet-friendly','เลี้ยงสัตว์'],
}

export const SCHEDULER_POLICY = {
  weights: { uniqueYield: 4, ownerYield: 2.5, changeRate: 1.5, freshness: 1.2, coverageGap: 2, reliability: 1.5, exploration: 2, cost: 1, failure: 2.5, duplicate: 1.5 },
  freshnessIntervalMinutes: 45,
  inactiveBackoffMinutes: 360,
  maxBackoffMinutes: 1440,
  failurePauseThreshold: 4,
  globalSourceBudget: 12,
  perSourcePageBudget: 12,
  concurrency: 3,
  knownPostStopSteps: 3,
  backfillEnabled: false,
  backfillSourceBudget: 2,
}

export const INVENTORY_FRESHNESS_POLICY = {
  rentLikelyActiveDays: 7, rentStaleDays: 21,
  saleLikelyActiveDays: 30, saleStaleDays: 90,
}
