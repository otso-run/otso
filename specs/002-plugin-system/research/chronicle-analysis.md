# Chronicle Plugin System Analysis

**Date**: 2025-01-10
**Purpose**: Analyze Chronicle's current plugin and source configuration patterns to inform Otso's improved architecture.

## Overview

Chronicle uses a two-tier system for data sources:
1. **Ruby Plugins** (chronicle-etl): Handle extraction from APIs and local applications
2. **Rust Indexer**: Reads SQLite databases and builds search indexes

This analysis covers both components to understand the current patterns and identify improvements.

---

## Ruby Plugin Architecture

### Plugin Structure

Each Chronicle plugin follows the chronicle-etl gem pattern:

```
chronicle-<name>/
├── chronicle-<name>.gemspec     # Gem specification
├── lib/
│   └── chronicle/
│       └── <name>/
│           ├── version.rb        # Version constant
│           ├── <name>_extractor.rb  # Base extractor class
│           ├── <type>_extractor.rb  # Type-specific extractors
│           └── <type>_transformer.rb # Transform to Chronicle schema
```

### Extractor Pattern

From `chronicle-bluesky/posts_extractor.rb`:

```ruby
class PostsExtractor < BlueskyExtractor
  register_connector do |r|
    r.source = :bluesky
    r.type = :post
    r.strategy = :api
    r.description = 'Bluesky posts via AT Protocol API'
  end

  def prepare
    super
    @posts = []
    load_posts
  end

  def results_count
    @posts.count
  end

  def extract
    @posts.each do |post|
      yield build_extraction(data: post)
    end
  end
end
```

**Key Patterns:**
- `register_connector`: Declares source, type, strategy
- `prepare`: Initialize and load data
- `extract`: Yield each record to the pipeline
- `results_count`: Report total for progress

### Current Plugins Inventory

| Plugin | Source Types | Strategy | Description |
|--------|--------------|----------|-------------|
| chronicle-bluesky | posts, likes, follows | api | AT Protocol API |
| chronicle-mastodon | posts, likes, follows | api | Mastodon API |
| chronicle-twitter | posts, likes | archive | Twitter/X takeout |
| chronicle-lastfm | scrobbles, loved | api | Last.fm API |
| chronicle-email | messages | local | Mail.app SQLite |
| chronicle-shell | commands | local | zsh history file |
| chronicle-apple-podcasts | listens | local | Podcasts.db |
| chronicle-apple-notes | notes | local | Notes SQLite |
| chronicle-apple-photos | photos | local | Photos Library |
| chronicle-apple-health | readings | local | HealthKit export |
| chronicle-things | tasks | local | Things 3 SQLite |
| chronicle-readwise | highlights | api | Readwise API |
| chronicle-timing | activities | local | Timing.app SQLite |
| chronicle-notion | pages | api | Notion API |
| chronicle-arena | blocks | api | Are.na API |
| chronicle-atlas | visits | local | Atlas browser history |

### Plugin Dependencies

All plugins depend on `chronicle-etl` gem which provides:
- Extractor base classes
- Transformer pipeline
- Loader (output to SQLite)
- Configuration management
- Rate limiting utilities

---

## Rust Indexer Architecture

### Current Source Configuration

From `/tools/search-indexer/src/main.rs` (1260 lines):

```rust
fn get_source_configs() -> Vec<SourceConfig> {
    vec![
        SourceConfig {
            name: "pinboard",
            db_path: "pinboard/chronicle/chronicle.db",
            queries: vec![SourceQuery {
                table: "events",
                entry_type: "bookmark",
                sql: r#"
                    SELECT
                        source_id as external_id,
                        json_extract(object, '$.name') as title,
                        COALESCE(json_extract(object, '$.description'), '') as content,
                        end_time as ts_raw,
                        json_extract(object, '$.url') as url
                    FROM events
                    WHERE type = 'BookmarkAction'
                "#,
            }],
        },
        // ... 49 more sources
    ]
}
```

### Issues Identified

1. **Hardcoded Configuration (Critical)**
   - All 50 sources defined in Rust code
   - Adding/modifying requires recompilation
   - ~600 lines just for source definitions

2. **No Validation**
   - SQL syntax errors only found at runtime
   - Missing tables cause panics
   - Type mismatches not caught

3. **No Schema Enforcement**
   - Some sources use `events` table with Chronicle schema
   - Others use custom tables with different column names
   - No validation that output matches expected format

4. **No Aggregation**
   - High-volume sources indexed as-is (2.2M Timing records)
   - No option to aggregate or deduplicate

5. **Brittle Timestamp Parsing**
   - 15+ different date format handlers
   - Returns `None` for unparseable (loses data)
   - No error reporting

### Source Categories in Indexer

| Category | Sources |
|----------|---------|
| Chronicle Schema | pinboard, readwise, things, spotify, github, safari |
| Custom Schema | claude, linkedin, copilot, foursquare |
| Google Takeout | search, chrome, youtube, chat, calendar, photos |
| Social | twitter, mastodon, bluesky |
| Local Apps | imessage, email, apple-notes, apple-photos |

---

## Data Flow Analysis

