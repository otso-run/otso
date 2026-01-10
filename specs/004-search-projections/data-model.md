# Data Model: Search Projections

**Date**: 2025-01-10
**Storage**: SQLite FTS5 + Meilisearch

## Overview

Search projections are derived views built from the event store. They are:
- **Rebuildable**: Can be regenerated from events at any time
- **Incremental**: Updated as new events are committed
- **Consistent**: Both backends process events in the same order
- **Visibility-aware**: Secret events never indexed, private filtered at query time

---

## SQLite FTS5 Schema

Location: `data/otso/search.db`

```sql
-- FTS5 virtual table for full-text search
CREATE VIRTUAL TABLE search_entries USING fts5(
    title,
    content,
    source,
    entry_type,
    action_type,
    object_type,
    category,
    -- Metadata stored but not searchable
    content_rowid UNINDEXED,
    event_id UNINDEXED,
    external_id UNINDEXED,
    url UNINDEXED,
    ts UNINDEXED,
    visibility UNINDEXED,
    year UNINDEXED,
    month UNINDEXED,
    -- Configuration
    tokenize='porter unicode61',
    prefix='2 3 4'
);

-- Mapping table for rowid <-> event_id
CREATE TABLE search_entry_map (
    rowid INTEGER PRIMARY KEY,
    event_id TEXT NOT NULL UNIQUE,
    source TEXT NOT NULL,
    entry_type TEXT NOT NULL,
    ts INTEGER NOT NULL,
    visibility TEXT NOT NULL,
    year INTEGER NOT NULL,
    month TEXT NOT NULL
);

CREATE INDEX idx_entry_map_source ON search_entry_map(source);
CREATE INDEX idx_entry_map_ts ON search_entry_map(ts DESC);
CREATE INDEX idx_entry_map_visibility ON search_entry_map(visibility);
CREATE INDEX idx_entry_map_year_month ON search_entry_map(year, month);

-- Projection state tracking
CREATE TABLE projection_state (
    projection_name TEXT PRIMARY KEY,
    last_event_id TEXT,
    last_updated_at INTEGER,
    entry_count INTEGER DEFAULT 0,
    status TEXT DEFAULT 'healthy',
    error_message TEXT
);
```

---

## Meilisearch Index Configuration

Index name: `otso`

### Index Settings

```json
{
  "displayedAttributes": [
    "id",
    "event_id",
    "source",
    "entry_type",
    "action_type",
    "object_type",
    "title",
    "content",
    "ts",
    "external_id",
    "url",
    "visibility",
    "category",
    "year",
    "month"
  ],
  "searchableAttributes": [
    "title",
    "content",
    "source",
    "entry_type"
  ],
  "filterableAttributes": [
    "source",
    "entry_type",
    "action_type",
    "object_type",
    "category",
    "visibility",
    "year",
    "month"
  ],
  "sortableAttributes": [
    "ts",
    "year"
  ],
  "rankingRules": [
    "words",
    "typo",
    "proximity",
    "attribute",
    "sort",
    "exactness"
  ],
  "distinctAttribute": null,
  "typoTolerance": {
    "enabled": true,
    "minWordSizeForTypos": {
      "oneTypo": 4,
      "twoTypos": 8
    }
  },
  "faceting": {
    "maxValuesPerFacet": 100
  },
  "pagination": {
    "maxTotalHits": 10000
  }
}
```

---

## Rust Types

### SearchEntry

```rust
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchEntry {
    pub id: i64,
    pub event_id: String,
    pub source: String,
    pub entry_type: String,
    pub action_type: String,
    pub object_type: String,
    pub title: String,
    pub content: String,
    pub ts: i64,
    pub external_id: Option<String>,
    pub url: Option<String>,
    pub visibility: String,
    pub category: String,
    pub year: i32,
    pub month: String,  // "YYYY-MM"
}

impl SearchEntry {
    pub fn from_event(event: &Event, id: i64) -> Self {
        let payload = &event.payload;

        SearchEntry {
            id,
            event_id: event.event_id.to_string(),
            source: event.source.clone(),
            entry_type: derive_entry_type(&event),
            action_type: event.action_type.clone().unwrap_or_default(),
            object_type: event.object_type.clone().unwrap_or_default(),
            title: extract_title(payload),
            content: extract_content(payload),
            ts: event.occurred_at,
            external_id: Some(event.source_id.clone()),
            url: extract_url(payload),
            visibility: event.visibility.as_str().to_string(),
            category: derive_category(&event.source, &event.action_type),
            year: timestamp_to_year(event.occurred_at),
            month: timestamp_to_month(event.occurred_at),
        }
    }
}

fn timestamp_to_year(ts: i64) -> i32 {
    chrono::DateTime::from_timestamp(ts, 0)
        .map(|dt| dt.year())
        .unwrap_or(1970)
}

fn timestamp_to_month(ts: i64) -> String {
    chrono::DateTime::from_timestamp(ts, 0)
        .map(|dt| dt.format("%Y-%m").to_string())
        .unwrap_or_else(|| "1970-01".to_string())
}
```

