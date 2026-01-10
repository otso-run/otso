use anyhow::Result;
use serde::{Deserialize, Serialize};
use sqlx::{Row, SqlitePool};
use std::path::Path;
use std::sync::atomic::{AtomicI64, Ordering};
use uuid::Uuid;

mod schema;

/// Core event type representing a data point in the event store
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

impl EventType {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Ingest => "ingest",
            Self::Update => "update",
            Self::Delete => "delete",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum Visibility {
    #[default]
    Public,
    Unlisted,
    Private,
    Secret,
}

impl Visibility {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Public => "public",
            Self::Unlisted => "unlisted",
            Self::Private => "private",
            Self::Secret => "secret",
        }
    }

    /// Whether this event should be indexed in search
    pub fn is_searchable(&self) -> bool {
        matches!(self, Self::Public | Self::Unlisted)
    }

    /// Whether this event should be included in projections
    pub fn should_project(&self) -> bool {
        !matches!(self, Self::Secret)
    }
}

/// Sync state for tracking extraction progress
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

/// Statistics for a committed batch
#[derive(Debug, Default)]
pub struct BatchStats {
    pub batch_id: Uuid,
    pub inserted: i64,
    pub updated: i64,
    pub skipped: i64,
    pub duration_ms: i64,
}

/// Active transaction for batch operations
pub struct Transaction {
    pub batch_id: Uuid,
    pub source: String,
    pub started_at: i64,
    pub event_count: AtomicI64,
}

/// SQLite-backed event store with batch transaction support
pub struct SqliteEventStore {
    pool: SqlitePool,
}

