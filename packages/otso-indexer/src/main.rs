use anyhow::Result;
use clap::{Parser, Subcommand};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};

mod config;
mod event_store;
mod extractors;
mod projections;

#[derive(Parser)]
#[command(name = "otso-indexer")]
#[command(about = "Data indexer for Otso - ingests events and builds search projections")]
#[command(version)]
struct Cli {
    /// Path to sources.toml configuration
    #[arg(short, long, default_value = "data/config/sources.toml")]
    config: String,

    /// Path to data directory
    #[arg(short, long, default_value = "data")]
    data_dir: String,

    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Index all enabled sources (or specific source with --source)
    Build {
        /// Process only this source
        #[arg(short, long)]
        source: Option<String>,

        /// Rebuild Meilisearch index only (skip event store ingestion)
        #[arg(long)]
        meili_only: bool,
    },

    /// Show statistics for all sources
    Stats {
        /// Show stats for specific source only
        #[arg(short, long)]
        source: Option<String>,
    },

    /// Validate configuration without processing
    Validate,

    /// Full rebuild of projections from event store
    Rebuild {
        /// Rebuild only FTS5 projection
        #[arg(long)]
        fts5_only: bool,

        /// Rebuild only Meilisearch projection
        #[arg(long)]
        meili_only: bool,
    },
}

