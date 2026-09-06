PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS raw_posts (
  id INTEGER PRIMARY KEY,
  source_adapter TEXT NOT NULL,
  source_post_id TEXT,
  source_url TEXT,
  source_url_normalized TEXT,
  source_group_id TEXT,
  source_group_name TEXT,
  author_name TEXT,
  raw_text TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  source_created_at TEXT,
  collected_at TEXT NOT NULL,
  collector_version TEXT NOT NULL,
  collection_warnings_json TEXT NOT NULL DEFAULT '[]',
  legacy_identity TEXT,
  author_profile_url TEXT,
  media_json TEXT NOT NULL DEFAULT '{}',
  crawl_run_id TEXT,
  raw_snippet TEXT,
  ingestion_status TEXT NOT NULL DEFAULT 'CAPTURED',
  captured_at TEXT,
  deleted_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_raw_source_post ON raw_posts(source_adapter, source_post_id) WHERE source_post_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_raw_url ON raw_posts(source_url_normalized);
CREATE INDEX IF NOT EXISTS idx_raw_hash ON raw_posts(content_hash);
CREATE INDEX IF NOT EXISTS idx_raw_capture_order ON raw_posts(captured_at DESC, collected_at DESC);

CREATE TABLE IF NOT EXISTS raw_post_versions (
  id INTEGER PRIMARY KEY,
  raw_post_id INTEGER NOT NULL REFERENCES raw_posts(id) ON DELETE CASCADE,
  content_hash TEXT NOT NULL,
  raw_text TEXT NOT NULL,
  source_url TEXT,
  captured_at TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  UNIQUE(raw_post_id, content_hash)
);

CREATE TABLE IF NOT EXISTS crawl_runs (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  groups_json TEXT NOT NULL DEFAULT '[]',
  counters_json TEXT NOT NULL DEFAULT '{}',
  started_at TEXT NOT NULL,
  completed_at TEXT,
  last_error TEXT
);

CREATE TABLE IF NOT EXISTS post_processing_jobs (
  id INTEGER PRIMARY KEY,
  raw_post_id INTEGER NOT NULL REFERENCES raw_posts(id) ON DELETE CASCADE,
  job_type TEXT NOT NULL DEFAULT 'PROCESS_RAW_POST',
  status TEXT NOT NULL DEFAULT 'PENDING',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  locked_at TEXT,
  locked_by TEXT,
  started_at TEXT,
  completed_at TEXT,
  next_retry_at TEXT,
  last_error TEXT,
  result_summary TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_jobs_ready ON post_processing_jobs(status, next_retry_at, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_one_active_per_post
  ON post_processing_jobs(raw_post_id, job_type)
  WHERE status IN ('PENDING','RUNNING','RETRY');

CREATE TABLE IF NOT EXISTS raw_post_classifications (
  id INTEGER PRIMARY KEY,
  raw_post_id INTEGER NOT NULL REFERENCES raw_posts(id) ON DELETE CASCADE,
  classification TEXT NOT NULL,
  confidence REAL NOT NULL,
  matched_patterns_json TEXT NOT NULL DEFAULT '[]',
  evidence_json TEXT NOT NULL DEFAULT '[]',
  classifier_version TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(raw_post_id, classifier_version)
);

CREATE TABLE IF NOT EXISTS listing_segments (
  id INTEGER PRIMARY KEY,
  raw_post_id INTEGER NOT NULL REFERENCES raw_posts(id) ON DELETE CASCADE,
  segment_index INTEGER NOT NULL,
  source_text TEXT NOT NULL,
  evidence_start INTEGER NOT NULL,
  evidence_end INTEGER NOT NULL,
  warning TEXT,
  segmenter_version TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(raw_post_id, segment_index, segmenter_version)
);

CREATE TABLE IF NOT EXISTS crawl_seen_posts (
  source_adapter TEXT NOT NULL,
  source_post_id TEXT NOT NULL,
  source_group_key TEXT NOT NULL,
  source_url TEXT,
  content_hash TEXT,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  seen_count INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY(source_adapter, source_post_id)
);
CREATE INDEX IF NOT EXISTS idx_crawl_seen_group ON crawl_seen_posts(source_group_key, last_seen_at);
CREATE INDEX IF NOT EXISTS idx_crawl_seen_hash ON crawl_seen_posts(content_hash);

CREATE TABLE IF NOT EXISTS source_groups (
  id INTEGER PRIMARY KEY,
  platform TEXT NOT NULL DEFAULT 'facebook',
  source_group_id TEXT,
  canonical_url TEXT NOT NULL,
  group_name TEXT,
  group_name_normalized TEXT,
  privacy_type TEXT NOT NULL DEFAULT 'UNKNOWN',
  visibility_type TEXT NOT NULL DEFAULT 'UNKNOWN',
  access_status TEXT NOT NULL DEFAULT 'UNKNOWN',
  authorization_status TEXT NOT NULL DEFAULT 'DISCOVERED',
  authorization_reference TEXT,
  discovered_via TEXT NOT NULL,
  discovered_at TEXT NOT NULL,
  last_verified_at TEXT,
  last_capture_at TEXT,
  last_success_at TEXT,
  latest_checkpoint TEXT,
  oldest_backfill_checkpoint TEXT,
  member_count_estimate INTEGER,
  activity_rate REAL NOT NULL DEFAULT 0,
  relevance_score REAL NOT NULL DEFAULT 0,
  unique_listing_yield REAL NOT NULL DEFAULT 0,
  owner_lead_yield REAL NOT NULL DEFAULT 0,
  duplicate_rate REAL NOT NULL DEFAULT 0,
  failure_rate REAL NOT NULL DEFAULT 0,
  estimated_collection_cost REAL NOT NULL DEFAULT 1,
  next_capture_at TEXT,
  status TEXT NOT NULL DEFAULT 'DISCOVERED',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  tags_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_source_group_platform_id ON source_groups(platform,source_group_id) WHERE source_group_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_source_group_canonical_url ON source_groups(platform,canonical_url);
CREATE INDEX IF NOT EXISTS idx_source_group_schedule ON source_groups(status,authorization_status,access_status,next_capture_at);
CREATE INDEX IF NOT EXISTS idx_source_group_name ON source_groups(group_name_normalized);

CREATE TABLE IF NOT EXISTS group_discovery_events (
  id INTEGER PRIMARY KEY,
  source_group_id INTEGER NOT NULL REFERENCES source_groups(id) ON DELETE CASCADE,
  discovered_via TEXT NOT NULL,
  evidence_text TEXT,
  evidence_url TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  discovered_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_group_discovery_source ON group_discovery_events(source_group_id,discovered_at DESC);

CREATE TABLE IF NOT EXISTS source_metrics (
  source_group_id INTEGER PRIMARY KEY REFERENCES source_groups(id) ON DELETE CASCADE,
  posts_seen INTEGER NOT NULL DEFAULT 0,
  raw_posts_created INTEGER NOT NULL DEFAULT 0,
  raw_posts_updated INTEGER NOT NULL DEFAULT 0,
  duplicate_raw_posts INTEGER NOT NULL DEFAULT 0,
  listing_instances_created INTEGER NOT NULL DEFAULT 0,
  unique_listing_clusters_created INTEGER NOT NULL DEFAULT 0,
  owner_posts_found INTEGER NOT NULL DEFAULT 0,
  agent_posts_found INTEGER NOT NULL DEFAULT 0,
  properties_created INTEGER NOT NULL DEFAULT 0,
  properties_updated INTEGER NOT NULL DEFAULT 0,
  fields_repaired INTEGER NOT NULL DEFAULT 0,
  unresolved_fields INTEGER NOT NULL DEFAULT 0,
  scroll_units_used INTEGER NOT NULL DEFAULT 0,
  processing_duration_ms INTEGER NOT NULL DEFAULT 0,
  ai_calls INTEGER NOT NULL DEFAULT 0,
  ai_cost_estimate REAL NOT NULL DEFAULT 0,
  capture_failures INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS source_crawl_jobs (
  id TEXT PRIMARY KEY,
  source_group_id INTEGER NOT NULL REFERENCES source_groups(id),
  lane TEXT NOT NULL,
  status TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  budget_json TEXT NOT NULL DEFAULT '{}',
  checkpoint_before TEXT,
  checkpoint_after TEXT,
  priority REAL NOT NULL DEFAULT 0,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_retry_at TEXT,
  locked_at TEXT,
  locked_by TEXT,
  started_at TEXT,
  completed_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_source_job_active ON source_crawl_jobs(source_group_id,lane) WHERE status IN ('PENDING','RUNNING','RETRY');
CREATE UNIQUE INDEX IF NOT EXISTS idx_source_job_idempotency ON source_crawl_jobs(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_source_job_ready ON source_crawl_jobs(lane,status,next_retry_at,priority DESC);

CREATE TABLE IF NOT EXISTS source_autopilot_state (
  id INTEGER PRIMARY KEY CHECK(id=1),
  autopilot_enabled INTEGER NOT NULL DEFAULT 0,
  backfill_enabled INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS crawl_group_state (
  source_adapter TEXT NOT NULL,
  source_group_key TEXT NOT NULL,
  completed_runs INTEGER NOT NULL DEFAULT 0,
  last_depth INTEGER NOT NULL DEFAULT 0,
  last_seen_count INTEGER NOT NULL DEFAULT 0,
  last_new_count INTEGER NOT NULL DEFAULT 0,
  total_new_count INTEGER NOT NULL DEFAULT 0,
  last_started_at TEXT,
  last_completed_at TEXT,
  PRIMARY KEY(source_adapter, source_group_key)
);

CREATE TABLE IF NOT EXISTS processing_runs (
  id INTEGER PRIMARY KEY,
  raw_post_id INTEGER NOT NULL REFERENCES raw_posts(id),
  status TEXT NOT NULL,
  pipeline_version TEXT NOT NULL,
  parser_version TEXT NOT NULL,
  prompt_version TEXT,
  model_name TEXT,
  project_dictionary_version TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  duration_ms INTEGER,
  cache_hit INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  error_message TEXT,
  raw_ai_response_json TEXT
);

CREATE TABLE IF NOT EXISTS post_classifications (
  processing_run_id INTEGER PRIMARY KEY REFERENCES processing_runs(id),
  post_intent TEXT NOT NULL,
  confidence REAL NOT NULL,
  evidence_json TEXT NOT NULL DEFAULT '[]',
  warnings_json TEXT NOT NULL DEFAULT '[]',
  requires_review INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  canonical_name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  verified_at TEXT NOT NULL,
  dictionary_version TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_project_canonical ON projects(canonical_name);

CREATE TABLE IF NOT EXISTS project_aliases (
  id INTEGER PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  alias TEXT NOT NULL,
  alias_normalized TEXT NOT NULL,
  alias_type TEXT NOT NULL,
  source TEXT,
  verified INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_project_alias ON project_aliases(alias_normalized);

CREATE TABLE IF NOT EXISTS verified_project_stations (
  id TEXT PRIMARY KEY,
  project_name TEXT NOT NULL,
  station_name TEXT NOT NULL,
  distance_m INTEGER,
  source_url TEXT NOT NULL,
  verified_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS verified_project_station_aliases (
  station_id TEXT NOT NULL REFERENCES verified_project_stations(id) ON DELETE CASCADE,
  alias TEXT NOT NULL COLLATE NOCASE UNIQUE
);

CREATE TABLE IF NOT EXISTS transit_systems (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name_th TEXT NOT NULL,
  name_en TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  data_version TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS transit_lines (
  id TEXT PRIMARY KEY,
  system_id TEXT NOT NULL REFERENCES transit_systems(id),
  code TEXT NOT NULL,
  name_th TEXT NOT NULL,
  name_en TEXT NOT NULL,
  color TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  UNIQUE(system_id, code)
);

CREATE TABLE IF NOT EXISTS transit_stations (
  id TEXT PRIMARY KEY,
  system_id TEXT NOT NULL REFERENCES transit_systems(id),
  canonical_name_th TEXT NOT NULL,
  canonical_name_en TEXT NOT NULL,
  latitude REAL,
  longitude REAL,
  active INTEGER NOT NULL DEFAULT 1,
  metadata_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_transit_station_names ON transit_stations(canonical_name_th, canonical_name_en);

CREATE TABLE IF NOT EXISTS transit_station_lines (
  station_id TEXT NOT NULL REFERENCES transit_stations(id) ON DELETE CASCADE,
  line_id TEXT NOT NULL REFERENCES transit_lines(id) ON DELETE CASCADE,
  station_code TEXT,
  PRIMARY KEY(station_id, line_id),
  UNIQUE(line_id, station_code)
);

CREATE TABLE IF NOT EXISTS transit_station_aliases (
  id INTEGER PRIMARY KEY,
  station_id TEXT NOT NULL REFERENCES transit_stations(id) ON DELETE CASCADE,
  alias TEXT NOT NULL,
  normalized_alias TEXT NOT NULL,
  language TEXT NOT NULL,
  alias_type TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  UNIQUE(station_id, normalized_alias)
);
CREATE INDEX IF NOT EXISTS idx_transit_alias_normalized ON transit_station_aliases(normalized_alias, active);

CREATE TABLE IF NOT EXISTS properties (
  id INTEGER PRIMARY KEY,
  raw_post_id INTEGER NOT NULL REFERENCES raw_posts(id),
  processing_run_id INTEGER NOT NULL REFERENCES processing_runs(id),
  property_index INTEGER NOT NULL,
  transaction_type TEXT NOT NULL,
  property_type TEXT,
  room_type TEXT,
  project_name_raw TEXT,
  project_id TEXT REFERENCES projects(id),
  project_name_canonical TEXT,
  project_match_method TEXT NOT NULL,
  project_match_score REAL,
  project_verified INTEGER NOT NULL DEFAULT 0,
  rent_price_monthly REAL,
  sale_price REAL,
  budget_min REAL,
  budget_max REAL,
  currency TEXT,
  bedrooms REAL,
  bathrooms REAL,
  area_sqm REAL,
  floor REAL,
  building TEXT,
  zone TEXT,
  subdistrict TEXT,
  district TEXT,
  province TEXT,
  nearby_transit TEXT,
  transit_distance_m REAL,
  pet_policy TEXT,
  furnishing TEXT,
  available_date TEXT,
  contact_name TEXT,
  contact_phone TEXT,
  source_role TEXT,
  overall_confidence REAL NOT NULL,
  warnings_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'pending_review',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  UNIQUE(processing_run_id, property_index)
);
CREATE INDEX IF NOT EXISTS idx_properties_filters ON properties(project_id, transaction_type, rent_price_monthly, area_sqm, bedrooms, pet_policy);
CREATE INDEX IF NOT EXISTS idx_properties_review ON properties(status, overall_confidence);
CREATE INDEX IF NOT EXISTS idx_properties_owner_latest ON properties(source_role, deleted_at, created_at DESC);

CREATE TABLE IF NOT EXISTS field_evidence (
  id INTEGER PRIMARY KEY,
  property_id INTEGER NOT NULL REFERENCES properties(id),
  field_name TEXT NOT NULL,
  value_json TEXT,
  quote TEXT NOT NULL,
  confidence REAL NOT NULL,
  validation_status TEXT NOT NULL,
  warning TEXT
);
CREATE INDEX IF NOT EXISTS idx_evidence_property ON field_evidence(property_id);

CREATE TABLE IF NOT EXISTS property_transit_stations (
  id INTEGER PRIMARY KEY,
  property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  station_id TEXT REFERENCES transit_stations(id),
  relation_type TEXT NOT NULL DEFAULT 'mentioned',
  distance_value REAL,
  distance_unit TEXT,
  original_mention TEXT NOT NULL,
  normalized_mention TEXT NOT NULL,
  evidence_text TEXT NOT NULL,
  confidence REAL NOT NULL,
  match_method TEXT NOT NULL,
  match_status TEXT NOT NULL,
  candidates_json TEXT NOT NULL DEFAULT '[]',
  is_primary INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(property_id, original_mention, evidence_text)
);
CREATE INDEX IF NOT EXISTS idx_property_transit_property ON property_transit_stations(property_id, is_primary DESC);
CREATE INDEX IF NOT EXISTS idx_property_transit_station ON property_transit_stations(station_id, property_id);
CREATE INDEX IF NOT EXISTS idx_property_transit_review ON property_transit_stations(match_status, confidence);

CREATE TABLE IF NOT EXISTS extraction_cache (
  content_hash TEXT NOT NULL,
  pipeline_version TEXT NOT NULL,
  project_dictionary_version TEXT NOT NULL,
  result_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_used_at TEXT NOT NULL,
  hit_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(content_hash, pipeline_version, project_dictionary_version)
);

CREATE TABLE IF NOT EXISTS review_queue (
  id INTEGER PRIMARY KEY,
  raw_post_id INTEGER NOT NULL REFERENCES raw_posts(id),
  property_id INTEGER REFERENCES properties(id),
  reason_code TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 50,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL,
  resolved_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_review_status ON review_queue(status, priority DESC, created_at);

CREATE TABLE IF NOT EXISTS property_repair_state (
  property_id INTEGER PRIMARY KEY REFERENCES properties(id) ON DELETE CASCADE,
  raw_content_hash TEXT NOT NULL,
  pipeline_version TEXT NOT NULL,
  reference_version TEXT NOT NULL,
  status TEXT NOT NULL,
  result_json TEXT NOT NULL DEFAULT '{}',
  processed_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_property_repair_status ON property_repair_state(status, processed_at);

-- Canonical demand/lead records. This replaces the former Lead Candidates
-- staging table while keeping the original Facebook post in raw_posts.
CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY,
  raw_post_id INTEGER NOT NULL UNIQUE REFERENCES raw_posts(id),
  lead_code TEXT NOT NULL UNIQUE,
  classification TEXT NOT NULL,
  lead_type TEXT,
  customer_type TEXT NOT NULL DEFAULT 'UNKNOWN',
  status TEXT NOT NULL DEFAULT 'new',
  facebook_name TEXT,
  facebook_profile_url TEXT,
  facebook_group TEXT,
  posted_at TEXT,
  customer_name TEXT,
  phone TEXT,
  line TEXT,
  whatsapp TEXT,
  budget_min REAL,
  budget_max REAL,
  currency TEXT,
  property_type TEXT,
  bedrooms TEXT,
  bathrooms TEXT,
  desired_location TEXT,
  transit_stations TEXT,
  move_in_date TEXT,
  urgency TEXT,
  pets TEXT,
  requirements TEXT,
  confidence_score REAL,
  lead_reason TEXT,
  data_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  saved_at TEXT,
  last_error TEXT
);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_leads_classification ON leads(classification, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_leads_budget ON leads(budget_min, budget_max);

CREATE TABLE IF NOT EXISTS duplicate_groups (
  id INTEGER PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL,
  resolved_at TEXT
);

CREATE TABLE IF NOT EXISTS duplicate_members (
  duplicate_group_id INTEGER NOT NULL REFERENCES duplicate_groups(id),
  property_id INTEGER NOT NULL REFERENCES properties(id),
  match_method TEXT NOT NULL,
  match_score REAL NOT NULL,
  reasons_json TEXT NOT NULL,
  PRIMARY KEY(duplicate_group_id, property_id)
);

CREATE TABLE IF NOT EXISTS listing_clusters (
  id INTEGER PRIMARY KEY,
  canonical_property_id INTEGER REFERENCES properties(id),
  status TEXT NOT NULL DEFAULT 'UNKNOWN',
  freshness_score REAL NOT NULL DEFAULT 0,
  confidence REAL NOT NULL DEFAULT 0,
  match_method TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS listing_cluster_members (
  cluster_id INTEGER NOT NULL REFERENCES listing_clusters(id) ON DELETE CASCADE,
  property_id INTEGER NOT NULL UNIQUE REFERENCES properties(id),
  raw_post_id INTEGER NOT NULL REFERENCES raw_posts(id),
  source_group_key TEXT,
  match_score REAL NOT NULL,
  match_method TEXT NOT NULL,
  evidence_json TEXT NOT NULL DEFAULT '[]',
  price_at_capture REAL,
  joined_at TEXT NOT NULL,
  PRIMARY KEY(cluster_id,property_id)
);
CREATE INDEX IF NOT EXISTS idx_cluster_members_raw ON listing_cluster_members(raw_post_id);
CREATE INDEX IF NOT EXISTS idx_cluster_members_cluster ON listing_cluster_members(cluster_id,joined_at DESC);
CREATE TABLE IF NOT EXISTS cluster_merge_audits (
  id INTEGER PRIMARY KEY,
  cluster_id INTEGER NOT NULL REFERENCES listing_clusters(id),
  action TEXT NOT NULL,
  property_id INTEGER REFERENCES properties(id),
  score REAL,
  evidence_json TEXT NOT NULL DEFAULT '[]',
  actor TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_events (
  id INTEGER PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT,
  actor TEXT NOT NULL,
  created_at TEXT NOT NULL,
  undo_of_event_id INTEGER REFERENCES audit_events(id)
);

-- Chat Guard records coverage only. It deliberately does not retain message
-- bodies or build a second inbox/CRM.
CREATE TABLE IF NOT EXISTS chat_sweeps (
  id INTEGER PRIMARY KEY,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  status TEXT NOT NULL CHECK(status IN ('RUNNING','COMPLETE','INCOMPLETE','FAILED'))
);
CREATE TABLE IF NOT EXISTS chat_checks (
  id INTEGER PRIMARY KEY,
  sweep_id INTEGER NOT NULL REFERENCES chat_sweeps(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL,
  surface TEXT NOT NULL CHECK(surface IN ('inbox','requests','spam','marketplace')),
  status TEXT NOT NULL CHECK(status IN ('OK','EMPTY','FOUND','UNKNOWN','FAILED')),
  checked_at TEXT NOT NULL,
  error_code TEXT,
  error_message TEXT,
  UNIQUE(sweep_id, account_id, surface)
);
CREATE INDEX IF NOT EXISTS idx_chat_checks_sweep ON chat_checks(sweep_id, account_id, surface);
CREATE INDEX IF NOT EXISTS idx_chat_checks_account ON chat_checks(account_id, checked_at DESC);
