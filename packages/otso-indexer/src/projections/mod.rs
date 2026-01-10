use anyhow::Result;

mod fts5;
mod search_entry;

pub use fts5::Fts5Projection;
pub use search_entry::SearchEntry;

#[cfg(feature = "meilisearch")]
mod meilisearch;

#[cfg(feature = "meilisearch")]
pub use meilisearch::MeilisearchProjection;

/// Statistics from a projection operation
#[derive(Debug, Default)]
pub struct ProjectionStats {
    pub entries_added: i64,
    pub entries_updated: i64,
    pub entries_removed: i64,
    pub duration_ms: i64,
}

/// Update all projections after a build
pub async fn update_all(data_dir: &str) -> Result<()> {
    // For now, we rebuild FTS5 after each build
    // In production, this would do incremental updates
    tracing::info!("FTS5 projection will be updated on next rebuild");

    #[cfg(feature = "meilisearch")]
    {
        tracing::info!("Meilisearch projection will be updated on next rebuild");
    }

    Ok(())
}

/// Rebuild FTS5 projection from event store
pub async fn rebuild_fts5(
    data_dir: &str,
    event_store: &crate::event_store::SqliteEventStore,
) -> Result<ProjectionStats> {
    let projection = Fts5Projection::open(data_dir).await?;
    projection.rebuild(event_store).await
}

/// Rebuild Meilisearch projection from event store
#[cfg(feature = "meilisearch")]
pub async fn rebuild_meilisearch(
    data_dir: &str,
    event_store: &crate::event_store::SqliteEventStore,
) -> Result<ProjectionStats> {
    let projection = MeilisearchProjection::new()?;
    projection.rebuild(event_store).await
}

#[cfg(not(feature = "meilisearch"))]
pub async fn rebuild_meilisearch(
    _data_dir: &str,
    _event_store: &crate::event_store::SqliteEventStore,
) -> Result<ProjectionStats> {
    anyhow::bail!("Meilisearch feature not enabled")
}
