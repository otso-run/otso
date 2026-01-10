# Data Model: Plugin System Configuration

**Date**: 2025-01-10
**Format**: TOML

## Overview

The plugin system uses TOML configuration files to define data sources. This replaces the hardcoded Rust configuration in Chronicle's `main.rs` (1260 lines of source definitions).

## File Locations

```
data/
├── config/
│   └── sources.toml          # Main source configuration
│
└── plugins/
    ├── chronicle-bluesky/
    │   └── plugin.toml       # Plugin manifest
    ├── chronicle-mastodon/
    │   └── plugin.toml
    └── ...
```

---

## sources.toml Schema

### Root Structure

```toml
# /data/config/sources.toml

# Schema version for forward compatibility
schema_version = "1.0"

# Default values applied to all sources (can be overridden per-source)
[defaults]
visibility_default = "public"
timestamp_format = "auto"      # "auto", "iso8601", "unix", "rfc2822"
batch_size = 10000
enabled = true

# Source definitions
[[sources]]
# ... source configuration
```

### SourceConfig

```toml
[[sources]]
# Required fields
name = "pinboard"                              # Unique identifier
db_path = "pinboard/chronicle/chronicle.db"   # Relative to data/sources/

# Optional fields with defaults
enabled = true                                 # Whether to process
category = "reading"                           # Semantic category
visibility_default = "public"                  # public, unlisted, private

# Queries (at least one required)
[[sources.queries]]
table = "events"
entry_type = "bookmark"
action_type = "BookmarkAction"
object_type = "WebPage"
sql = """
SELECT
    source_id as external_id,
    json_extract(object, '$.name') as title,
    COALESCE(json_extract(object, '$.description'), '') as content,
    end_time as ts_raw,
    json_extract(object, '$.url') as url
FROM events
WHERE type = 'BookmarkAction'
"""

# Optional: Field type validation
[sources.queries.field_mappings]
external_id = { required = true, type = "string" }
title = { required = true, type = "string", max_length = 500 }
content = { required = false, type = "string", max_length = 10000 }
ts_raw = { required = true, type = "timestamp" }
url = { required = false, type = "url" }
```

### AggregationConfig

For high-volume sources (Timing: 2.2M records, Apple Health: 1.5M records):

```toml
[[sources]]
name = "timing"
db_path = "timing/chronicle/chronicle.db"
category = "productivity"

# Aggregation configuration
[sources.aggregation]
strategy = "daily"                    # daily, hourly, unique_per_bucket, first_last
key_fields = ["app_name", "project"]  # Fields to group by
time_bucket = "day"                   # day, hour
retain_count = true                   # Include event_count in aggregated entries

[[sources.queries]]
table = "events"
entry_type = "activity"
action_type = "Action"
object_type = "SoftwareApplication"
sql = """
SELECT
    source_id as external_id,
    json_extract(object, '$.name') as title,
    json_extract(object, '$.description') as content,
    end_time as ts_raw,
    NULL as url,
    json_extract(object, '$.applicationName') as app_name,
    json_extract(object, '$.project.name') as project
FROM events
WHERE type = 'Action'
"""
```

### Aggregation Strategies

| Strategy | Description | Use Case |
|----------|-------------|----------|
| `daily` | Sum/count per day per key | Timing: total hours per app/day |
| `hourly` | Sum/count per hour per key | Health: readings per hour |
| `unique_per_bucket` | Unique values per time bucket | Browser: unique URLs per day |
| `first_last` | First and last values per day | Health: daily min/max |
| `rolling_window` | Recent detailed + older aggregated | Last 30 days detailed |

---

## Rust Plugin Architecture

All extractors are implemented as Rust crates, providing type safety, performance, and a unified toolchain.

### Plugin Crate Structure

```
plugins/
├── otso-bluesky/
│   ├── Cargo.toml
│   └── src/
│       ├── lib.rs           # Extractor implementation
│       ├── config.rs        # Typed configuration struct
│       ├── posts.rs         # Posts extractor
│       ├── likes.rs         # Likes extractor
│       └── follows.rs       # Follows extractor
```

### Cargo.toml Metadata

