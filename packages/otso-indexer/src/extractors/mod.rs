use anyhow::Result;
use std::path::{Path, PathBuf};
use std::time::Instant;
use uuid::Uuid;

use crate::config::SourceConfig;
use crate::event_store::{Event, EventType};

mod sqlite;
mod timestamp;

/// Timings and counts from reading one source, for the run report.
#[derive(Debug, Default, Clone, serde::Serialize)]
pub struct ExtractReport {
    /// Rows the queries returned (before aggregation).
    pub rows: usize,
    /// The database wasn't there (source not imported yet).
    pub missing: bool,
    /// Time spent refreshing the local copy, when one was made.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub copy_ms: Option<u64>,
    /// true when the local copy was already current and reused.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub copy_reused: bool,
    pub read_ms: u64,
    pub queries: Vec<QueryTiming>,
    /// Tables the source's queries name that the database doesn't have.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub missing_tables: Vec<String>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct QueryTiming {
    pub entry_type: String,
    pub rows: usize,
    pub ms: u64,
}

/// Extract events from a source based on its configuration
///
/// `source_data_dir` is the base directory for source databases (e.g., "data/fixtures" or "data/sources").
/// With `local_copy_dir`, each database is first copied there (and reused
/// while the original is unchanged), then read from the copy.
pub async fn extract(
    source_data_dir: &str,
    source_config: &SourceConfig,
    local_copy_dir: Option<&Path>,
) -> Result<(Vec<Event>, ExtractReport)> {
    let mut all_events = Vec::new();
    let mut report = ExtractReport::default();

    // Get the database path
    let db_path = match &source_config.db_path {
        Some(path) => PathBuf::from(format!("{}/{}", source_data_dir, path)),
        None => {
            tracing::warn!("No db_path for source {}, skipping", source_config.name);
            return Ok((vec![], report));
        }
    };

    // Check if database exists
    if !db_path.exists() {
        tracing::warn!("Database not found: {}", db_path.display());
        report.missing = true;
        return Ok((vec![], report));
    }
    // A zero-byte file is a database being replaced (or a sync that failed
    // before writing anything): treat it like a missing one, so the run
    // neither fails nor touches what's already indexed for this source.
    if std::fs::metadata(&db_path).map(|m| m.len() == 0).unwrap_or(false) {
        tracing::warn!("Database is empty: {}", db_path.display());
        report.missing = true;
        return Ok((vec![], report));
    }

    let (read_path, immutable) = match local_copy_dir {
        Some(dir) => {
            let started = Instant::now();
            match local_copy(&db_path, &dir.join(&source_config.name)).await? {
                Some((copy, reused)) => {
                    report.copy_reused = reused;
                    if !reused {
                        report.copy_ms = Some(started.elapsed().as_millis() as u64);
                    }
                    (copy, true)
                }
                None => (db_path.clone(), false),
            }
        }
        None => (db_path.clone(), false),
    };

    let read_started = Instant::now();
    let pool = sqlite::open_source(&read_path, immutable).await?;

    // Queries whose table isn't in the database yet (a source whose import
    // hasn't created it, e.g. a Takeout product that wasn't in the export)
    // are skipped; with none left, the source counts as missing, not failed.
    let tables: std::collections::HashSet<String> =
        sqlx::query_scalar("SELECT name FROM sqlite_master WHERE type IN ('table', 'view')")
            .fetch_all(&pool)
            .await?
            .into_iter()
            .collect();
    let queries: Vec<_> = source_config
        .queries
        .iter()
        .filter(|q| {
            let present = q.table.is_empty() || tables.contains(&q.table);
            if !present {
                report.missing_tables.push(q.table.clone());
            }
            present
        })
        .collect();
    if queries.is_empty() && !source_config.queries.is_empty() {
        tracing::warn!("{}: none of its tables exist yet, skipping", source_config.name);
        pool.close().await;
        report.missing = true;
        return Ok((vec![], report));
    }

    // Execute each query
    for query in queries {
        tracing::debug!(
            "Executing query for {}.{}",
            source_config.name,
            query.entry_type
        );

        let started = Instant::now();
        let events = sqlite::extract_from_sqlite(
            &pool,
            &source_config.name,
            query,
            source_config.visibility.as_deref(),
        )
        .await?;
        report.queries.push(QueryTiming {
            entry_type: query.entry_type.clone(),
            rows: events.len(),
            ms: started.elapsed().as_millis() as u64,
        });
        report.rows += events.len();

        all_events.extend(events);
    }
    pool.close().await;
    report.read_ms = read_started.elapsed().as_millis() as u64;

    // Apply aggregation if configured
    if let Some(ref agg_config) = source_config.aggregation {
        all_events = aggregate_events(all_events, agg_config)?;
    }

    Ok((all_events, report))
}

