# Data Model: Event Store

**Date**: 2025-01-10
**Storage**: SQLite (with WAL mode)
**Location**: `data/otso/events.db`

## Overview

The event store is a unified, append-only log of all data events. It replaces Chronicle's per-source database isolation with a single transactional store that supports batch operations and rollback.

---

## SQLite Schema

### events table

```sql
-- Core event log (append-only)
CREATE TABLE events (
    event_id TEXT PRIMARY KEY,
    event_type TEXT NOT NULL CHECK(event_type IN ('ingest', 'update', 'delete')),
    source TEXT NOT NULL,
    source_id TEXT NOT NULL,
    action_type TEXT,
    object_type TEXT,
    payload TEXT NOT NULL,  -- JSON
    visibility TEXT DEFAULT 'public'
        CHECK(visibility IN ('public', 'unlisted', 'private', 'secret')),
    occurred_at INTEGER NOT NULL,
    ingested_at INTEGER NOT NULL,
    batch_id TEXT,
    deleted_at INTEGER,

    -- Prevent duplicate events
    UNIQUE(source, source_id, event_type)
);

-- Indexes for common query patterns
CREATE INDEX idx_events_source ON events(source, source_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_events_occurred ON events(occurred_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_events_visibility ON events(visibility) WHERE deleted_at IS NULL;
CREATE INDEX idx_events_batch ON events(batch_id) WHERE batch_id IS NOT NULL;
CREATE INDEX idx_events_type ON events(action_type, object_type) WHERE deleted_at IS NULL;
CREATE INDEX idx_events_source_time ON events(source, occurred_at DESC) WHERE deleted_at IS NULL;
```

### batches table

```sql
-- Batch tracking for transactions
CREATE TABLE batches (
    batch_id TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    extractor TEXT,  -- Which extractor produced this batch
    started_at INTEGER NOT NULL,
    completed_at INTEGER,
    event_count INTEGER DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK(status IN ('pending', 'committed', 'rolled_back')),
    error_message TEXT
);

CREATE INDEX idx_batches_status ON batches(status);
CREATE INDEX idx_batches_source ON batches(source, started_at DESC);
```

### sync_state table

```sql
-- Track sync progress per source
CREATE TABLE sync_state (
    source TEXT PRIMARY KEY,
    extractor TEXT,
    last_cursor TEXT,
    last_sync_at INTEGER,
    total_events INTEGER DEFAULT 0,
    last_error TEXT,
    retry_count INTEGER DEFAULT 0,
    next_retry_at INTEGER
);
```

### schema_version table

```sql
-- Track schema migrations
CREATE TABLE schema_version (
    version INTEGER PRIMARY KEY,
    applied_at INTEGER NOT NULL,
    description TEXT
);

-- Initial version
INSERT INTO schema_version (version, applied_at, description)
VALUES (1, strftime('%s', 'now'), 'Initial event store schema');
```

---

## Rust Types

### Event

```rust
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Event {
    pub event_id: Uuid,
    pub event_type: EventType,
    pub source: String,
    pub source_id: String,
    pub action_type: Option<String>,
    pub object_type: Option<String>,
    pub payload: serde_json::Value,
    pub visibility: Visibility,
    pub occurred_at: i64,
    pub ingested_at: i64,
    pub batch_id: Option<Uuid>,
    pub deleted_at: Option<i64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EventType {
    Ingest,
    Update,
    Delete,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Visibility {
    Public,
    Unlisted,
    Private,
    Secret,
}

impl Visibility {
    /// Whether this event should be indexed in search
    pub fn is_searchable(&self) -> bool {
        matches!(self, Visibility::Public | Visibility::Unlisted)
    }

    /// Whether this event should be included in projections
    pub fn should_project(&self) -> bool {
        !matches!(self, Visibility::Secret)
    }
}
```

