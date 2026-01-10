//! Meilisearch projection implementation
//!
//! This module is only compiled when the `meilisearch` feature is enabled.

use anyhow::Result;
use meilisearch_sdk::client::Client;
use meilisearch_sdk::client::SwapIndexes;
use std::time::Instant;

use super::{ProjectionStats, SearchEntry};
use crate::event_store::SqliteEventStore;

const INDEX_NAME: &str = "otso";
const BATCH_SIZE: usize = 1000;

/// Meilisearch search projection
pub struct MeilisearchProjection {
    client: Client,
}

impl MeilisearchProjection {
    /// Create a new Meilisearch projection
    pub fn new() -> Result<Self> {
        let url = std::env::var("MEILISEARCH_URL")
            .unwrap_or_else(|_| "http://localhost:7700".to_string());
        let api_key = std::env::var("MEILISEARCH_API_KEY").ok();

        let client = Client::new(url, api_key)?;

        Ok(Self { client })
    }

    /// Rebuild the entire Meilisearch index from the event store
    pub async fn rebuild(&self, event_store: &SqliteEventStore) -> Result<ProjectionStats> {
        let start = Instant::now();
        let mut stats = ProjectionStats::default();

        // Create a temporary index for atomic swap
        let temp_index_name = format!("{}_rebuild", INDEX_NAME);

        // Delete temp index if it exists from a previous failed rebuild
        let _ = self.client.delete_index(&temp_index_name).await;

        // Create temp index
        self.client
            .create_index(&temp_index_name, Some("id"))
            .await?
            .wait_for_completion(&self.client, None, None)
            .await?;

        let temp_index = self.client.index(&temp_index_name);

        // Configure index settings
        self.apply_settings(&temp_index).await?;

        // Stream all projectable events
        let events = event_store.stream_projectable().await?;
        tracing::info!("Rebuilding Meilisearch from {} events", events.len());

        // Insert in batches
        let mut id = 0i64;
        for chunk in events.chunks(BATCH_SIZE) {
            let entries: Vec<SearchEntry> = chunk
                .iter()
                .map(|event| {
                    id += 1;
                    SearchEntry::from_event(event, id)
                })
                .collect();

            temp_index
                .add_documents(&entries, Some("id"))
                .await?
                .wait_for_completion(&self.client, None, None)
                .await?;

            stats.entries_added += entries.len() as i64;

            if stats.entries_added % 10000 == 0 {
                tracing::info!("  {} documents indexed...", stats.entries_added);
            }
        }

        // Atomic swap: swap temp index with production index
        let swap = SwapIndexes {
            indexes: (INDEX_NAME.to_string(), temp_index_name.clone()),
        };
        self.client
            .swap_indexes([&swap])
            .await?
            .wait_for_completion(&self.client, None, None)
            .await?;

        // Delete the old index (now has temp name)
        self.client.delete_index(&temp_index_name).await?;

        stats.duration_ms = start.elapsed().as_millis() as i64;
        Ok(stats)
    }

    /// Apply index settings (searchable, filterable, sortable attributes)
    async fn apply_settings(&self, index: &meilisearch_sdk::indexes::Index) -> Result<()> {
        use meilisearch_sdk::settings::Settings;

        let settings = Settings::new()
            .with_displayed_attributes([
                "id",
                "event_id",
                "source",
                "entry_type",
                "action_type",
                "object_type",
                "title",
                "content",
                "ts",
                "external_id",
                "url",
                "visibility",
                "category",
                "year",
                "month",
            ])
            .with_searchable_attributes(["title", "content", "source", "entry_type"])
            .with_filterable_attributes([
                "source",
                "entry_type",
                "action_type",
                "object_type",
                "category",
                "visibility",
                "year",
                "month",
            ])
            .with_sortable_attributes(["ts", "year"]);

        index
            .set_settings(&settings)
            .await?
            .wait_for_completion(&self.client, None, None)
            .await?;

        Ok(())
    }
}
