# Owner Listing: Current System Audit

Updated: 2026-08-02

## Current architecture

```text
React Search UI
  -> GET /api/leads/stream (SSE)
  -> existing Facebook session/group/date/cache orchestration
  -> Playwright scraper
  -> lead classifier OR owner-listing classifier
  -> streamed result cards

Owner listing result
  -> explicit AI Extract
  -> content-hash extraction cache
  -> in-memory review draft
  -> human review/correction
  -> explicit confirm_and_save
  -> OwnerListingRepository transaction
  -> existing SQLite tables
```

## Existing Facebook Search

- UI entry point: `src/App.jsx`
- API client: `src/api.js`
- API/SSE orchestration: `server/index.js`
- Playwright collection: `server/scraper.js`
- Browser startup: `server/browserLauncher.js`
- Facebook normalization: `server/adapters/facebookGroupAdapter.js`
- Persistent crawl checkpoints: `server/db/repositories/crawlState.js`

The Owner Listing mode reuses these components. It does not launch a second browser or maintain a second Facebook session.

## Search modes

- `lead` remains the default and retains the previous behavior.
- `owner_listing` classifies posts as owner rental, owner sale, agent, co-agent, multiple listings, irrelevant, or unknown.
- Owner results are the default view; rejected and unknown results remain inspectable.
- Owner mode does not automatically write search results to the property database.

## Extraction and review

- Central contract: `server/pipeline/ownerListingSchema.js`
- Owner classification: `server/pipeline/ownerListingClassifier.js`
- Extraction drafts/cache: `server/services/ownerListingExtractionService.js`
- Review API: `server/routes/ownerListings.js`
- Review UI: `src/components/owner/OwnerListingReviewQueue.jsx`

Every important extracted field carries `value`, `confidence`, `evidence`, and `conflict`. Evidence must be an exact source-text substring. Missing data must remain null or unknown.

## Persistence

- Repository: `server/db/repositories/ownerListings.js`
- Existing database: `server/data/condo-leads.sqlite`
- Existing schema: `server/db/schema.sql`

No database schema was added or changed. Confirmed records use the existing `raw_posts`, `processing_runs`, `post_classifications`, `properties`, `field_evidence`, and `audit_events` tables in one transaction.

Exact duplicate checks use Facebook Post ID, normalized source URL, and content hash. Exact duplicates update the existing raw post's `collected_at`. Possible unit duplicates return to review instead of being merged automatically.

## Isolation boundaries

The implementation does not alter:

- Facebook login/session handling
- Playwright scraping behavior
- group/date selection
- Auto Posting schedules, campaigns, post sets, or posting engine
- the existing database schema

## Tests

Coverage includes:

- schema and evidence validation
- bedroom/layout/room-variant separation
- owner/agent classification
- default Lead mode
- Owner visibility filtering
- per-mode cache namespaces
- extraction content-hash cache and forced extraction
- invalid JSON, timeout, rate limit, empty response paths
- repository create, exact duplicate, last-seen update, validation failure, rollback, and user corrections

At the time of this update, the full suite passes: 39 files and 133 tests.

## Remaining operational risks

- Review drafts are in memory and are lost on server restart.
- The Search API is still concentrated in `server/index.js`; future work should extract orchestration into a service.
- Project Master data is not yet populated, so project resolution remains limited.
- The new Gemini extraction path requires a configured API key and production rate-limit monitoring.
- A durable review queue can be added later using existing database patterns, but should be done as a separate schema migration with rollback planning.
