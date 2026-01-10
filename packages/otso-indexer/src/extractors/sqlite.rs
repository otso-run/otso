use anyhow::{Context, Result};
use sqlx::{Row, SqlitePool};
use uuid::Uuid;

use crate::config::QueryConfig;
use crate::event_store::{Event, EventType, Visibility};

use super::timestamp::parse_timestamp;

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

    let rows = sqlx::query(&query.sql)
        .fetch_all(&pool)
        .await
        .with_context(|| format!("Failed to execute query for {}", source_name))?;

    let mut events = Vec::with_capacity(rows.len());

    for row in rows {
        let event = row_to_event(&row, source_name, query, default_visibility)?;
        events.push(event);
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
    let source_id: String = row
        .try_get("external_id")
        .or_else(|_| row.try_get("source_id"))
        .or_else(|_| row.try_get("id"))
        .unwrap_or_else(|_| Uuid::new_v4().to_string());

    // Parse timestamp from various possible column names
    let occurred_at = extract_timestamp(row)?;

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

/// Extract timestamp from row, trying multiple column names and formats
fn extract_timestamp(row: &sqlx::sqlite::SqliteRow) -> Result<i64> {
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
            // Validate it's a reasonable timestamp
            if ts > 0 && ts < 4102444800 {
                // Before year 2100
                return Ok(ts);
            }
            // Might be milliseconds
            if ts > 1000000000000 && ts < 4102444800000 {
                return Ok(ts / 1000);
            }
        }

        // Try as string and parse
        if let Ok(ts_str) = row.try_get::<String, _>(col) {
            if let Some(ts) = parse_timestamp(&ts_str) {
                return Ok(ts);
            }
        }

        // Try as f64 (sometimes stored as REAL)
        if let Ok(ts_f) = row.try_get::<f64, _>(col) {
            let ts = ts_f as i64;
            if ts > 0 && ts < 4102444800 {
                return Ok(ts);
            }
        }
    }

    // Default to current time if no timestamp found
    tracing::warn!("No valid timestamp found in row, using current time");
    Ok(chrono::Utc::now().timestamp())
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