impl SqliteEventStore {
    /// Open or create an event store in the specified data directory
    pub async fn open(data_dir: &str) -> Result<Self> {
        let db_path = Path::new(data_dir).join("otso").join("events.db");

        // Ensure directory exists
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent)?;
        }

        let db_url = format!("sqlite:{}?mode=rwc", db_path.display());
        let pool = SqlitePool::connect(&db_url).await?;

        // Initialize schema
        schema::init_schema(&pool).await?;

        // Configure WAL mode
        sqlx::query("PRAGMA journal_mode = WAL")
            .execute(&pool)
            .await?;
        sqlx::query("PRAGMA synchronous = NORMAL")
            .execute(&pool)
            .await?;
        sqlx::query("PRAGMA cache_size = -64000")
            .execute(&pool)
            .await?;

        Ok(Self { pool })
    }

    /// Begin a new batch transaction for a source
    pub async fn begin_batch(&self, source: &str) -> Result<Transaction> {
        let batch_id = Uuid::new_v4();
        let started_at = chrono::Utc::now().timestamp();

        sqlx::query(
            r#"
            INSERT INTO batches (batch_id, source, started_at, status)
            VALUES (?1, ?2, ?3, 'pending')
            "#,
        )
        .bind(batch_id.to_string())
        .bind(source)
        .bind(started_at)
        .execute(&self.pool)
        .await?;

        Ok(Transaction {
            batch_id,
            source: source.to_string(),
            started_at,
            event_count: AtomicI64::new(0),
        })
    }

    /// Append an event to the current transaction
    pub async fn append(&self, tx: &Transaction, mut event: Event) -> Result<()> {
        event.batch_id = Some(tx.batch_id);
        event.ingested_at = chrono::Utc::now().timestamp();

        // Use INSERT OR IGNORE for deduplication
        let result = sqlx::query(
            r#"
            INSERT OR IGNORE INTO events (
                event_id, event_type, source, source_id,
                action_type, object_type, payload, visibility,
                occurred_at, ingested_at, batch_id
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
            "#,
        )
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

        if result.rows_affected() > 0 {
            tx.event_count.fetch_add(1, Ordering::SeqCst);
        }

        Ok(())
    }

    /// Commit the transaction
    pub async fn commit(&self, tx: Transaction) -> Result<BatchStats> {
        let completed_at = chrono::Utc::now().timestamp();
        let event_count = tx.event_count.load(Ordering::SeqCst);

        sqlx::query(
            r#"
            UPDATE batches
            SET status = 'committed', completed_at = ?1, event_count = ?2
            WHERE batch_id = ?3
            "#,
        )
        .bind(completed_at)
        .bind(event_count)
        .bind(tx.batch_id.to_string())
        .execute(&self.pool)
        .await?;

        // Update sync state
        sqlx::query(
            r#"
            INSERT INTO sync_state (source, last_sync_at, total_events)
            VALUES (?1, ?2, ?3)
            ON CONFLICT(source) DO UPDATE SET
                last_sync_at = excluded.last_sync_at,
                total_events = total_events + excluded.total_events
            "#,
        )
        .bind(&tx.source)
        .bind(completed_at)
        .bind(event_count)
        .execute(&self.pool)
        .await?;

        Ok(BatchStats {
            batch_id: tx.batch_id,
            inserted: event_count,
            updated: 0,
            skipped: 0, // We don't track skipped separately yet
            duration_ms: (completed_at - tx.started_at) * 1000,
        })
    }

    /// Rollback a transaction
    pub async fn rollback(&self, tx: Transaction) -> Result<()> {
        self.rollback_batch(tx.batch_id).await?;
        Ok(())
    }

    /// Rollback a specific batch by ID
    pub async fn rollback_batch(&self, batch_id: Uuid) -> Result<i64> {
        // Soft delete all events from this batch
        let result = sqlx::query(
            r#"
            UPDATE events
            SET deleted_at = ?1
            WHERE batch_id = ?2 AND deleted_at IS NULL
            "#,
        )
        .bind(chrono::Utc::now().timestamp())
        .bind(batch_id.to_string())
        .execute(&self.pool)
        .await?;

        // Mark batch as rolled back
        sqlx::query(
            r#"
            UPDATE batches
            SET status = 'rolled_back'
            WHERE batch_id = ?1
            "#,
        )
        .bind(batch_id.to_string())
        .execute(&self.pool)
        .await?;

        Ok(result.rows_affected() as i64)
    }

    /// Recover pending batches from previous runs (rollback incomplete transactions)
    pub async fn recover_pending(&self) -> Result<Vec<Uuid>> {
        let pending: Vec<(String,)> = sqlx::query_as(
            "SELECT batch_id FROM batches WHERE status = 'pending'",
        )
        .fetch_all(&self.pool)
        .await?;

        let mut recovered = Vec::new();
        for (batch_id_str,) in pending {
            if let Ok(batch_id) = Uuid::parse_str(&batch_id_str) {
                self.rollback_batch(batch_id).await?;
                recovered.push(batch_id);
            }
        }

        Ok(recovered)
    }

    /// Get sync state for a source
    pub async fn get_sync_state(&self, source: &str) -> Result<Option<SyncState>> {
        let row = sqlx::query(
            r#"
            SELECT source, extractor, last_cursor, last_sync_at,
                   total_events, last_error, retry_count, next_retry_at
            FROM sync_state
            WHERE source = ?1
            "#,
        )
        .bind(source)
        .fetch_optional(&self.pool)
        .await?;

        Ok(row.map(|r| SyncState {
            source: r.get("source"),
            extractor: r.get("extractor"),
            last_cursor: r.get("last_cursor"),
            last_sync_at: r.get("last_sync_at"),
            total_events: r.get("total_events"),
            last_error: r.get("last_error"),
            retry_count: r.get("retry_count"),
            next_retry_at: r.get("next_retry_at"),
        }))
    }

    /// Count events by source
    pub async fn count_by_source(&self, source: &str) -> Result<i64> {
        let (count,): (i64,) = sqlx::query_as(
            "SELECT COUNT(*) FROM events WHERE source = ?1 AND deleted_at IS NULL",
        )
        .bind(source)
        .fetch_one(&self.pool)
        .await?;

        Ok(count)
    }

    /// Count total events
    pub async fn count_total(&self) -> Result<i64> {
        let (count,): (i64,) = sqlx::query_as(
            "SELECT COUNT(*) FROM events WHERE deleted_at IS NULL",
        )
        .fetch_one(&self.pool)
        .await?;

        Ok(count)
    }

    /// Stream all projectable events (for rebuilding projections)
    pub async fn stream_projectable(&self) -> Result<Vec<Event>> {
        let rows = sqlx::query(
            r#"
            SELECT event_id, event_type, source, source_id,
                   action_type, object_type, payload, visibility,
                   occurred_at, ingested_at, batch_id, deleted_at
            FROM events
            WHERE deleted_at IS NULL
              AND visibility != 'secret'
            ORDER BY occurred_at ASC
            "#,
        )
        .fetch_all(&self.pool)
        .await?;

        let events = rows
            .into_iter()
            .map(|r| {
                let visibility_str: String = r.get("visibility");
                let event_type_str: String = r.get("event_type");

                Event {
                    event_id: Uuid::parse_str(r.get::<&str, _>("event_id")).unwrap_or_default(),
                    event_type: match event_type_str.as_str() {
                        "update" => EventType::Update,
                        "delete" => EventType::Delete,
                        _ => EventType::Ingest,
                    },
                    source: r.get("source"),
                    source_id: r.get("source_id"),
                    action_type: r.get("action_type"),
                    object_type: r.get("object_type"),
                    payload: serde_json::from_str(r.get::<&str, _>("payload")).unwrap_or_default(),
                    visibility: match visibility_str.as_str() {
                        "unlisted" => Visibility::Unlisted,
                        "private" => Visibility::Private,
                        "secret" => Visibility::Secret,
                        _ => Visibility::Public,
                    },
                    occurred_at: r.get("occurred_at"),
                    ingested_at: r.get("ingested_at"),
                    batch_id: r.get::<Option<&str>, _>("batch_id")
                        .and_then(|s| Uuid::parse_str(s).ok()),
                    deleted_at: r.get("deleted_at"),
                }
            })
            .collect();

        Ok(events)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    async fn create_test_store() -> (SqliteEventStore, TempDir) {
        let temp_dir = TempDir::new().expect("Failed to create temp dir");
        let store = SqliteEventStore::open(temp_dir.path().to_str().unwrap())
            .await
            .expect("Failed to open store");
        (store, temp_dir)
    }

    fn create_test_event(source: &str, source_id: &str) -> Event {
        Event {
            event_id: Uuid::new_v4(),
            event_type: EventType::Ingest,
            source: source.to_string(),
            source_id: source_id.to_string(),
            action_type: Some("TestAction".to_string()),
            object_type: Some("TestObject".to_string()),
            payload: serde_json::json!({"test": "value"}),
            visibility: Visibility::Public,
            occurred_at: 1705315800,
            ingested_at: 0,
            batch_id: None,
            deleted_at: None,
        }
    }

    #[tokio::test]
    async fn test_event_store_open() {
        let (store, _temp_dir) = create_test_store().await;
        let count = store.count_total().await.expect("Failed to count");
        assert_eq!(count, 0);
    }

    #[tokio::test]
    async fn test_batch_transaction() {
        let (store, _temp_dir) = create_test_store().await;

        // Begin a batch
        let tx = store.begin_batch("test-source").await.expect("Failed to begin batch");
        assert_eq!(tx.source, "test-source");

        // Append an event
        let event = create_test_event("test-source", "event-1");
        store.append(&tx, event).await.expect("Failed to append");

        // Commit
        let stats = store.commit(tx).await.expect("Failed to commit");
        assert_eq!(stats.inserted, 1);

        // Verify event was stored
        let count = store.count_by_source("test-source").await.expect("Failed to count");
        assert_eq!(count, 1);
    }

    #[tokio::test]
    async fn test_batch_multiple_events() {
        let (store, _temp_dir) = create_test_store().await;

        let tx = store.begin_batch("test-source").await.expect("Failed to begin batch");

        // Append multiple events
        for i in 0..10 {
            let event = create_test_event("test-source", &format!("event-{}", i));
            store.append(&tx, event).await.expect("Failed to append");
        }

        let stats = store.commit(tx).await.expect("Failed to commit");
        assert_eq!(stats.inserted, 10);

        let count = store.count_total().await.expect("Failed to count");
        assert_eq!(count, 10);
    }

    #[tokio::test]
    async fn test_deduplication() {
        let (store, _temp_dir) = create_test_store().await;

        // First batch
        let tx = store.begin_batch("test-source").await.expect("Failed to begin batch");
        let event = create_test_event("test-source", "same-id");
        store.append(&tx, event).await.expect("Failed to append");
        store.commit(tx).await.expect("Failed to commit");

        // Second batch with same source_id - should be ignored
        let tx2 = store.begin_batch("test-source").await.expect("Failed to begin batch");
        let event2 = create_test_event("test-source", "same-id");
        store.append(&tx2, event2).await.expect("Failed to append");
        let stats = store.commit(tx2).await.expect("Failed to commit");

        // Should be 0 because duplicate was ignored
        assert_eq!(stats.inserted, 0);

        // Total should still be 1
        let count = store.count_total().await.expect("Failed to count");
        assert_eq!(count, 1);
    }

    #[tokio::test]
    async fn test_rollback() {
        let (store, _temp_dir) = create_test_store().await;

        // Begin a batch and add events
        let tx = store.begin_batch("test-source").await.expect("Failed to begin batch");
        let event = create_test_event("test-source", "event-1");
        store.append(&tx, event).await.expect("Failed to append");
        let stats = store.commit(tx).await.expect("Failed to commit");
        assert_eq!(stats.inserted, 1);

        // Rollback the batch
        let rolled_back = store.rollback_batch(stats.batch_id).await.expect("Failed to rollback");
        assert_eq!(rolled_back, 1);

        // Count should be 0 (soft deleted)
        let count = store.count_total().await.expect("Failed to count");
        assert_eq!(count, 0);
    }

    #[tokio::test]
    async fn test_sync_state() {
        let (store, _temp_dir) = create_test_store().await;

        // No sync state initially
        let state = store.get_sync_state("test-source").await.expect("Failed to get state");
        assert!(state.is_none());

        // After committing a batch, sync state should be updated
        let tx = store.begin_batch("test-source").await.expect("Failed to begin batch");
        let event = create_test_event("test-source", "event-1");
        store.append(&tx, event).await.expect("Failed to append");
        store.commit(tx).await.expect("Failed to commit");

        let state = store.get_sync_state("test-source").await.expect("Failed to get state");
        assert!(state.is_some());
        let state = state.unwrap();
        assert_eq!(state.source, "test-source");
        assert_eq!(state.total_events, 1);
        assert!(state.last_sync_at.is_some());
    }

    #[tokio::test]
    async fn test_visibility_filtering() {
        let (store, _temp_dir) = create_test_store().await;

        let tx = store.begin_batch("test-source").await.expect("Failed to begin batch");

        // Add public event
        let mut public_event = create_test_event("test-source", "public-1");
        public_event.visibility = Visibility::Public;
        store.append(&tx, public_event).await.expect("Failed to append");

        // Add secret event
        let mut secret_event = create_test_event("test-source", "secret-1");
        secret_event.visibility = Visibility::Secret;
        store.append(&tx, secret_event).await.expect("Failed to append");

        store.commit(tx).await.expect("Failed to commit");

        // Total count includes both
        let total = store.count_total().await.expect("Failed to count");
        assert_eq!(total, 2);

        // Stream projectable should exclude secret
        let projectable = store.stream_projectable().await.expect("Failed to stream");
        assert_eq!(projectable.len(), 1);
        assert_eq!(projectable[0].source_id, "public-1");
    }

    #[tokio::test]
    async fn test_recover_pending() {
        let (store, _temp_dir) = create_test_store().await;

        // Begin a batch but don't commit
        let tx = store.begin_batch("test-source").await.expect("Failed to begin batch");
        let event = create_test_event("test-source", "event-1");
        store.append(&tx, event).await.expect("Failed to append");
        // Don't commit - simulate crash

        // Recover pending batches
        let recovered = store.recover_pending().await.expect("Failed to recover");
        assert_eq!(recovered.len(), 1);
        assert_eq!(recovered[0], tx.batch_id);

        // Count should be 0 (events were rolled back)
        let count = store.count_total().await.expect("Failed to count");
        assert_eq!(count, 0);
    }
}