/// Copy a source database into `dir` and return the copy's path, reusing an
/// earlier copy while the original's size and modification time are the same
/// (the bool says whether it was reused).
///
/// Reading SQLite over SMB is a round trip per page read and per lock, so one
/// sequential copy is much faster than querying the share directly, and an
/// unchanged source costs nothing on the next run. Returns None (read the
/// original) when a -wal or -journal file sits beside it: the database is
/// mid-write or in WAL mode, and a copy of the main file alone could be stale.
pub async fn local_copy(src: &Path, dir: &Path) -> Result<Option<(PathBuf, bool)>> {
    let sidecar = |ext: &str| {
        let mut p = src.as_os_str().to_owned();
        p.push(ext);
        PathBuf::from(p)
    };
    if sidecar("-wal").exists() || sidecar("-journal").exists() {
        return Ok(None);
    }

    let meta = tokio::fs::metadata(src).await?;
    let mtime = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_nanos())
        .unwrap_or_default();
    let stamp = format!("{}:{}", meta.len(), mtime);

    let copy = dir.join("chronicle.db");
    let stamp_file = dir.join("source.stamp");
    if copy.exists() {
        if let Ok(previous) = tokio::fs::read_to_string(&stamp_file).await {
            if previous.trim() == stamp {
                return Ok(Some((copy, true)));
            }
        }
    }

    tokio::fs::create_dir_all(dir).await?;
    // The stamp is the state before copying, so a source that changes
    // mid-copy no longer matches it and is copied again next run.
    let partial = dir.join(format!("chronicle.db.partial-{}", std::process::id()));
    tokio::fs::copy(src, &partial).await?;
    tokio::fs::rename(&partial, &copy).await?;
    tokio::fs::write(&stamp_file, &stamp).await?;
    Ok(Some((copy, false)))
}

