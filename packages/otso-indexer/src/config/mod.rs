use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::path::Path;

/// Top-level configuration from sources.toml
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    #[serde(default)]
    pub defaults: Defaults,
    #[serde(default)]
    pub sources: Vec<SourceConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Defaults {
    #[serde(default = "default_schema_version")]
    pub schema_version: String,
    #[serde(default)]
    pub data_dir: Option<String>,
}

fn default_schema_version() -> String {
    "1.0".to_string()
}

/// Configuration for a single data source
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SourceConfig {
    pub name: String,
    #[serde(default = "default_enabled")]
    pub enabled: bool,
    #[serde(default)]
    pub db_path: Option<String>,
    #[serde(default)]
    pub category: Option<String>,
    #[serde(default)]
    pub queries: Vec<QueryConfig>,
    #[serde(default)]
    pub aggregation: Option<AggregationConfig>,
    #[serde(default)]
    pub visibility: Option<String>,
}

fn default_enabled() -> bool {
    true
}

/// SQL query configuration for extracting events from a source
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueryConfig {
    pub table: String,
    pub entry_type: String,
    pub sql: String,
    #[serde(default)]
    pub action_type: Option<String>,
    #[serde(default)]
    pub object_type: Option<String>,
}

/// Aggregation strategy for high-volume sources
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AggregationConfig {
    pub strategy: AggregationStrategy,
    #[serde(default)]
    pub key_fields: Vec<String>,
    #[serde(default)]
    pub time_bucket: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum AggregationStrategy {
    Daily,
    Hourly,
    Session,
    None,
}

impl Default for AggregationStrategy {
    fn default() -> Self {
        Self::None
    }
}

/// Load configuration from a TOML file
pub fn load_config(path: &str) -> Result<Config> {
    let path = Path::new(path);

    if !path.exists() {
        anyhow::bail!(
            "Configuration file not found: {}\n\
             Create a sources.toml file or specify a different path with --config",
            path.display()
        );
    }

    let content = std::fs::read_to_string(path)
        .with_context(|| format!("Failed to read config file: {}", path.display()))?;

    let config: Config = toml::from_str(&content)
        .with_context(|| format!("Failed to parse TOML in: {}", path.display()))?;

    // Validate all sources
    for source in &config.sources {
        validate_source(source)
            .with_context(|| format!("Invalid source configuration: {}", source.name))?;
    }

    Ok(config)
}

/// Validate a source configuration
pub fn validate_source(source: &SourceConfig) -> Result<()> {
    // Name must not be empty
    if source.name.is_empty() {
        anyhow::bail!("Source name cannot be empty");
    }

    // Name must be valid identifier (alphanumeric + hyphens)
    if !source.name.chars().all(|c| c.is_alphanumeric() || c == '-' || c == '_') {
        anyhow::bail!(
            "Source name must contain only alphanumeric characters, hyphens, and underscores"
        );
    }

    // If enabled, must have either db_path or be a known special source type
    if source.enabled && source.db_path.is_none() && source.queries.is_empty() {
        anyhow::bail!(
            "Enabled source must have either db_path or queries defined"
        );
    }

    // Validate each query
    for (i, query) in source.queries.iter().enumerate() {
        validate_query(query)
            .with_context(|| format!("Invalid query at index {}", i))?;
    }

    // Validate aggregation if present
    if let Some(ref agg) = source.aggregation {
        validate_aggregation(agg)?;
    }

    Ok(())
}

fn validate_query(query: &QueryConfig) -> Result<()> {
    if query.table.is_empty() {
        anyhow::bail!("Query table cannot be empty");
    }
    if query.entry_type.is_empty() {
        anyhow::bail!("Query entry_type cannot be empty");
    }
    if query.sql.is_empty() {
        anyhow::bail!("Query sql cannot be empty");
    }

    // Basic SQL validation - must contain SELECT
    let sql_upper = query.sql.to_uppercase();
    if !sql_upper.contains("SELECT") {
        anyhow::bail!("Query SQL must be a SELECT statement");
    }

    Ok(())
}

fn validate_aggregation(agg: &AggregationConfig) -> Result<()> {
    // Daily/hourly strategies require key_fields
    if matches!(agg.strategy, AggregationStrategy::Daily | AggregationStrategy::Hourly) {
        if agg.key_fields.is_empty() {
            anyhow::bail!(
                "Aggregation strategy {:?} requires key_fields to be specified",
                agg.strategy
            );
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_minimal_config() {
        let toml = r#"
[[sources]]
name = "test"
db_path = "test.db"

[[sources.queries]]
table = "events"
entry_type = "test"
sql = "SELECT * FROM events"
"#;
        let config: Config = toml::from_str(toml).unwrap();
        assert_eq!(config.sources.len(), 1);
        assert_eq!(config.sources[0].name, "test");
        assert!(config.sources[0].enabled);
    }

    #[test]
    fn test_parse_with_aggregation() {
        let toml = r#"
[[sources]]
name = "timing"
db_path = "timing.db"

[sources.aggregation]
strategy = "daily"
key_fields = ["app_name", "project_path"]
"#;
        let config: Config = toml::from_str(toml).unwrap();
        let agg = config.sources[0].aggregation.as_ref().unwrap();
        assert_eq!(agg.strategy, AggregationStrategy::Daily);
        assert_eq!(agg.key_fields.len(), 2);
    }

    #[test]
    fn test_validate_empty_name() {
        let source = SourceConfig {
            name: "".to_string(),
            enabled: true,
            db_path: Some("test.db".to_string()),
            category: None,
            queries: vec![],
            aggregation: None,
            visibility: None,
        };
        assert!(validate_source(&source).is_err());
    }
}