#[tokio::main]
async fn main() -> Result<()> {
    // Initialize tracing
    tracing_subscriber::registry()
        .with(EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")))
        .with(tracing_subscriber::fmt::layer())
        .init();

    let cli = Cli::parse();

    // Load and validate configuration
    let config = config::load_config(&cli.config)?;
    tracing::info!(
        "Loaded {} source configurations",
        config.sources.len()
    );

    match cli.command {
        Commands::Build { source, meili_only } => {
            run_build(&cli.data_dir, &config, source.as_deref(), meili_only).await
        }
        Commands::Stats { source } => {
            run_stats(&cli.data_dir, &config, source.as_deref()).await
        }
        Commands::Validate => {
            run_validate(&config).await
        }
        Commands::Rebuild { fts5_only, meili_only } => {
            run_rebuild(&cli.data_dir, fts5_only, meili_only).await
        }
    }
}

async fn run_build(
    data_dir: &str,
    config: &config::Config,
    source: Option<&str>,
    meili_only: bool,
) -> Result<()> {
    let sources = match source {
        Some(name) => {
            let src = config.sources.iter()
                .find(|s| s.name == name)
                .ok_or_else(|| anyhow::anyhow!("Source not found: {}", name))?;
            vec![src.clone()]
        }
        None => config.sources.iter()
            .filter(|s| s.enabled)
            .cloned()
            .collect()
    };

    tracing::info!("Building {} sources", sources.len());

    if meili_only {
        tracing::info!("Meilisearch-only mode: skipping event store ingestion");
        // TODO: Implement meili rebuild from event store
        return Ok(());
    }

    // Initialize event store
    let event_store = event_store::SqliteEventStore::open(data_dir).await?;

    // Recover any pending batches from previous runs
    let recovered = event_store.recover_pending().await?;
    if !recovered.is_empty() {
        tracing::warn!("Recovered {} pending batches from previous run", recovered.len());
    }

    // Determine source data directory from config or default
    let source_data_dir = config.defaults.data_dir.clone()
        .unwrap_or_else(|| format!("{}/sources", data_dir));

    for source_config in &sources {
        tracing::info!("Processing source: {}", source_config.name);

        match process_source(&event_store, &source_data_dir, source_config).await {
            Ok(stats) => {
                tracing::info!(
                    "  {} events: {} inserted, {} skipped",
                    source_config.name,
                    stats.inserted,
                    stats.skipped
                );
            }
            Err(e) => {
                tracing::error!("  {} failed: {}", source_config.name, e);
            }
        }
    }

    // Update projections
    tracing::info!("Updating projections...");
    projections::update_all(data_dir).await?;

    Ok(())
}

async fn process_source(
    event_store: &event_store::SqliteEventStore,
    source_data_dir: &str,
    source_config: &config::SourceConfig,
) -> Result<event_store::BatchStats> {
    // Begin batch transaction
    let tx = event_store.begin_batch(&source_config.name).await?;

    // Extract events based on source type
    let events = extractors::extract(source_data_dir, source_config).await?;

    // Append events to transaction
    for event in events {
        event_store.append(&tx, event).await?;
    }

    // Commit transaction
    let stats = event_store.commit(tx).await?;

    Ok(stats)
}

async fn run_stats(
    data_dir: &str,
    config: &config::Config,
    source: Option<&str>,
) -> Result<()> {
    let event_store = event_store::SqliteEventStore::open(data_dir).await?;

    let sources: Vec<_> = match source {
        Some(name) => config.sources.iter()
            .filter(|s| s.name == name)
            .collect(),
        None => config.sources.iter().collect(),
    };

    println!("\n{:<20} {:>10} {:>12} {:>20}", "Source", "Events", "Status", "Last Sync");
    println!("{}", "-".repeat(65));

    for source_config in sources {
        let count = event_store.count_by_source(&source_config.name).await?;
        let sync_state = event_store.get_sync_state(&source_config.name).await?;

        let status = if source_config.enabled { "enabled" } else { "disabled" };
        let last_sync = sync_state
            .and_then(|s| s.last_sync_at)
            .map(|ts| chrono::DateTime::from_timestamp(ts, 0)
                .map(|dt| dt.format("%Y-%m-%d %H:%M").to_string())
                .unwrap_or_else(|| "invalid".to_string()))
            .unwrap_or_else(|| "never".to_string());

        println!("{:<20} {:>10} {:>12} {:>20}", source_config.name, count, status, last_sync);
    }

    // Total count
    let total = event_store.count_total().await?;
    println!("{}", "-".repeat(65));
    println!("{:<20} {:>10}", "TOTAL", total);

    Ok(())
}

async fn run_validate(config: &config::Config) -> Result<()> {
    let mut errors = Vec::new();
    let mut warnings = Vec::new();

    for source in &config.sources {
        // Validate source configuration
        if let Err(e) = config::validate_source(source) {
            errors.push(format!("{}: {}", source.name, e));
        }

        // Check for potential issues
        if source.queries.is_empty() {
            warnings.push(format!("{}: no queries defined", source.name));
        }
    }

    if errors.is_empty() && warnings.is_empty() {
        println!("✓ Configuration valid: {} sources", config.sources.len());
        return Ok(());
    }

    if !warnings.is_empty() {
        println!("\nWarnings:");
        for w in &warnings {
            println!("  ⚠ {}", w);
        }
    }

    if !errors.is_empty() {
        println!("\nErrors:");
        for e in &errors {
            println!("  ✗ {}", e);
        }
        anyhow::bail!("Configuration validation failed with {} errors", errors.len());
    }

    Ok(())
}

async fn run_rebuild(
    data_dir: &str,
    fts5_only: bool,
    meili_only: bool,
) -> Result<()> {
    let event_store = event_store::SqliteEventStore::open(data_dir).await?;

    if !meili_only {
        tracing::info!("Rebuilding FTS5 projection...");
        let stats = projections::rebuild_fts5(data_dir, &event_store).await?;
        tracing::info!("FTS5: {} entries in {}ms", stats.entries_added, stats.duration_ms);
    }

    if !fts5_only {
        #[cfg(feature = "meilisearch")]
        {
            tracing::info!("Rebuilding Meilisearch projection...");
            let stats = projections::rebuild_meilisearch(data_dir, &event_store).await?;
            tracing::info!("Meilisearch: {} entries in {}ms", stats.entries_added, stats.duration_ms);
        }

        #[cfg(not(feature = "meilisearch"))]
        {
            if meili_only {
                anyhow::bail!("Meilisearch feature not enabled. Rebuild with --features meilisearch");
            }
        }
    }

    Ok(())
}