### Projection Trait

```rust
use async_trait::async_trait;

#[async_trait]
pub trait Projection: Send + Sync {
    /// Get projection name
    fn name(&self) -> &str;

    /// Check if projection is healthy
    async fn health_check(&self) -> ProjectionHealth;

    /// Get current entry count
    async fn count(&self) -> Result<i64>;

    /// Full rebuild from event store
    async fn rebuild_full(&self, event_store: &dyn EventStore) -> Result<ProjectionStats>;

    /// Incremental update for committed batch
    async fn on_batch_committed(&self, batch_id: Uuid) -> Result<i64>;

    /// Remove events from rolled-back batch
    async fn on_batch_rolled_back(&self, batch_id: Uuid) -> Result<i64>;

    /// Get last processed event
    async fn last_event_id(&self) -> Result<Option<Uuid>>;
}

#[derive(Debug, Clone)]
pub struct ProjectionHealth {
    pub status: HealthStatus,
    pub entry_count: i64,
    pub last_updated: Option<i64>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HealthStatus {
    Healthy,
    Rebuilding,
    Degraded,
    Error,
}

#[derive(Debug, Default)]
pub struct ProjectionStats {
    pub entries_added: i64,
    pub entries_updated: i64,
    pub entries_removed: i64,
    pub duration_ms: i64,
}
```

---

## FTS5 Projection Implementation

```rust
pub struct Fts5Projection {
    pool: SqlitePool,
    event_store: Arc<dyn EventStore>,
}

#[async_trait]
impl Projection for Fts5Projection {
    fn name(&self) -> &str {
        "fts5"
    }

    async fn rebuild_full(&self, event_store: &dyn EventStore) -> Result<ProjectionStats> {
        let start = Instant::now();
        let mut stats = ProjectionStats::default();

        // Clear existing entries
        sqlx::query("DELETE FROM search_entries").execute(&self.pool).await?;
        sqlx::query("DELETE FROM search_entry_map").execute(&self.pool).await?;

        // Stream projectable events (exclude secret)
        let events = event_store
            .query()
            .projectable_only()
            .stream()
            .await?;

        let mut id = 0i64;
        let mut batch = Vec::with_capacity(BATCH_SIZE);

        while let Some(event) = events.next().await {
            let event = event?;
            id += 1;
            let entry = SearchEntry::from_event(&event, id);
            batch.push(entry);

            if batch.len() >= BATCH_SIZE {
                self.insert_batch(&batch).await?;
                stats.entries_added += batch.len() as i64;
                batch.clear();
            }
        }

        // Insert remaining
        if !batch.is_empty() {
            self.insert_batch(&batch).await?;
            stats.entries_added += batch.len() as i64;
        }

        // Update projection state
        self.update_state(stats.entries_added).await?;

        stats.duration_ms = start.elapsed().as_millis() as i64;
        Ok(stats)
    }

    async fn on_batch_committed(&self, batch_id: Uuid) -> Result<i64> {
        // Get events from this batch
        let events = self.event_store
            .query()
            .batch(batch_id)
            .projectable_only()
            .collect()
            .await?;

        let mut count = 0;
        for event in events {
            let id = self.next_id().await?;
            let entry = SearchEntry::from_event(&event, id);
            self.insert_entry(&entry).await?;
            count += 1;
        }

        Ok(count)
    }

    async fn on_batch_rolled_back(&self, batch_id: Uuid) -> Result<i64> {
        // Get event IDs from this batch
        let event_ids: Vec<String> = self.event_store
            .query()
            .batch(batch_id)
            .include_deleted()
            .collect()
            .await?
            .into_iter()
            .map(|e| e.event_id.to_string())
            .collect();

        // Delete from FTS5
        let placeholders = event_ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
        let query = format!(
            "DELETE FROM search_entries WHERE event_id IN ({})",
            placeholders
        );

        let result = sqlx::query(&query)
            .bind_all(&event_ids)
            .execute(&self.pool)
            .await?;

        Ok(result.rows_affected() as i64)
    }
}
```

---

## Meilisearch Projection Implementation

