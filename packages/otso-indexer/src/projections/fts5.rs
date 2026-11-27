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

    /// Add only events that aren't in the index yet (matched on event_id).
    /// Events are immutable once ingested, so new ids are the only change a
    /// build can make; use `rebuild` after deletions or re-ingesting with new ids.
    pub async fn update(&self, event_store: &SqliteEventStore) -> Result<ProjectionStats> {
        let start = Instant::now();
        let mut stats = ProjectionStats::default();

        let indexed: std::collections::HashSet<String> =
            sqlx::query_scalar::<_, String>("SELECT event_id FROM search_entry_map")
                .fetch_all(&self.pool)
                .await?
                .into_iter()
                .collect();
        let max_id: i64 = sqlx::query_scalar("SELECT COALESCE(MAX(rowid), 0) FROM search_entry_map")
            .fetch_one(&self.pool)
            .await?;

        let events = event_store.stream_projectable().await?;
        let new: Vec<_> = events
            .iter()
            .filter(|e| !indexed.contains(&e.event_id.to_string()))
            .collect();
        tracing::info!("FTS5: {} new of {} events", new.len(), events.len());

        stats.entries_added = self.insert_events(new.into_iter(), max_id).await?;
        let total: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM search_entry_map")
            .fetch_one(&self.pool)
            .await?;
        self.update_state(total).await?;

        stats.duration_ms = start.elapsed().as_millis() as i64;
        Ok(stats)
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
                rowid, event_id, source, entry_type, ts, visibility, year, month
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
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
            month TEXT NOT NULL
        )
        "#,
    )
    .execute(pool)
    .await?;

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