/// Aggregate events based on configuration
fn aggregate_events(
    events: Vec<Event>,
    agg_config: &crate::config::AggregationConfig,
) -> Result<Vec<Event>> {
    use crate::config::AggregationStrategy;
    use std::collections::HashMap;

    match agg_config.strategy {
        AggregationStrategy::None => Ok(events),
        AggregationStrategy::Daily => {
            let original_count = events.len();

            // Group by date + key fields
            let mut groups: HashMap<String, Vec<Event>> = HashMap::new();

            for event in events {
                let date = chrono::DateTime::from_timestamp(event.occurred_at, 0)
                    .map(|dt| dt.format("%Y-%m-%d").to_string())
                    .unwrap_or_else(|| "unknown".to_string());

                // Build key from date + configured key fields
                let mut key_parts = vec![date];
                for field in &agg_config.key_fields {
                    let value = event
                        .payload
                        .get(field)
                        .and_then(|v| v.as_str())
                        .unwrap_or("null")
                        .to_string();
                    key_parts.push(value);
                }
                let key = key_parts.join("|");

                groups.entry(key).or_default().push(event);
            }

            // Create aggregated events
            let mut aggregated = Vec::new();
            for (key, group) in groups {
                if let Some(first) = group.first() {
                    let count = group.len();
                    let total_duration: i64 = group
                        .iter()
                        .filter_map(|e| e.payload.get("duration").and_then(|v| v.as_i64()))
                        .sum();

                    // Use the last event's timestamp as the aggregate timestamp
                    let last_ts = group.iter().map(|e| e.occurred_at).max().unwrap_or(0);

                    // Build aggregated payload
                    let mut agg_payload = first.payload.clone();
                    if let Some(obj) = agg_payload.as_object_mut() {
                        obj.insert("_aggregated".to_string(), serde_json::json!(true));
                        obj.insert("_count".to_string(), serde_json::json!(count));
                        if total_duration > 0 {
                            obj.insert(
                                "_total_duration".to_string(),
                                serde_json::json!(total_duration),
                            );
                        }
                    }

                    aggregated.push(Event {
                        event_id: Uuid::new_v4(),
                        event_type: EventType::Ingest,
                        source: first.source.clone(),
                        source_id: format!("agg:{}", key),
                        action_type: first.action_type.clone(),
                        object_type: first.object_type.clone(),
                        payload: agg_payload,
                        visibility: first.visibility,
                        occurred_at: last_ts,
                        ingested_at: 0, // Will be set during append
                        batch_id: None,
                        deleted_at: None,
                    });
                }
            }

            tracing::info!(
                "Aggregated {} events into {} daily summaries",
                original_count,
                aggregated.len()
            );

            Ok(aggregated)
        }
        AggregationStrategy::Hourly => {
            let original_count = events.len();

            // Group by hour + key fields
            let mut groups: HashMap<String, Vec<Event>> = HashMap::new();

            for event in events {
                let hour = chrono::DateTime::from_timestamp(event.occurred_at, 0)
                    .map(|dt| dt.format("%Y-%m-%d %H:00").to_string())
                    .unwrap_or_else(|| "unknown".to_string());

                // Build key from hour + configured key fields
                let mut key_parts = vec![hour];
                for field in &agg_config.key_fields {
                    let value = event
                        .payload
                        .get(field)
                        .and_then(|v| v.as_str())
                        .unwrap_or("null")
                        .to_string();
                    key_parts.push(value);
                }
                let key = key_parts.join("|");

                groups.entry(key).or_default().push(event);
            }

            // Create aggregated events
            let mut aggregated = Vec::new();
            for (key, group) in groups {
                if let Some(first) = group.first() {
                    let count = group.len();
                    let total_duration: i64 = group
                        .iter()
                        .filter_map(|e| e.payload.get("duration").and_then(|v| v.as_i64()))
                        .sum();

                    let last_ts = group.iter().map(|e| e.occurred_at).max().unwrap_or(0);

                    let mut agg_payload = first.payload.clone();
                    if let Some(obj) = agg_payload.as_object_mut() {
                        obj.insert("_aggregated".to_string(), serde_json::json!(true));
                        obj.insert("_count".to_string(), serde_json::json!(count));
                        if total_duration > 0 {
                            obj.insert(
                                "_total_duration".to_string(),
                                serde_json::json!(total_duration),
                            );
                        }
                    }

                    aggregated.push(Event {
                        event_id: Uuid::new_v4(),
                        event_type: EventType::Ingest,
                        source: first.source.clone(),
                        source_id: format!("agg:{}", key),
                        action_type: first.action_type.clone(),
                        object_type: first.object_type.clone(),
                        payload: agg_payload,
                        visibility: first.visibility,
                        occurred_at: last_ts,
                        ingested_at: 0,
                        batch_id: None,
                        deleted_at: None,
                    });
                }
            }

            tracing::info!(
                "Aggregated {} events into {} hourly summaries",
                original_count,
                aggregated.len()
            );

            Ok(aggregated)
        }
        AggregationStrategy::Session => {
            let original_count = events.len();

            // Default session gap is 30 minutes (1800 seconds)
            let session_gap: i64 = agg_config
                .time_bucket
                .as_ref()
                .and_then(|s| s.parse().ok())
                .unwrap_or(1800);

            // Group events by key fields first
            let mut by_key: HashMap<String, Vec<Event>> = HashMap::new();
            for event in events {
                let mut key_parts = Vec::new();
                for field in &agg_config.key_fields {
                    let value = event
                        .payload
                        .get(field)
                        .and_then(|v| v.as_str())
                        .unwrap_or("null")
                        .to_string();
                    key_parts.push(value);
                }
                let key = key_parts.join("|");
                by_key.entry(key).or_default().push(event);
            }

            // Within each key group, split into sessions based on time gaps
            let mut aggregated = Vec::new();
            for (key, mut group) in by_key {
                // Sort by timestamp
                group.sort_by_key(|e| e.occurred_at);

                let mut sessions: Vec<Vec<Event>> = Vec::new();
                let mut current_session: Vec<Event> = Vec::new();

                for event in group {
                    if let Some(last) = current_session.last() {
                        if event.occurred_at - last.occurred_at > session_gap {
                            // Gap too large, start new session
                            if !current_session.is_empty() {
                                sessions.push(std::mem::take(&mut current_session));
                            }
                        }
                    }
                    current_session.push(event);
                }
                if !current_session.is_empty() {
                    sessions.push(current_session);
                }

                // Create aggregated event for each session
                for (session_idx, session) in sessions.into_iter().enumerate() {
                    if let Some(first) = session.first() {
                        let count = session.len();
                        let total_duration: i64 = session
                            .iter()
                            .filter_map(|e| e.payload.get("duration").and_then(|v| v.as_i64()))
                            .sum();

                        let start_ts = session.iter().map(|e| e.occurred_at).min().unwrap_or(0);
                        let end_ts = session.iter().map(|e| e.occurred_at).max().unwrap_or(0);

                        let mut agg_payload = first.payload.clone();
                        if let Some(obj) = agg_payload.as_object_mut() {
                            obj.insert("_aggregated".to_string(), serde_json::json!(true));
                            obj.insert("_count".to_string(), serde_json::json!(count));
                            obj.insert("_session_start".to_string(), serde_json::json!(start_ts));
                            obj.insert("_session_end".to_string(), serde_json::json!(end_ts));
                            obj.insert(
                                "_session_duration".to_string(),
                                serde_json::json!(end_ts - start_ts),
                            );
                            if total_duration > 0 {
                                obj.insert(
                                    "_total_duration".to_string(),
                                    serde_json::json!(total_duration),
                                );
                            }
                        }

                        aggregated.push(Event {
                            event_id: Uuid::new_v4(),
                            event_type: EventType::Ingest,
                            source: first.source.clone(),
                            source_id: format!("agg:session:{}:{}", key, session_idx),
                            action_type: first.action_type.clone(),
                            object_type: first.object_type.clone(),
                            payload: agg_payload,
                            visibility: first.visibility,
                            occurred_at: end_ts,
                            ingested_at: 0,
                            batch_id: None,
                            deleted_at: None,
                        });
                    }
                }
            }

            tracing::info!(
                "Aggregated {} events into {} sessions",
                original_count,
                aggregated.len()
            );

            Ok(aggregated)
        }
    }
}

