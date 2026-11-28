use anyhow::Result;
use clap::{Parser, Subcommand};
use std::sync::Arc;
use tokio::task::JoinSet;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};

mod config;
mod db;
mod event_store;
mod extractors;
mod projections;
mod report;

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

    /// Directory holding each source's database (overrides defaults.data_dir in sources.toml)
    #[arg(long)]
    sources_dir: Option<String>,

    /// Copy each source database here before reading it, reusing the copy
    /// while the source is unchanged. Much faster when sources-dir is a
    /// network share.
    #[arg(long)]
    local_copy_dir: Option<String>,

    /// Write a JSON report of the build (per-source timings, counts, errors) here
    #[arg(long)]
    report: Option<String>,

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

        /// Also build sources marked `fixture = true` (mock data in data/fixtures)
        #[arg(long)]
        include_fixtures: bool,
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

/// WAL by default; OTSO_SQLITE_JOURNAL=delete for databases on a network
/// share (SMB/NFS), where WAL's shared-memory locking isn't reliable.
pub(crate) fn journal_mode_pragma() -> &'static str {
    match std::env::var("OTSO_SQLITE_JOURNAL").map(|v| v.to_lowercase()).as_deref() {
        Ok("delete") => "PRAGMA journal_mode = DELETE",
        _ => "PRAGMA journal_mode = WAL",
    }
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
        Commands::Build { source, meili_only, include_fixtures } => {
            let opts = BuildOptions {
                sources_dir: cli.sources_dir.as_deref(),
                local_copy_dir: cli.local_copy_dir.as_deref().map(std::path::Path::new),
                report: cli.report.as_deref(),
                source: source.as_deref(),
                meili_only,
                include_fixtures,
            };
            run_build(&cli.data_dir, &config, opts).await
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

struct BuildOptions<'a> {
    sources_dir: Option<&'a str>,
    local_copy_dir: Option<&'a std::path::Path>,
    report: Option<&'a str>,
    source: Option<&'a str>,
    meili_only: bool,
    include_fixtures: bool,
}

async fn run_build(data_dir: &str, config: &config::Config, opts: BuildOptions<'_>) -> Result<()> {
    let started = std::time::Instant::now();
    let mut run = report::RunReport::start();

    let sources = match opts.source {
        Some(name) => {
            let src = config.sources.iter()
                .find(|s| s.name == name)
                .ok_or_else(|| anyhow::anyhow!("Source not found: {}", name))?;
            vec![src.clone()]
        }
        // Fixture sources (mock accounts in data/fixtures) only belong in a
        // fixtures build; in a real one they'd just be "Database not found".
        None => config.sources.iter()
            .filter(|s| s.enabled && (opts.include_fixtures || !s.fixture))
            .cloned()
            .collect()
    };

    tracing::info!("Building {} sources", sources.len());

    if opts.meili_only {
        tracing::info!("Meilisearch-only mode: skipping event store ingestion");
        // TODO: Implement meili rebuild from event store
        return Ok(());
    }

    // Initialize event store (wrapped in Arc for sharing across tasks)
    let event_store = Arc::new(event_store::SqliteEventStore::open(data_dir).await?);

    // Recover any pending batches from previous runs
    let recovered = event_store.recover_pending().await?;
    if !recovered.is_empty() {
        tracing::warn!("Recovered {} pending batches from previous run", recovered.len());
    }

    // Determine source data directory: CLI flag, then config, then <data_dir>/sources
    let source_data_dir: Arc<str> = opts.sources_dir
        .map(str::to_string)
        .or_else(|| config.defaults.data_dir.clone())
        .unwrap_or_else(|| format!("{}/sources", data_dir))
        .into();
    tracing::info!("Reading source databases from {}", source_data_dir);
    let local_copy_dir: Option<Arc<std::path::Path>> = opts.local_copy_dir.map(Arc::from);
    if let Some(dir) = &local_copy_dir {
        tracing::info!("Reading from local copies in {}", dir.display());
    }

    // Process sources in parallel using JoinSet (NFR-004)
    let mut join_set: JoinSet<report::SourceReport> = JoinSet::new();

    for source_config in sources {
        let store = Arc::clone(&event_store);
        let data_dir = Arc::clone(&source_data_dir);
        let copy_dir = local_copy_dir.clone();

        join_set.spawn(async move {
            tracing::info!("Processing source: {}", source_config.name);
            process_source(&store, &data_dir, copy_dir.as_deref(), &source_config).await
        });
    }

    // Collect results
    while let Some(result) = join_set.join_next().await {
        match result {
            Ok(source) => {
                match &source.error {
                    None if source.extract.missing => {}
                    None => tracing::info!(
                        "  {} events: {} inserted, {} skipped ({:.1}s)",
                        source.name,
                        source.inserted,
                        source.skipped,
                        source.total_ms as f64 / 1000.0
                    ),
                    Some(e) => tracing::error!("  {} failed: {}", source.name, e),
                }
                run.sources.push(source);
            }
            Err(join_error) => {
                tracing::error!("Task panicked: {}", join_error);
                run.sources.push(report::SourceReport::failed("(panicked task)", join_error.to_string()));
            }
        }
    }
    run.sources.sort_by(|a, b| a.name.cmp(&b.name));

    let failed = run.sources.iter().filter(|s| s.error.is_some()).count();
    tracing::info!(
        "Completed {} sources ({} succeeded, {} failed)",
        run.sources.len(),
        run.sources.len() - failed,
        failed
    );

    // Update projections
    tracing::info!("Updating projections...");
    let projection = projections::update_all(data_dir, &event_store).await;
    match &projection {
        Ok(stats) => {
            run.projection = Some(report::ProjectionReport {
                added: stats.entries_added,
                ms: stats.duration_ms as u64,
                error: None,
            })
        }
        Err(e) => {
            run.projection = Some(report::ProjectionReport { added: 0, ms: 0, error: Some(format!("{:#}", e)) })
        }
    }

    run.duration_ms = started.elapsed().as_millis() as u64;
    if let Some(path) = opts.report {
        if let Err(e) = run.write(path) {
            tracing::warn!("Couldn't write the run report to {}: {}", path, e);
        }
    }

    projection?;
    Ok(())
}

async fn process_source(
    event_store: &Arc<event_store::SqliteEventStore>,
    source_data_dir: &str,
    local_copy_dir: Option<&std::path::Path>,
    source_config: &config::SourceConfig,
) -> report::SourceReport {
    let started = std::time::Instant::now();
    let mut out = report::SourceReport::new(&source_config.name);

    let result: Result<()> = async {
        // Read first: a failed or missing source then leaves no batch behind.
        let (events, extract) = extractors::extract(source_data_dir, source_config, local_copy_dir).await?;
        out.events = events.len() as i64;
        out.extract = extract;
        if out.extract.missing {
            return Ok(());
        }

        let write_started = std::time::Instant::now();
        let tx = event_store.begin_batch(&source_config.name).await?;
        let batch_id = tx.batch_id;
        match event_store.append_many(&tx, &events).await {
            Ok(_) => {
                let stats = event_store.commit(tx).await?;
                out.inserted = stats.inserted;
                out.skipped = out.events - stats.inserted;
            }
            Err(e) => {
                // Soft-delete what this batch wrote before the error.
                event_store.rollback_batch(batch_id).await.ok();
                return Err(e);
            }
        }
        out.write_ms = write_started.elapsed().as_millis() as u64;
        Ok(())
    }
    .await;

    if let Err(e) = result {
        out.error = Some(format!("{:#}", e));
    }
    out.total_ms = started.elapsed().as_millis() as u64;
    out
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