```
┌──────────────────────────────────────────────────────────────────┐
│                     EXTRACTION LAYER                              │
│                                                                   │
│  Ruby Plugins (chronicle-etl)                                     │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐               │
│  │ Bluesky API │  │ Mastodon    │  │ Last.fm     │  (API-based)  │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘               │
│         │                 │                 │                      │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐               │
│  │ iMessage    │  │ Apple Notes │  │ Things 3    │  (Local DBs)  │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘               │
│         │                 │                 │                      │
│  Python Scripts (manual transforms)                               │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐               │
│  │ Spotify     │  │ Google      │  │ Apple       │  (Archives)   │
│  │ Export      │  │ Takeout     │  │ Health      │               │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘               │
└─────────│──────────────────│─────────────────│───────────────────┘
          │                  │                 │
          ▼                  ▼                 ▼
    ┌─────────────────────────────────────────────────┐
    │  data/<source>/chronicle/chronicle.db            │
    │  (Per-source SQLite with Chronicle schema)       │
    └──────────────────────┬──────────────────────────┘
                           │
                           ▼
    ┌─────────────────────────────────────────────────┐
    │  RUST INDEXER (search-indexer)                   │
    │  - Hardcoded source configs                      │
    │  - SQL queries per source                        │
    │  - Builds FTS5 + Meilisearch indexes            │
    └──────────────────────┬──────────────────────────┘
                           │
              ┌────────────┴────────────┐
              ▼                         ▼
    ┌─────────────────┐       ┌─────────────────┐
    │ SQLite FTS5     │       │ Meilisearch     │
    │ (offline)       │       │ (primary)       │
    └─────────────────┘       └─────────────────┘
```

---

## Improvement Opportunities

### 1. External Configuration

**Current**: Source configs embedded in Rust code
**Proposed**: TOML configuration files

Benefits:
- No recompilation for source changes
- Easier to add/modify sources
- Validation before runtime
- Version controlled separately

### 2. Plugin Manifest

**Current**: Ruby gemspecs describe plugins, but no machine-readable capabilities
**Proposed**: `plugin.toml` manifest

Benefits:
- Discoverable plugin capabilities
- Credential requirements documented
- Rate limits explicitly declared
- Schema types documented

### 3. Schema Validation

**Current**: No validation of source output
**Proposed**: Field mappings with type enforcement

Benefits:
- Catch errors early
- Consistent output format
- Clear documentation of expected schema

### 4. Aggregation Strategies

**Current**: All records indexed as-is
**Proposed**: Configurable aggregation per source

Benefits:
- Reduce Timing from 2.2M to ~50K
- Reduce Apple Health from 1.5M to ~100K
- Faster search, smaller index

### 5. Unified Event Store

**Current**: Per-source SQLite databases, indexer reads all
**Proposed**: Unified event store with batch transactions

Benefits:
- Cross-source queries possible
- Transaction support for rollback
- Single source of truth

---

## Migration Path

### Phase 1: Extract Source Configs
1. Parse existing Rust source configs
2. Generate `sources.toml` with equivalent definitions
3. Modify indexer to load from TOML
4. Validate against existing databases

### Phase 2: Add Validation
1. Implement SQL syntax validation
2. Add field mapping validation
3. Report errors with suggestions

### Phase 3: Add Aggregation
1. Implement aggregation strategies
2. Configure for Timing, Apple Health
3. Verify reduced record counts

### Phase 4: Plugin Manifests
1. Create `plugin.toml` for each Ruby plugin
2. Implement manifest loader
3. Add capability discovery

---

## Source Statistics

| Source | Records | Index Status | Notes |
|--------|---------|--------------|-------|
| timing | 2,200,000 | ⚠️ Needs aggregation | 97% reduction possible |
| apple-health | 1,500,000 | ⚠️ Needs aggregation | 93% reduction possible |
| email | 461,000 | ❌ Not indexed | Too large for search |
| lastfm | 160,000 | ✅ Indexed | 20 years of scrobbles |
| google-search | 65,000 | ✅ Indexed | Search queries |
| chrome | 61,000 | ✅ Indexed | Browser history |
| apple-photos | 57,000 | ✅ Indexed | Photo metadata |
| pinboard | 52,000 | ✅ Indexed | Bookmarks |
| github | ~50,000 | ✅ Indexed | Commits, stars, issues |
| spotify | ~40,000 | ✅ Indexed | Listening history |
| others | ~300,000 | ✅ Indexed | Combined |

**Total**: ~5,000,000 records
**Indexed**: ~1,300,000 records (after excluding email)
**After aggregation**: ~400,000 records (estimated)

---

## Recommendations

1. **Start with sources.toml**: Extract all 50 source configs first
2. **Add validation layer**: Catch errors before indexing
3. **Implement aggregation**: Critical for performance
4. **Rewrite extractors in Rust**: Replace Ruby plugins with Rust crates implementing `Extractor` trait
5. **Unified event store**: Enables transactions and cross-source queries

---

## Decision: Rust-Only Architecture

Chronicle uses Ruby (chronicle-etl) for extraction plugins. For Otso, we will use **Rust for all extractors**.

### Rationale

1. **Unified Toolchain**: Single language for entire data pipeline
2. **Type Safety**: Compile-time checks for configuration and data types
3. **Performance**: Native code for all operations
4. **Deployment**: Single binary, no Ruby runtime needed
5. **Maintenance**: One ecosystem to manage

### Migration Approach

Each Ruby plugin will be rewritten as a Rust crate:

| Ruby Plugin | Rust Crate | Priority |
|-------------|------------|----------|
| chronicle-bluesky | otso-bluesky | High (API, active) |
| chronicle-mastodon | otso-mastodon | High (API, active) |
| chronicle-lastfm | otso-lastfm | Medium (API) |
| chronicle-github | otso-github | Medium (API) |
| chronicle-shell | otso-shell | Low (local file) |
| chronicle-email | otso-email | Low (local SQLite) |
| chronicle-apple-* | otso-apple | Low (local SQLite) |
| chronicle-timing | otso-timing | Low (local SQLite) |

Note: Some sources (Spotify, Google Takeout) currently use Python scripts for archive processing. These will also be converted to Rust.
