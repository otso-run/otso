use anyhow::Result;
use uuid::Uuid;

use crate::config::SourceConfig;
use crate::event_store::{Event, EventType};

mod sqlite;
mod timestamp;

/// Extract events from a source based on its configuration
///
/// `source_data_dir` is the base directory for source databases (e.g., "data/fixtures" or "data/sources")
pub async fn extract(source_data_dir: &str, source_config: &SourceConfig) -> Result<Vec<Event>> {
    let mut all_events = Vec::new();

    // Get the database path
    let db_path = match &source_config.db_path {
        Some(path) => format!("{}/{}", source_data_dir, path),
        None => {
            tracing::warn!("No db_path for source {}, skipping", source_config.name);
            return Ok(vec![]);
        }
    };

    // Check if database exists
    if !std::path::Path::new(&db_path).exists() {
        tracing::warn!("Database not found: {}", db_path);
        return Ok(vec![]);
    }

    // Execute each query
    for query in &source_config.queries {
        tracing::debug!(
            "Executing query for {}.{}",
            source_config.name,
            query.entry_type
        );

        let events = sqlite::extract_from_sqlite(
            &db_path,
            &source_config.name,
            query,
            source_config.visibility.as_deref(),
        )
        .await?;

        all_events.extend(events);
    }

    // Apply aggregation if configured
    if let Some(ref agg_config) = source_config.aggregation {
        all_events = aggregate_events(all_events, agg_config)?;
    }

    Ok(all_events)
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
            // Similar to daily but with hour granularity
            // TODO: Implement if needed
            Ok(events)
        }
        AggregationStrategy::Session => {
            // Group by session gaps
            // TODO: Implement if needed
            Ok(events)
        }
    }
}
