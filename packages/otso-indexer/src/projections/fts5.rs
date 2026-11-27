use anyhow::Result;
use sqlx::SqlitePool;
use std::path::Path;
use std::time::Instant;

use super::{ProjectionStats, SearchEntry};
use crate::event_store::SqliteEventStore;

/// FTS5 full-text search projection
pub struct Fts5Projection {
    pool: SqlitePool,
}

impl Fts5Projection {
    /// Open or create the FTS5 projection database
    pub async fn open(data_dir: &str) -> Result<Self> {
        let db_path = Path::new(data_dir).join("otso").join("search.db");

        // Ensure directory exists
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent)?;
        }

        let db_url = format!("sqlite:{}?mode=rwc", db_path.display());
        let pool = SqlitePool::connect(&db_url).await?;

        // Initialize schema
        init_schema(&pool).await?;

        // Configure for performance
        sqlx::query(crate::journal_mode_pragma())
            .execute(&pool)
            .await?;
        sqlx::query("PRAGMA synchronous = NORMAL")
            .execute(&pool)
            .await?;

        Ok(Self { pool })
    }

    /// Rebuild the entire FTS5 index from the event store
    pub async fn rebuild(&self, event_store: &SqliteEventStore) -> Result<ProjectionStats> {
        let start = Instant::now();
        let mut stats = ProjectionStats::default();

        // Clear existing entries
        sqlx::query("DELETE FROM search_entries")
            .execute(&self.pool)
            .await?;
        sqlx::query("DELETE FROM search_entry_map")
            .execute(&self.pool)
            .await?;

        // Stream all projectable events
        let events = event_store.stream_projectable().await?;

        tracing::info!("Rebuilding FTS5 from {} events", events.len());

        stats.entries_added = self.insert_events(events.iter(), 0).await?;

        // Update projection state
        self.update_state(stats.entries_added).await?;

        stats.duration_ms = start.elapsed().as_millis() as i64;
        Ok(stats)
    }

    /// Bring the index in line with the event store, matched on event_id:
    /// add events that aren't indexed yet and drop entries whose event is
    /// gone. The event store gives a changed row a new event_id, so an edit
    /// shows up here as one removal plus one addition.
    pub async fn update(&self, event_store: &SqliteEventStore) -> Result<ProjectionStats> {
        let start = Instant::now();
        let mut stats = ProjectionStats::default();

        let indexed: std::collections::HashSet<String> =
            sqlx::query_scalar::<_, String>("SELECT event_id FROM search_entry_map")
                .fetch_all(&self.pool)
                .await?
                .into_iter()
                .collect();

        let events = event_store.stream_projectable().await?;
        let current: std::collections::HashSet<String> =
            events.iter().map(|e| e.event_id.to_string()).collect();
        let stale: Vec<&String> = indexed.iter().filter(|id| !current.contains(*id)).collect();
        if !stale.is_empty() {
            stats.entries_removed = self.remove_entries(&stale).await?;
        }

        let max_id: i64 = sqlx::query_scalar("SELECT COALESCE(MAX(rowid), 0) FROM search_entry_map")
            .fetch_one(&self.pool)
            .await?;
        let new: Vec<_> = events
            .iter()
            .filter(|e| !indexed.contains(&e.event_id.to_string()))
            .collect();
        tracing::info!(
            "FTS5: {} new and {} removed of {} events",
            new.len(),
            stale.len(),
            events.len()
        );

        stats.entries_added = self.insert_events(new.into_iter(), max_id).await?;
        let total: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM search_entry_map")
            .fetch_one(&self.pool)
            .await?;
        self.update_state(total).await?;

        stats.duration_ms = start.elapsed().as_millis() as i64;
        Ok(stats)
    }

    /// Delete entries by event_id. event_id is an UNINDEXED FTS5 column, so
    /// this collects the ids in a temp table and scans search_entries once.
    async fn remove_entries(&self, event_ids: &[&String]) -> Result<i64> {
        let mut tx = self.pool.begin().await?;
        sqlx::query("CREATE TEMP TABLE IF NOT EXISTS stale_events (event_id TEXT PRIMARY KEY)")
            .execute(&mut *tx)
            .await?;
        sqlx::query("DELETE FROM stale_events").execute(&mut *tx).await?;
        for id in event_ids {
            sqlx::query("INSERT OR IGNORE INTO stale_events (event_id) VALUES (?1)")
                .bind(id.as_str())
                .execute(&mut *tx)
                .await?;
        }
        sqlx::query("DELETE FROM search_entries WHERE event_id IN (SELECT event_id FROM stale_events)")
            .execute(&mut *tx)
            .await?;
        let removed = sqlx::query(
            "DELETE FROM search_entry_map WHERE event_id IN (SELECT event_id FROM stale_events)",
        )
        .execute(&mut *tx)
        .await?
        .rows_affected() as i64;
        sqlx::query("DROP TABLE stale_events").execute(&mut *tx).await?;
        tx.commit().await?;
        Ok(removed)
    }

    /// Insert events in transactions of 1,000 (one commit per batch instead of
    /// per row), numbering entries from `first_id + 1`.
    async fn insert_events<'a>(
        &self,
        events: impl Iterator<Item = &'a crate::event_store::Event>,
        first_id: i64,
    ) -> Result<i64> {
        const BATCH_SIZE: usize = 1000;
        let mut id = first_id;
        let mut added = 0i64;
        let mut tx = self.pool.begin().await?;
        for event in events {
            id += 1;
            let entry = SearchEntry::from_event(event, id);
            Self::insert_entry(&mut tx, &entry).await?;
            added += 1;
            if added % BATCH_SIZE as i64 == 0 {
                tx.commit().await?;
                tx = self.pool.begin().await?;
                if added % 10000 == 0 {
                    tracing::info!("  {} entries indexed...", added);
                }
            }
        }
        tx.commit().await?;
        Ok(added)
    }

    /// Insert a single entry into the FTS5 index
    async fn insert_entry(tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>, entry: &SearchEntry) -> Result<()> {
        // Insert into FTS5 virtual table
        sqlx::query(
            r#"
            INSERT INTO search_entries (
                title, content, source, entry_type, action_type, object_type,
                category, content_rowid, event_id, external_id, url, ts,
                visibility, year, month
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)
            "#,
        )
        .bind(&entry.title)
        .bind(&entry.content)
        .bind(&entry.source)
        .bind(&entry.entry_type)
        .bind(&entry.action_type)
        .bind(&entry.object_type)
        .bind(&entry.category)
        .bind(entry.id)
        .bind(&entry.event_id)
        .bind(&entry.external_id)
        .bind(&entry.url)
        .bind(entry.ts)
        .bind(&entry.visibility)
        .bind(entry.year)
        .bind(&entry.month)
        .execute(&mut **tx)
        .await?;

        // Insert into mapping table
        sqlx::query(
            r#"
            INSERT INTO search_entry_map (
                rowid, event_id, source, entry_type, ts, visibility, year, month, metadata
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
            "#,
        )
        .bind(entry.id)
        .bind(&entry.event_id)
        .bind(&entry.source)
        .bind(&entry.entry_type)
        .bind(entry.ts)
        .bind(&entry.visibility)
        .bind(entry.year)
        .bind(&entry.month)
        .bind(&entry.metadata)
        .execute(&mut **tx)
        .await?;

        Ok(())
    }

    /// Update projection state
    async fn update_state(&self, entry_count: i64) -> Result<()> {
        let now = chrono::Utc::now().timestamp();

        sqlx::query(
            r#"
            INSERT INTO projection_state (projection_name, last_updated_at, entry_count, status)
            VALUES ('fts5', ?1, ?2, 'healthy')
            ON CONFLICT(projection_name) DO UPDATE SET
                last_updated_at = excluded.last_updated_at,
                entry_count = excluded.entry_count,
                status = 'healthy'
            "#,
        )
        .bind(now)
        .bind(entry_count)
        .execute(&self.pool)
        .await?;

        Ok(())
    }
}