### Batch

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Batch {
    pub batch_id: Uuid,
    pub source: String,
    pub extractor: Option<String>,
    pub started_at: i64,
    pub completed_at: Option<i64>,
    pub event_count: i64,
    pub status: BatchStatus,
    pub error_message: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BatchStatus {
    Pending,
    Committed,
    RolledBack,
}
```

### SyncState

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncState {
    pub source: String,
    pub extractor: Option<String>,
    pub last_cursor: Option<String>,
    pub last_sync_at: Option<i64>,
    pub total_events: i64,
    pub last_error: Option<String>,
    pub retry_count: i32,
    pub next_retry_at: Option<i64>,
}
```

---

## Transaction API

### EventStore trait

```rust
use async_trait::async_trait;
use futures::stream::BoxStream;

#[async_trait]
pub trait EventStore: Send + Sync {
    /// Begin a new batch transaction
    async fn begin_batch(&self, source: &str) -> Result<Transaction>;

    /// Append event to current transaction
    async fn append(&self, tx: &Transaction, event: Event) -> Result<()>;

    /// Commit transaction
    async fn commit(&self, tx: Transaction) -> Result<BatchStats>;

    /// Rollback transaction
    async fn rollback(&self, tx: Transaction) -> Result<()>;

    /// Query events
    fn query(&self) -> EventQuery;

    /// Get sync state for source
    async fn get_sync_state(&self, source: &str) -> Result<Option<SyncState>>;

    /// Update sync state
    async fn update_sync_state(&self, state: SyncState) -> Result<()>;

    /// Recover pending batches (call on startup)
    async fn recover_pending(&self) -> Result<Vec<Uuid>>;

    /// Rollback a specific batch
    async fn rollback_batch(&self, batch_id: Uuid) -> Result<i64>;
}

pub struct Transaction {
    batch_id: Uuid,
    source: String,
    started_at: i64,
    event_count: AtomicI64,
}

pub struct BatchStats {
    pub batch_id: Uuid,
    pub inserted: i64,
    pub updated: i64,
    pub skipped: i64,
    pub duration_ms: i64,
}
```

### EventQuery builder

```rust
pub struct EventQuery<'a> {
    store: &'a dyn EventStore,
    sources: Option<Vec<String>>,
    visibility: Option<Vec<Visibility>>,
    occurred_after: Option<i64>,
    occurred_before: Option<i64>,
    limit: Option<i64>,
    offset: Option<i64>,
    include_deleted: bool,
}

impl<'a> EventQuery<'a> {
    pub fn source(mut self, source: &str) -> Self {
        self.sources.get_or_insert_with(Vec::new).push(source.to_string());
        self
    }

    pub fn visibility_in(mut self, vis: &[Visibility]) -> Self {
        self.visibility = Some(vis.to_vec());
        self
    }

    pub fn searchable_only(self) -> Self {
        self.visibility_in(&[Visibility::Public, Visibility::Unlisted])
    }

    pub fn projectable_only(self) -> Self {
        self.visibility_in(&[Visibility::Public, Visibility::Unlisted, Visibility::Private])
    }

    pub fn occurred_between(mut self, start: i64, end: i64) -> Self {
        self.occurred_after = Some(start);
        self.occurred_before = Some(end);
        self
    }

    pub fn limit(mut self, limit: i64) -> Self {
        self.limit = Some(limit);
        self
    }

    pub fn include_deleted(mut self) -> Self {
        self.include_deleted = true;
        self
    }

    pub async fn count(&self) -> Result<i64> { ... }

    pub async fn stream(&self) -> Result<BoxStream<'_, Event>> { ... }

    pub async fn collect(&self) -> Result<Vec<Event>> { ... }
}
```

---

## Recovery Protocol

On startup, the event store recovers from incomplete operations:

```rust
impl SqliteEventStore {
    pub async fn recover(&self) -> Result<RecoveryReport> {
        let mut report = RecoveryReport::default();

        // Find pending batches
        let pending = sqlx::query_as::<_, Batch>(
            "SELECT * FROM batches WHERE status = 'pending'"
        )
        .fetch_all(&self.pool)
        .await?;

        for batch in pending {
            // Roll back events from this batch
            let deleted = self.rollback_batch(batch.batch_id).await?;

            report.recovered_batches.push(RecoveredBatch {
                batch_id: batch.batch_id,
                source: batch.source,
                events_rolled_back: deleted,
            });
        }

        Ok(report)
    }
}

#[derive(Debug, Default)]
pub struct RecoveryReport {
    pub recovered_batches: Vec<RecoveredBatch>,
    pub total_events_rolled_back: i64,
}

#[derive(Debug)]
pub struct RecoveredBatch {
    pub batch_id: Uuid,
    pub source: String,
    pub events_rolled_back: i64,
}
```

---

## Deduplication

Events are deduplicated by (source, source_id, event_type):

```rust
impl SqliteEventStore {
    pub async fn append(&self, tx: &Transaction, event: Event) -> Result<()> {
        // Use INSERT OR IGNORE for deduplication
        sqlx::query(r#"
            INSERT OR IGNORE INTO events (
                event_id, event_type, source, source_id,
                action_type, object_type, payload, visibility,
                occurred_at, ingested_at, batch_id
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
        "#)
        .bind(event.event_id.to_string())
        .bind(event.event_type.as_str())
        .bind(&event.source)
        .bind(&event.source_id)
        .bind(&event.action_type)
        .bind(&event.object_type)
        .bind(event.payload.to_string())
        .bind(event.visibility.as_str())
        .bind(event.occurred_at)
        .bind(event.ingested_at)
        .bind(tx.batch_id.to_string())
        .execute(&self.pool)
        .await?;

        // Check if insert happened or was ignored
        let changes = sqlx::query_scalar::<_, i64>("SELECT changes()")
            .fetch_one(&self.pool)
            .await?;

        if changes > 0 {
            tx.event_count.fetch_add(1, Ordering::SeqCst);
        }

        Ok(())
    }
}
```

---

## Migration from Chronicle

To import existing Chronicle per-source databases:

```rust
pub async fn import_chronicle_db(
    event_store: &dyn EventStore,
    source: &str,
    db_path: &Path,
) -> Result<ImportStats> {
    let source_db = Connection::open(db_path)?;

    // Read events from Chronicle schema
    let rows = source_db.prepare(r#"
        SELECT
            source_id,
            type as action_type,
            json_extract(object, '$."@type"') as object_type,
            json(object) as payload,
            end_time as occurred_at
        FROM events
    "#)?.query_map([], |row| {
        // Parse row into Event
    })?;

    let tx = event_store.begin_batch(source).await?;
    let mut stats = ImportStats::default();

    for row in rows {
        let event = Event {
            event_id: Uuid::new_v4(),
            event_type: EventType::Ingest,
            source: source.to_string(),
            source_id: row.source_id,
            // ... map fields
        };

        event_store.append(&tx, event).await?;
        stats.total += 1;
    }

    let batch_stats = event_store.commit(tx).await?;
    stats.inserted = batch_stats.inserted;
    stats.skipped = batch_stats.skipped;

    Ok(stats)
}
```

---

## WAL Mode Configuration

For concurrent read/write access:

```sql
-- Enable WAL mode on database open
PRAGMA journal_mode = WAL;

-- Optimize for write performance
PRAGMA synchronous = NORMAL;

-- Allow multiple readers during writes
PRAGMA wal_autocheckpoint = 1000;

-- Increase page cache for better performance
PRAGMA cache_size = -64000;  -- 64MB
```

---

## File Layout

```
data/
└── otso/
    ├── events.db           # Main event store
    ├── events.db-wal       # WAL file (auto-managed)
    ├── events.db-shm       # Shared memory (auto-managed)
    └── backups/
        └── events-{timestamp}.db  # Point-in-time backups
```
