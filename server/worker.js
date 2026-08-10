import dotenv from 'dotenv'
import { createPropertyDataService } from './db/service.js'
import { PostProcessingQueue } from './services/postProcessingQueue.js'

dotenv.config()
const propertyData = createPropertyDataService()
const queue = new PostProcessingQueue({
  db: propertyData.db,
  processor: (rawPost) => propertyData.ingest(rawPost, { useAI: Boolean(process.env.GEMINI_API_KEY) }),
})

queue.on('event', (event) => console.log(JSON.stringify(event)))
queue.recoverStaleJobs()
await queue.runAvailable()
const poll = setInterval(() => queue.runAvailable().catch((error) => console.error(error)), 2_000)

for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  clearInterval(poll)
  propertyData.close()
  process.exit(0)
})
