use anyhow::{Context, Result};
use sqlx::{Row, SqlitePool};
use uuid::Uuid;

use crate::config::QueryConfig;
use crate::event_store::{Event, EventType, Visibility};

use super::timestamp::parse_timestamp;

/// Validate SQL query before execution
/// Returns Ok(()) if valid, Err with descriptive message if invalid
async fn validate_query(pool: &SqlitePool, query: &QueryConfig) -> Result<()> {
    // Check if table exists
    if !query.table.is_empty() {
        let table_check = sqlx::query(
            "SELECT name FROM sqlite_master WHERE type='table' AND name = ?",
        )
        .bind(&query.table)
        .fetch_optional(pool)
        .await
        .context("Failed to check table existence")?;

        if table_check.is_none() {
            anyhow::bail!(
                "Table '{}' not found in database. Available tables can be listed with: \
                 SELECT name FROM sqlite_master WHERE type='table'",
                query.table
            );
        }
    }

    // Validate SQL syntax using EXPLAIN
    let explain_sql = format!("EXPLAIN {}", query.sql);
    if let Err(e) = sqlx::query(&explain_sql).fetch_all(pool).await {
        let error_msg = e.to_string();

        // Provide helpful suggestions based on common errors
        let suggestion = if error_msg.contains("no such table") {
            "Check that the table name is correct and exists in the database."
        } else if error_msg.contains("no such column") {
            "Check that all column names are spelled correctly and exist in the table."
        } else if error_msg.contains("syntax error") {
            "Check SQL syntax. Common issues: missing commas, unbalanced quotes, typos."
        } else {
            "Review the SQL query for errors."
        };

        anyhow::bail!(
            "SQL validation failed for query '{}': {}\n  Suggestion: {}",
            query.entry_type,
            error_msg,
            suggestion
        );
    }

    Ok(())
}

/// Extract events from a SQLite database using the configured query
pub async fn extract_from_sqlite(
    db_path: &str,
    source_name: &str,
    query: &QueryConfig,
    default_visibility: Option<&str>,
) -> Result<Vec<Event>> {
    let db_url = format!("sqlite:{}?mode=ro", db_path);
    let pool = SqlitePool::connect(&db_url)
        .await
        .with_context(|| format!("Failed to connect to database: {}", db_path))?;

    // Validate query before execution
    validate_query(&pool, query)
        .await
        .with_context(|| format!("Query validation failed for source '{}'", source_name))?;

    let rows = sqlx::query(&query.sql)
        .fetch_all(&pool)
        .await
        .with_context(|| format!("Failed to execute query for {}", source_name))?;

    let mut events = Vec::with_capacity(rows.len());
    let mut undated = 0usize;

    for row in rows {
        match extract_timestamp(&row) {
            Some(_) => events.push(row_to_event(&row, source_name, query, default_visibility)?),
            None => undated += 1,
        }
    }
    if undated > 0 {
        // Dating these "now" put old items at the top of the timeline.
        tracing::warn!("{}: skipped {} rows with no usable date", source_name, undated);
    }

    Ok(events)
}