```rust
pub struct MeilisearchProjection {
    client: MeiliClient,
    index_name: String,
    event_store: Arc<dyn EventStore>,
}

#[async_trait]
impl Projection for MeilisearchProjection {
    fn name(&self) -> &str {
        "meilisearch"
    }

    async fn rebuild_full(&self, event_store: &dyn EventStore) -> Result<ProjectionStats> {
        let start = Instant::now();
        let mut stats = ProjectionStats::default();

        // Create temporary index
        let temp_name = format!("{}_rebuild", self.index_name);
        self.client.create_index(&temp_name, Some("id")).await?;
        let temp_index = self.client.index(&temp_name);

        // Apply settings
        self.apply_settings(&temp_index).await?;

        // Stream projectable events
        let events = event_store
            .query()
            .projectable_only()
            .stream()
            .await?;

        let mut id = 0i64;
        let mut batch = Vec::with_capacity(BATCH_SIZE);

        while let Some(event) = events.next().await {
            let event = event?;
            id += 1;
            let entry = SearchEntry::from_event(&event, id);
            batch.push(entry);

            if batch.len() >= BATCH_SIZE {
                temp_index
                    .add_documents(&batch, Some("id"))
                    .await?
                    .wait_for_completion(&self.client, None, None)
                    .await?;
                stats.entries_added += batch.len() as i64;
                batch.clear();
            }
        }

        // Insert remaining
        if !batch.is_empty() {
            temp_index
                .add_documents(&batch, Some("id"))
                .await?
                .wait_for_completion(&self.client, None, None)
                .await?;
            stats.entries_added += batch.len() as i64;
        }

        // Atomic swap
        self.client
            .swap_indexes(&[(&self.index_name, &temp_name)])
            .await?;

        // Delete old index (now has temp name)
        self.client.index(&temp_name).delete().await?;

        stats.duration_ms = start.elapsed().as_millis() as i64;
        Ok(stats)
    }
}
```

---

## Category Mapping

```rust
pub fn derive_category(source: &str, action_type: &Option<String>) -> String {
    match source {
        "spotify" | "lastfm" | "apple-podcasts" | "apple-music" => "music",
        "safari" | "chrome" | "atlas" => "browse",
        "twitter" | "mastodon" | "bluesky" | "linkedin" => "social",
        "imessage" | "email" | "google-chat" | "slack" => "comms",
        "pinboard" | "readwise" | "arena" => "reading",
        "github" => "code",
        "apple-notes" | "notion" => "notes",
        "apple-photos" | "youtube" => "media",
        "foursquare" => "location",
        "things" | "google-calendar" => "tasks",
        "timing" => "productivity",
        "copilot" | "lunch-money" => "finance",
        "claude" => "ai",
        "apple-health" => "health",
        "shell" => "shell",
        "google-search" => "search",
        _ => "other",
    }
}
```

---

## Entry Type Derivation

```rust
pub fn derive_entry_type(event: &Event) -> String {
    match event.action_type.as_deref() {
        Some("ListenAction") => "listen",
        Some("LikeAction") => "like",
        Some("ViewAction") => "visit",
        Some("BookmarkAction") => "bookmark",
        Some("CommunicateAction") => "message",
        Some("CreateAction") => match event.object_type.as_deref() {
            Some("Note") | Some("NoteDigitalDocument") => "note",
            Some("Photograph") => "photo",
            Some("SocialMediaPosting") => "message",
            _ => "create",
        },
        Some("CheckInAction") => "checkin",
        Some("BuyAction") => "transaction",
        Some("SearchAction") => "search",
        Some("WatchAction") => "watch",
        Some("FollowAction") => "follow",
        Some("ShareAction") => "share",
        _ => "activity",
    }
}
```

---

## Query Interface

```rust
pub struct SearchQuery {
    pub q: String,
    pub sources: Option<Vec<String>>,
    pub categories: Option<Vec<String>>,
    pub entry_types: Option<Vec<String>>,
    pub start_month: Option<String>,
    pub end_month: Option<String>,
    pub visibility: Vec<Visibility>,
    pub limit: i64,
    pub offset: i64,
}

pub struct SearchResult {
    pub entries: Vec<SearchEntry>,
    pub total: i64,
    pub facets: SearchFacets,
    pub duration_ms: i64,
    pub backend: String,  // "fts5" or "meilisearch"
}

pub struct SearchFacets {
    pub sources: Vec<FacetCount>,
    pub categories: Vec<FacetCount>,
    pub entry_types: Vec<FacetCount>,
    pub months: Vec<FacetCount>,
}

pub struct FacetCount {
    pub value: String,
    pub count: i64,
}
```

---

## File Layout

```
data/
└── otso/
    ├── events.db           # Event store
    ├── search.db           # FTS5 projection
    └── meilisearch/        # Meilisearch data (Docker volume)
        └── data.ms/
```
