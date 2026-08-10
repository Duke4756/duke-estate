import { openDatabase } from './index.js'
import { createRawPostRepository } from './repositories/rawPosts.js'
import { createPropertyRepository } from './repositories/properties.js'
import { createProjectRepository } from './repositories/projects.js'
import { createCacheRepository } from './repositories/cache.js'
import { processPost } from '../pipeline/index.js'
import { PIPELINE_VERSION } from '../pipeline/versions.js'
import { TransitStationMatcher } from '../services/transitStationMatcher.js'

export function createPropertyDataService(db = openDatabase()) {
  const rawPosts = createRawPostRepository(db)
  const properties = createPropertyRepository(db)
  const projects = createProjectRepository(db)
  const cache = createCacheRepository(db)
  const transitMatcher = new TransitStationMatcher(db)
  return {
    db,
    async ingest(input, options = {}) {
      const rawPost = rawPosts.upsert(input)
      const hasUserReviewedRecord = !rawPost._created && db.prepare(`
        SELECT 1 FROM properties p
        WHERE p.raw_post_id = ? AND p.deleted_at IS NULL
          AND EXISTS (
            SELECT 1 FROM audit_events a
            WHERE a.entity_type = 'property' AND a.entity_id = CAST(p.id AS TEXT)
              AND a.actor NOT LIKE 'system%'
          )
        LIMIT 1
      `).get(rawPost.id)
      if (hasUserReviewedRecord) {
        return { rawPost, runId: null, propertyIds: [], duplicate: true, preservedUserReview: true }
      }
      const alreadyProcessed = !rawPost._created && !rawPost._contentChanged
        && db.prepare('SELECT 1 FROM processing_runs WHERE raw_post_id = ? AND pipeline_version = ? LIMIT 1')
          .get(rawPost.id, PIPELINE_VERSION)
      if (alreadyProcessed) {
        return { rawPost, runId: null, propertyIds: [], duplicate: true }
      }
      const output = await processPost({
        rawPost: { raw_text: rawPost.raw_text },
        projects: projects.list(),
        cache,
        dictionaryVersion: options.dictionaryVersion || 'manual-v1',
        useAI: options.useAI === true,
        aiOptions: { ...(options.aiOptions || {}), transitMatcher },
      })
      const saved = properties.saveRun({
        rawPostId: rawPost.id,
        result: output.result,
        metadata: output.metadata,
        replacePending: !rawPost._created,
      })
      return { rawPost, ...saved, ...output }
    },
    query: (options) => properties.query(options),
    update: (id, patch, actor) => properties.update(id, patch, actor),
    remove: (id, actor) => properties.softDelete(id, actor),
    undo: (eventId, actor) => properties.undo(eventId, actor),
    listProjects: () => projects.list(),
    listTransitStations: (options) => transitMatcher.listStations(options),
    async extractForRepair(rawText, options = {}) {
      return processPost({
        rawPost: { raw_text: rawText }, projects: projects.list(), cache,
        dictionaryVersion: options.dictionaryVersion || 'ai-repair-v1',
        useAI: options.useAI === true,
        aiOptions: { ...(options.aiOptions || {}), transitMatcher },
      })
    },
    addProject: (input) => projects.add(input),
    close: () => db.close(),
  }
}