/// Initialize the FTS5 schema
async fn init_schema(pool: &SqlitePool) -> Result<()> {
    // FTS5 virtual table
    sqlx::query(
        r#"
        CREATE VIRTUAL TABLE IF NOT EXISTS search_entries USING fts5(
            title,
            content,
            source,
            entry_type,
            action_type,
            object_type,
            category,
            content_rowid UNINDEXED,
            event_id UNINDEXED,
            external_id UNINDEXED,
            url UNINDEXED,
            ts UNINDEXED,
            visibility UNINDEXED,
            year UNINDEXED,
            month UNINDEXED,
            tokenize='porter unicode61',
            prefix='2 3 4'
        )
        "#,
    )
    .execute(pool)
    .await?;

    // Mapping table for metadata lookups
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS search_entry_map (
            rowid INTEGER PRIMARY KEY,
            event_id TEXT NOT NULL UNIQUE,
            source TEXT NOT NULL,
            entry_type TEXT NOT NULL,
            ts INTEGER NOT NULL,
            visibility TEXT NOT NULL,
            year INTEGER NOT NULL,
            month TEXT NOT NULL,
            metadata TEXT
        )
        "#,
    )
    .execute(pool)
    .await?;

    // Indexes built before the metadata column existed.
    let has_metadata: bool = sqlx::query_scalar(
        "SELECT COUNT(*) > 0 FROM pragma_table_info('search_entry_map') WHERE name = 'metadata'",
    )
    .fetch_one(pool)
    .await?;
    if !has_metadata {
        sqlx::query("ALTER TABLE search_entry_map ADD COLUMN metadata TEXT")
            .execute(pool)
            .await?;
    }

    sqlx::query("CREATE INDEX IF NOT EXISTS idx_entry_map_source ON search_entry_map(source)")
        .execute(pool)
        .await?;

    sqlx::query("CREATE INDEX IF NOT EXISTS idx_entry_map_ts ON search_entry_map(ts DESC)")
        .execute(pool)
        .await?;

    sqlx::query(
        "CREATE INDEX IF NOT EXISTS idx_entry_map_visibility ON search_entry_map(visibility)",
    )
    .execute(pool)
    .await?;

    sqlx::query(
        "CREATE INDEX IF NOT EXISTS idx_entry_map_year_month ON search_entry_map(year, month)",
    )
    .execute(pool)
    .await?;

    // Projection state tracking
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS projection_state (
            projection_name TEXT PRIMARY KEY,
            last_event_id TEXT,
            last_updated_at INTEGER,
            entry_count INTEGER DEFAULT 0,
            status TEXT DEFAULT 'healthy',
            error_message TEXT
        )
        "#,
    )
    .execute(pool)
    .await?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::event_store::{Event, EventType, Visibility};
    use tempfile::TempDir;
    use uuid::Uuid;

    fn article(content: &str) -> Event {
        Event {
            event_id: Uuid::new_v4(),
            event_type: EventType::Ingest,
            source: "readwise".into(),
            source_id: "doc-1".into(),
            action_type: Some("ReadAction".into()),
            object_type: Some("Article".into()),
            payload: serde_json::json!({
                "title": "Slow software",
                "content": content,
                "metadata": {"author": "Ada Example", "tags": ["essays"], "notes": null, "summary": ""}
            }),
            visibility: Visibility::Public,
            occurred_at: 1_705_315_800,
            ingested_at: 0,
            batch_id: None,
            deleted_at: None,
        }
    }

    async fn build(store: &SqliteEventStore, fts: &Fts5Projection, event: Event) -> ProjectionStats {
        let tx = store.begin_batch("readwise").await.unwrap();
        store.append(&tx, event).await.unwrap();
        store.commit(tx).await.unwrap();
        fts.update(store).await.unwrap()
    }

    async fn matches(fts: &Fts5Projection, q: &str) -> i64 {
        sqlx::query_scalar("SELECT COUNT(*) FROM search_entries WHERE search_entries MATCH ?1")
            .bind(q)
            .fetch_one(&fts.pool)
            .await
            .unwrap()
    }

    #[tokio::test]
    async fn update_replaces_entries_whose_event_changed() {
        let dir = TempDir::new().unwrap();
        let data = dir.path().to_str().unwrap();
        let store = SqliteEventStore::open(data).await.unwrap();
        let fts = Fts5Projection::open(data).await.unwrap();

        let s = build(&store, &fts, article("only a summary")).await;
        assert_eq!((s.entries_added, s.entries_removed), (1, 0));
        assert_eq!(matches(&fts, "caching").await, 0);

        let s = build(&store, &fts, article("only a summary, then caching and patience")).await;
        assert_eq!((s.entries_added, s.entries_removed), (1, 1));
        assert_eq!(matches(&fts, "caching").await, 1);
        let total: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM search_entry_map")
            .fetch_one(&fts.pool)
            .await
            .unwrap();
        assert_eq!(total, 1);

        // Empty metadata values are dropped; the rest is kept as JSON.
        let metadata: String = sqlx::query_scalar("SELECT metadata FROM search_entry_map")
            .fetch_one(&fts.pool)
            .await
            .unwrap();
        let metadata: serde_json::Value = serde_json::from_str(&metadata).unwrap();
        assert_eq!(metadata, serde_json::json!({"author": "Ada Example", "tags": ["essays"]}));

        // Nothing changed: nothing added or removed.
        let s = build(&store, &fts, article("only a summary, then caching and patience")).await;
        assert_eq!((s.entries_added, s.entries_removed), (0, 0));
    }
}
