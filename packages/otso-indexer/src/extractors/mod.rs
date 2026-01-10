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