```toml
# plugins/otso-bluesky/Cargo.toml

[package]
name = "otso-bluesky"
version = "0.1.0"
edition = "2021"

[package.metadata.otso]
source = "bluesky"
description = "Bluesky posts, likes, and follows via AT Protocol"

[package.metadata.otso.extractors]
posts = { type = "api", rate_limit = "15/min", incremental = true }
likes = { type = "api", rate_limit = "15/min", incremental = true }
follows = { type = "api", rate_limit = "15/min", incremental = false }

[package.metadata.otso.schema]
action_types = ["CreateAction", "LikeAction", "FollowAction"]
object_types = ["SocialMediaPosting", "Person"]

[dependencies]
otso-core = { path = "../../packages/otso-indexer" }
reqwest = { version = "0.12", features = ["json"] }
serde = { version = "1.0", features = ["derive"] }
tokio = { version = "1", features = ["full"] }
```

### Extractor Trait

```rust
// In otso-core

pub trait Extractor: Send + Sync {
    type Config: DeserializeOwned;
    type Item: Into<Event>;

    /// Create extractor from configuration
    fn new(config: Self::Config) -> Result<Self> where Self: Sized;

    /// Get the source name
    fn source(&self) -> &str;

    /// Get supported extractor types
    fn extractors(&self) -> Vec<ExtractorInfo>;

    /// Extract items of a specific type
    async fn extract(&self, extractor_type: &str) -> Result<BoxStream<'_, Self::Item>>;

    /// Get cursor for incremental sync
    async fn cursor(&self) -> Option<String>;

    /// Set cursor for resuming
    fn set_cursor(&mut self, cursor: Option<String>);
}
```

### Extractor Types

| Type | Description | Example |
|------|-------------|---------|
| `api` | Real-time API polling | Bluesky, GitHub, Spotify |
| `archive` | Process exported archives | Twitter/X takeout, Google Takeout |
| `local` | Read from local applications | Safari, iMessage, Apple Photos |
| `hybrid` | API with archive fallback | Mastodon (API + export) |

---

## Categories

Semantic categories for grouping sources in the UI:

| Category | Description | Sources |
|----------|-------------|---------|
| `music` | Audio listening | Spotify, Last.fm, Apple Podcasts, Apple Music |
| `browse` | Web browsing | Safari, Chrome, Atlas |
| `social` | Social media | Twitter, Mastodon, Bluesky, LinkedIn |
| `comms` | Communication | iMessage, Email, Google Chat, Slack |
| `reading` | Reading & bookmarks | Pinboard, Readwise, Are.na |
| `code` | Development | GitHub |
| `notes` | Note-taking | Apple Notes, Notion |
| `media` | Photos & video | Apple Photos, YouTube |
| `location` | Check-ins & places | Foursquare |
| `tasks` | Task management | Things 3, Google Calendar |
| `productivity` | Time tracking | Timing |
| `finance` | Transactions | Copilot Money, Lunch Money |
| `ai` | AI conversations | Claude |
| `health` | Health data | Apple Health |
| `shell` | Command history | zsh, bash |
| `search` | Search queries | Google Search |

---

## Entry Types

Entry types produced by queries (maps to UI display):

| Entry Type | Schema.org Action | Description |
|------------|-------------------|-------------|
| `listen` | ListenAction | Music, podcasts |
| `like` | LikeAction | Favorites, stars, hearts |
| `visit` | ViewAction | Page visits, browsing |
| `bookmark` | BookmarkAction | Saved for later |
| `message` | CommunicateAction | Messages, emails |
| `note` | CreateAction | Notes, documents |
| `photo` | CreateAction | Photos taken |
| `task` | CreateAction | Tasks created/completed |
| `event` | ScheduleAction | Calendar events |
| `checkin` | CheckInAction | Location check-ins |
| `activity` | Action | Generic activity |
| `transaction` | BuyAction | Purchases |
| `conversation` | CreateAction | AI chat sessions |
| `command` | Action | Shell commands |
| `search` | SearchAction | Search queries |
| `watch` | WatchAction | Video viewing |
| `follow` | FollowAction | Following users |
| `share` | ShareAction | Sharing content |

---

## Validation Rules