#[cfg(test)]
mod tests {

    fn source(queries: &[&str]) -> SourceConfig {
        SourceConfig {
            name: "s".into(),
            enabled: true,
            db_path: Some("s/chronicle.db".into()),
            category: None,
            queries: queries
                .iter()
                .map(|t| crate::config::QueryConfig {
                    table: t.to_string(),
                    entry_type: t.to_string(),
                    sql: format!("SELECT id AS external_id, ts AS occurred_at FROM {t}"),
                    action_type: None,
                    object_type: None,
                })
                .collect(),
            aggregation: None,
            visibility: None,
            fixture: false,
        }
    }

    #[tokio::test]
    async fn missing_tables_and_empty_files_count_as_missing_not_failed() {
        let dir = tempfile::TempDir::new().unwrap();
        let root = dir.path().to_str().unwrap();
        let db = dir.path().join("s").join("chronicle.db");
        std::fs::create_dir_all(db.parent().unwrap()).unwrap();

        // A zero-byte file (mid-replace): missing.
        std::fs::write(&db, b"").unwrap();
        let (events, report) = extract(root, &source(&["a"]), None).await.unwrap();
        assert!(events.is_empty() && report.missing);

        // One of two tables present: that one is read, the other noted.
        std::fs::remove_file(&db).unwrap();
        let pool = sqlx::SqlitePool::connect_with(crate::db::read_write(&db)).await.unwrap();
        sqlx::query("CREATE TABLE a (id TEXT, ts INTEGER)").execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO a VALUES ('1', 1700000000)").execute(&pool).await.unwrap();
        pool.close().await;
        let (events, report) = extract(root, &source(&["a", "b"]), None).await.unwrap();
        assert_eq!(events.len(), 1);
        assert!(!report.missing);
        assert_eq!(report.missing_tables, vec!["b".to_string()]);

        // None of its tables: missing, not an error.
        let (events, report) = extract(root, &source(&["b", "c"]), None).await.unwrap();
        assert!(events.is_empty() && report.missing);
        assert_eq!(report.missing_tables.len(), 2);
    }