fn row_to_event(
    row: &sqlx::sqlite::SqliteRow,
    source_name: &str,
    query: &QueryConfig,
    default_visibility: Option<&str>,
) -> Result<Event> {
    // Extract required fields
    // Integer ids (e.g. `rowid as external_id`) must be read as integers;
    // reading them as text fails and used to fall through to a random UUID,
    // which re-inserted every such row on every build.
    let id_column = |name: &str| -> Option<String> {
        row.try_get::<String, _>(name)
            .ok()
            .or_else(|| row.try_get::<i64, _>(name).ok().map(|n| n.to_string()))
    };
    let source_id: String = id_column("external_id")
        .or_else(|| id_column("source_id"))
        .or_else(|| id_column("id"))
        .unwrap_or_else(|| Uuid::new_v4().to_string());

    // Callers skip rows without a usable date before getting here.
    let occurred_at = extract_timestamp(row).context("row has no usable date")?;

    // Build payload from all columns
    let payload = build_payload(row)?;

    // Determine visibility
    let visibility = row
        .try_get::<String, _>("visibility")
        .ok()
        .or_else(|| default_visibility.map(String::from))
        .map(|s| match s.as_str() {
            "unlisted" => Visibility::Unlisted,
            "private" => Visibility::Private,
            "secret" => Visibility::Secret,
            _ => Visibility::Public,
        })
        .unwrap_or(Visibility::Public);

    // Get action_type and object_type from query config or row
    let action_type = query
        .action_type
        .clone()
        .or_else(|| row.try_get("action_type").ok())
        .or_else(|| row.try_get("type").ok());

    let object_type = query
        .object_type
        .clone()
        .or_else(|| row.try_get("object_type").ok());

    Ok(Event {
        event_id: Uuid::new_v4(),
        event_type: EventType::Ingest,
        source: source_name.to_string(),
        source_id,
        action_type,
        object_type,
        payload,
        visibility,
        occurred_at,
        ingested_at: 0, // Set during append
        batch_id: None,
        deleted_at: None,
    })
}

/// Latest believable time: a day past now (dates further ahead are bad data,
/// like a podcast "played" in 2040).
fn latest_plausible() -> i64 {
    chrono::Utc::now().timestamp() + 86_400
}

/// Extract timestamp from row, trying multiple column names and formats
fn extract_timestamp(row: &sqlx::sqlite::SqliteRow) -> Option<i64> {
    let ok = |ts: i64| (ts > 0 && ts <= latest_plausible()).then_some(ts);
    // Try various column names
    let timestamp_columns = [
        "occurred_at",
        "end_time",
        "start_time",
        "timestamp",
        "created_at",
        "date",
        "ts",
    ];

    for col in timestamp_columns {
        // Try as integer first (Unix timestamp)
        if let Ok(ts) = row.try_get::<i64, _>(col) {
            // Seconds, or milliseconds
            let ts = if ts > 1_000_000_000_000 { ts / 1000 } else { ts };
            if let Some(ts) = ok(ts) {
                return Some(ts);
            }
            continue;
        }

        // Try as string and parse
        if let Ok(ts_str) = row.try_get::<String, _>(col) {
            if let Some(ts) = parse_timestamp(&ts_str).and_then(ok) {
                return Some(ts);
            }
            continue;
        }

        // Try as f64 (sometimes stored as REAL)
        if let Ok(ts_f) = row.try_get::<f64, _>(col) {
            if let Some(ts) = ok(ts_f as i64) {
                return Some(ts);
            }
        }
    }

    None
}

/// Build a JSON payload from all columns in the row
fn build_payload(row: &sqlx::sqlite::SqliteRow) -> Result<serde_json::Value> {
    use sqlx::Column;

    let mut map = serde_json::Map::new();

    for (i, col) in row.columns().iter().enumerate() {
        let name = col.name();

        // Skip internal columns
        if name == "rowid" || name == "_rowid_" {
            continue;
        }

        // Try to get value as different types
        let value = if let Ok(v) = row.try_get::<String, _>(i) {
            // Check if it's JSON
            if (v.starts_with('{') && v.ends_with('}'))
                || (v.starts_with('[') && v.ends_with(']'))
            {
                serde_json::from_str(&v).unwrap_or(serde_json::Value::String(v))
            } else {
                serde_json::Value::String(v)
            }
        } else if let Ok(v) = row.try_get::<i64, _>(i) {
            serde_json::Value::Number(v.into())
        } else if let Ok(v) = row.try_get::<f64, _>(i) {
            serde_json::Number::from_f64(v)
                .map(serde_json::Value::Number)
                .unwrap_or(serde_json::Value::Null)
        } else if let Ok(v) = row.try_get::<bool, _>(i) {
            serde_json::Value::Bool(v)
        } else {
            serde_json::Value::Null
        };

        map.insert(name.to_string(), value);
    }

    Ok(serde_json::Value::Object(map))
}
