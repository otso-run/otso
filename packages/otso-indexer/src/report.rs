use anyhow::Result;
use serde::Serialize;

use crate::extractors::ExtractReport;

/// What one `build` did, written as JSON with `--report <path>`.
/// otso-cli appends it to ~/.otso/logs/runs.jsonl and `otso log` reads it.
#[derive(Debug, Serialize)]
pub struct RunReport {
    pub started_at: String,
    pub duration_ms: u64,
    pub sources: Vec<SourceReport>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub projection: Option<ProjectionReport>,
}

#[derive(Debug, Serialize)]
pub struct SourceReport {
    pub name: String,
    /// Events read (after aggregation).
    pub events: i64,
    /// New this run, stored but changed (rewritten in place), and stored
    /// and unchanged (or repeated within the batch).
    pub inserted: i64,
    pub updated: i64,
    pub skipped: i64,
    pub total_ms: u64,
    pub write_ms: u64,
    #[serde(flatten)]
    pub extract: ExtractReport,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ProjectionReport {
    pub added: i64,
    pub ms: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl RunReport {
    pub fn start() -> Self {
        Self {
            started_at: chrono::Utc::now().to_rfc3339(),
            duration_ms: 0,
            sources: vec![],
            projection: None,
        }
    }

    pub fn write(&self, path: &str) -> Result<()> {
        std::fs::write(path, serde_json::to_vec(self)?)?;
        Ok(())
    }
}

impl SourceReport {
    pub fn new(name: &str) -> Self {
        Self {
            name: name.to_string(),
            events: 0,
            inserted: 0,
            updated: 0,
            skipped: 0,
            total_ms: 0,
            write_ms: 0,
            extract: ExtractReport::default(),
            error: None,
        }
    }

    pub fn failed(name: &str, error: String) -> Self {
        Self { error: Some(error), ..Self::new(name) }
    }
}