    #[tokio::test]
    async fn local_copy_is_reused_until_the_source_changes() {
        let dir = tempfile::TempDir::new().unwrap();
        let src = dir.path().join("chronicle.db");
        std::fs::write(&src, b"first").unwrap();
        let cache = dir.path().join("cache").join("src");

        let (copy, reused) = local_copy(&src, &cache).await.unwrap().unwrap();
        assert!(!reused);
        assert_eq!(std::fs::read(&copy).unwrap(), b"first");
        assert!(local_copy(&src, &cache).await.unwrap().unwrap().1);

        std::fs::write(&src, b"second, longer").unwrap();
        let (copy, reused) = local_copy(&src, &cache).await.unwrap().unwrap();
        assert!(!reused);
        assert_eq!(std::fs::read(&copy).unwrap(), b"second, longer");

        // Mid-write (a hot journal beside it): read the original instead.
        std::fs::write(dir.path().join("chronicle.db-journal"), b"").unwrap();
        assert!(local_copy(&src, &cache).await.unwrap().is_none());
    }

    use super::*;
    use crate::config::{AggregationConfig, AggregationStrategy};
    use crate::event_store::Visibility;

    fn make_event(source_id: &str, occurred_at: i64, payload: serde_json::Value) -> Event {
        Event {
            event_id: Uuid::new_v4(),
            event_type: EventType::Ingest,
            source: "test".to_string(),
            source_id: source_id.to_string(),
            action_type: None,
            object_type: None,
            payload,
            visibility: Visibility::Public,
            occurred_at,
            ingested_at: 0,
            batch_id: None,
            deleted_at: None,
        }
    }

    #[test]
    fn test_aggregate_none_passthrough() {
        let events = vec![
            make_event("1", 1000, serde_json::json!({"title": "A"})),
            make_event("2", 2000, serde_json::json!({"title": "B"})),
        ];

        let config = AggregationConfig {
            strategy: AggregationStrategy::None,
            key_fields: vec![],
            time_bucket: None,
        };

        let result = aggregate_events(events.clone(), &config).unwrap();
        assert_eq!(result.len(), 2);
    }

