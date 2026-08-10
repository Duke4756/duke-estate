# Transit reference and crawl-to-database pipeline

## Runtime flow

Facebook posts are committed to `raw_posts` before any classification or AI work. The same transaction creates one active `PROCESS_RAW_POST` job. A background worker atomically claims jobs, records rule classification and listing segments, runs extraction, validates evidence, resolves transit mentions against the local reference directory, and writes `properties` or `review_queue`.

Closing the SSE connection does not cancel database ingestion or queued jobs. `RUNNING` jobs whose lease expires are returned to `RETRY`. Network, timeout and rate-limit failures use exponential backoff; validation failures go to review. Human-confirmed properties are not overwritten automatically.

## Transit reference data

The single version-controlled source is `server/data/transit-reference.js`. Add a station there with its system, line, codes, Thai/English canonical names and verified aliases. Do not add station dictionaries to prompts, matchers or UI files.

Seed data is local and idempotent:

```bash
npm run seed:transit
```

The matcher normalizes punctuation, whitespace and transit prefixes. Exact aliases and canonical names may auto-match. Contextual matching requires an explicit system for road/area-like names. Fuzzy matching requires a score of at least `0.92` and a gap of `0.08` from the next candidate. Ambiguous and unknown mentions keep `station_id = null` and enter review.

Every property transit relation stores the original mention, exact evidence substring, method, confidence, candidates, distance and relation type. `properties.nearby_transit` remains only as a legacy compatibility field and is not authoritative.

## Backfill

Backfill is idempotent and does not overwrite the legacy field or raw text:

```bash
npm run backfill:transit
```

It creates `transit_backfill` audit events once per property. Legacy station strings absent from the raw post create `TRANSIT_STATION_NO_EVIDENCE`; ambiguous and unknown matches create their respective review reasons.

## Running and review

```bash
npm run search-app
npm test -- --run
```

The database UI supports BTS/MRT/ARL and canonical-station filters. Its review section shows source URL/text, evidence, warnings and transit candidates, with Approve, Reprocess and Reject actions. Human actions are recorded in `audit_events`.

Important review reasons include `TRANSIT_STATION_NOT_FOUND`, `TRANSIT_STATION_AMBIGUOUS`, `TRANSIT_STATION_NO_EVIDENCE`, `TRANSIT_STATION_CONFLICT`, `TRANSIT_DISTANCE_CONFLICT`, `POSSIBLE_MULTI_LISTING`, `PROCESSING_VALIDATION_ERROR`, and `PROCESSING_FAILED`.
