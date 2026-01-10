use anyhow::Result;
use sqlx::SqlitePool;

/// Initialize the event store schema
pub async fn init_schema(pool: &SqlitePool) -> Result<()> {
    // Events table - core append-only log
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS events (
            event_id TEXT PRIMARY KEY,
            event_type TEXT NOT NULL CHECK(event_type IN ('ingest', 'update', 'delete')),
            source TEXT NOT NULL,
            source_id TEXT NOT NULL,
            action_type TEXT,
            object_type TEXT,
            payload TEXT NOT NULL,
            visibility TEXT DEFAULT 'public'
                CHECK(visibility IN ('public', 'unlisted', 'private', 'secret')),
            occurred_at INTEGER NOT NULL,
            ingested_at INTEGER NOT NULL,
            batch_id TEXT,
            deleted_at INTEGER,
            UNIQUE(source, source_id, event_type)
        )
        "#,
    )
    .execute(pool)
    .await?;

    // Indexes for common query patterns
    sqlx::query(
        "CREATE INDEX IF NOT EXISTS idx_events_source ON events(source, source_id) WHERE deleted_at IS NULL",
    )
    .execute(pool)
    .await?;

    sqlx::query(
        "CREATE INDEX IF NOT EXISTS idx_events_occurred ON events(occurred_at DESC) WHERE deleted_at IS NULL",
    )
    .execute(pool)
    .await?;

    sqlx::query(
        "CREATE INDEX IF NOT EXISTS idx_events_visibility ON events(visibility) WHERE deleted_at IS NULL",
    )
    .execute(pool)
    .await?;

    sqlx::query(
        "CREATE INDEX IF NOT EXISTS idx_events_batch ON events(batch_id) WHERE batch_id IS NOT NULL",
    )
    .execute(pool)
    .await?;

    sqlx::query(
        "CREATE INDEX IF NOT EXISTS idx_events_type ON events(action_type, object_type) WHERE deleted_at IS NULL",
    )
    .execute(pool)
    .await?;

    sqlx::query(
        "CREATE INDEX IF NOT EXISTS idx_events_source_time ON events(source, occurred_at DESC) WHERE deleted_at IS NULL",
    )
    .execute(pool)
    .await?;

    // Batches table - transaction tracking
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS batches (
            batch_id TEXT PRIMARY KEY,
            source TEXT NOT NULL,
            extractor TEXT,
            started_at INTEGER NOT NULL,
            completed_at INTEGER,
            event_count INTEGER DEFAULT 0,
            status TEXT NOT NULL DEFAULT 'pending'
                CHECK(status IN ('pending', 'committed', 'rolled_back')),
            error_message TEXT
        )
        "#,
    )
    .execute(pool)
    .await?;

    sqlx::query("CREATE INDEX IF NOT EXISTS idx_batches_status ON batches(status)")
        .execute(pool)
        .await?;

    sqlx::query(
        "CREATE INDEX IF NOT EXISTS idx_batches_source ON batches(source, started_at DESC)",
    )
    .execute(pool)
    .await?;

    // Sync state table - cursor tracking per source
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS sync_state (
            source TEXT PRIMARY KEY,
            extractor TEXT,
            last_cursor TEXT,
            last_sync_at INTEGER,
            total_events INTEGER DEFAULT 0,
            last_error TEXT,
            retry_count INTEGER DEFAULT 0,
            next_retry_at INTEGER
        )
        "#,
    )
    .execute(pool)
    .await?;

    // Schema version table
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS schema_version (
            version INTEGER PRIMARY KEY,
            applied_at INTEGER NOT NULL,
            description TEXT
        )
        "#,
    )
    .execute(pool)
    .await?;

    // Insert initial version if not exists
    sqlx::query(
        r#"
        INSERT OR IGNORE INTO schema_version (version, applied_at, description)
        VALUES (1, strftime('%s', 'now'), 'Initial event store schema')
        "#,
    )
    .execute(pool)
    .await?;

    Ok(())
}