    #[test]
    fn test_aggregate_daily() {
        // Same day events should be grouped
        let day1 = 1704067200; // 2024-01-01 00:00:00 UTC
        let day1_later = day1 + 3600; // Same day, 1 hour later

        let events = vec![
            make_event("1", day1, serde_json::json!({"app": "Safari", "duration": 100})),
            make_event("2", day1_later, serde_json::json!({"app": "Safari", "duration": 200})),
        ];

        let config = AggregationConfig {
            strategy: AggregationStrategy::Daily,
            key_fields: vec!["app".to_string()],
            time_bucket: None,
        };

        let result = aggregate_events(events, &config).unwrap();
        assert_eq!(result.len(), 1);

        let agg = &result[0];
        assert_eq!(agg.payload.get("_count").unwrap(), 2);
        assert_eq!(agg.payload.get("_total_duration").unwrap(), 300);
        assert!(agg.source_id.starts_with("agg:"));
    }

    #[test]
    fn test_aggregate_daily_different_days() {
        let day1 = 1704067200; // 2024-01-01 00:00:00 UTC
        let day2 = day1 + 86400; // 2024-01-02

        let events = vec![
            make_event("1", day1, serde_json::json!({"app": "Safari"})),
            make_event("2", day2, serde_json::json!({"app": "Safari"})),
        ];

        let config = AggregationConfig {
            strategy: AggregationStrategy::Daily,
            key_fields: vec!["app".to_string()],
            time_bucket: None,
        };

        let result = aggregate_events(events, &config).unwrap();
        assert_eq!(result.len(), 2); // Different days = separate aggregates
    }

    #[test]
    fn test_aggregate_hourly() {
        let hour1 = 1704067200; // 2024-01-01 00:00:00 UTC
        let hour1_later = hour1 + 1800; // 30 min later, same hour
        let hour2 = hour1 + 3600; // Next hour

        let events = vec![
            make_event("1", hour1, serde_json::json!({"app": "Code"})),
            make_event("2", hour1_later, serde_json::json!({"app": "Code"})),
            make_event("3", hour2, serde_json::json!({"app": "Code"})),
        ];

        let config = AggregationConfig {
            strategy: AggregationStrategy::Hourly,
            key_fields: vec!["app".to_string()],
            time_bucket: None,
        };

        let result = aggregate_events(events, &config).unwrap();
        assert_eq!(result.len(), 2); // Two different hours
    }

    #[test]
    fn test_aggregate_session() {
        let start = 1704067200;
        let close = start + 60; // 1 min later
        let gap = start + 3600; // 1 hour later (new session)

        let events = vec![
            make_event("1", start, serde_json::json!({"app": "Notes"})),
            make_event("2", close, serde_json::json!({"app": "Notes"})),
            make_event("3", gap, serde_json::json!({"app": "Notes"})),
        ];

        let config = AggregationConfig {
            strategy: AggregationStrategy::Session,
            key_fields: vec!["app".to_string()],
            time_bucket: Some("1800".to_string()), // 30 min gap
        };

        let result = aggregate_events(events, &config).unwrap();
        assert_eq!(result.len(), 2); // Two sessions

        // First session has 2 events
        let session1 = result.iter().find(|e| e.payload.get("_count").unwrap() == 2);
        assert!(session1.is_some());

        // Second session has 1 event
        let session2 = result.iter().find(|e| e.payload.get("_count").unwrap() == 1);
        assert!(session2.is_some());
    }

    #[test]
    fn test_aggregate_different_keys() {
        let ts = 1704067200;

        let events = vec![
            make_event("1", ts, serde_json::json!({"app": "Safari"})),
            make_event("2", ts, serde_json::json!({"app": "Chrome"})),
        ];

        let config = AggregationConfig {
            strategy: AggregationStrategy::Daily,
            key_fields: vec!["app".to_string()],
            time_bucket: None,
        };

        let result = aggregate_events(events, &config).unwrap();
        assert_eq!(result.len(), 2); // Different apps = separate aggregates
    }
}
