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
        sqlx::query("PRAGMA journal_mode = WAL")
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

        // Insert in batches
        const BATCH_SIZE: usize = 1000;
        let mut id = 0i64;

        for chunk in events.chunks(BATCH_SIZE) {
            for event in chunk {
                id += 1;
                let entry = SearchEntry::from_event(event, id);
                self.insert_entry(&entry).await?;
                stats.entries_added += 1;
            }

            if stats.entries_added % 10000 == 0 {
                tracing::info!("  {} entries indexed...", stats.entries_added);
            }
        }

        // Update projection state
        self.update_state(stats.entries_added).await?;

        stats.duration_ms = start.elapsed().as_millis() as i64;
        Ok(stats)
    }

    /// Insert a single entry into the FTS5 index
    async fn insert_entry(&self, entry: &SearchEntry) -> Result<()> {
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
        .execute(&self.pool)
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
        .execute(&self.pool)
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