### sources.toml Validation

1. **Syntax**: TOML must parse without errors
2. **Required Fields**: `name`, `db_path`, and at least one query
3. **Unique Names**: No duplicate source names
4. **Valid Paths**: `db_path` must be a valid relative path (file existence checked at runtime)
5. **SQL Syntax**: Queries must be valid SQL (parsed, not executed)
6. **Known Types**: `entry_type`, `action_type`, `object_type` must be from known sets
7. **Aggregation**: If defined, `strategy` must be valid, `key_fields` must match query columns

### Plugin Crate Validation

1. **Cargo.toml**: Must parse without errors
2. **Metadata**: `[package.metadata.otso]` section required
3. **Extractor Trait**: Crate must implement `Extractor` trait
4. **Compile**: Crate must compile without errors
5. **Rate Limits**: Must be in format `N/unit` (e.g., "15/min", "100/hour")

---

## Complete Example

### sources.toml (Excerpt)

```toml
schema_version = "1.0"

[defaults]
visibility_default = "public"
timestamp_format = "auto"
batch_size = 10000

# --- Music Sources ---

[[sources]]
name = "spotify"
db_path = "spotify/chronicle/chronicle.db"
category = "music"

[[sources.queries]]
table = "events"
entry_type = "listen"
action_type = "ListenAction"
object_type = "MusicRecording"
sql = """
SELECT
    source_id as external_id,
    json_extract(object, '$.name') as title,
    json_extract(object, '$.byArtist[0].name') as content,
    end_time as ts_raw,
    json_extract(object, '$.url') as url
FROM events
WHERE type = 'ListenAction'
"""

[[sources.queries]]
table = "events"
entry_type = "like"
action_type = "LikeAction"
object_type = "MusicRecording"
sql = """
SELECT
    source_id as external_id,
    json_extract(object, '$.name') as title,
    json_extract(object, '$.byArtist[0].name') as content,
    end_time as ts_raw,
    json_extract(object, '$.url') as url
FROM events
WHERE type = 'LikeAction'
"""

# --- High-Volume Sources ---

[[sources]]
name = "timing"
db_path = "timing/chronicle/chronicle.db"
category = "productivity"

[sources.aggregation]
strategy = "daily"
key_fields = ["app_name"]
time_bucket = "day"

[[sources.queries]]
table = "events"
entry_type = "activity"
action_type = "Action"
object_type = "SoftwareApplication"
sql = """
SELECT
    source_id as external_id,
    json_extract(object, '$.applicationName') as title,
    CAST(json_extract(object, '$.duration') AS INTEGER) as duration,
    end_time as ts_raw,
    NULL as url,
    json_extract(object, '$.applicationName') as app_name
FROM events
"""

# --- Social Sources ---

[[sources]]
name = "bluesky"
db_path = "bluesky/chronicle/chronicle.db"
category = "social"
# Note: Uses chronicle-bluesky plugin for extraction

[[sources.queries]]
table = "events"
entry_type = "message"
action_type = "CreateAction"
object_type = "SocialMediaPosting"
sql = """
SELECT
    source_id as external_id,
    json_extract(object, '$.text') as title,
    json_extract(object, '$.text') as content,
    end_time as ts_raw,
    json_extract(object, '$.url') as url
FROM events
WHERE type = 'CreateAction'
"""

[[sources.queries]]
entry_type = "like"
action_type = "LikeAction"
object_type = "SocialMediaPosting"
table = "events"
sql = """
SELECT
    source_id as external_id,
    json_extract(object, '$.text') as title,
    '' as content,
    end_time as ts_raw,
    json_extract(object, '$.url') as url
FROM events
WHERE type = 'LikeAction'
"""
```

---

## Migration Notes

### From Chronicle main.rs

The current Chronicle indexer has source configurations in:
- `/tools/search-indexer/src/main.rs` (lines 100-695)

To migrate:
1. Extract each `SourceConfig` struct to TOML format
2. Preserve the SQL queries exactly
3. Add missing `action_type` and `object_type` where inferred
4. Add aggregation config for Timing and Apple Health
5. Validate against source databases

### Schema Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2025-01-10 | Initial schema |
