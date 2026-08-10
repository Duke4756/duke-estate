import { openDatabase } from '../db/index.js'
import { seedTransitReference } from '../db/seedTransit.js'

const db = openDatabase()
try { console.log(JSON.stringify(seedTransitReference(db), null, 2)) }
finally { db.close() }
