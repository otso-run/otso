use sqlx::sqlite::SqliteConnectOptions;
use sqlx::ConnectOptions;
use std::path::Path;
use std::time::Duration;

/// Connection options shared by every database the indexer opens.
///
/// sqlx warns about every statement slower than a second, which on a big
/// rebuild is hundreds of lines. The indexer times its own queries and puts
/// the slow ones in the run report (see `report.rs`), so sqlx's copy of that
/// goes to debug level only.
pub fn options(path: &Path) -> SqliteConnectOptions {
    SqliteConnectOptions::new()
        .filename(path)
        .log_slow_statements(log::LevelFilter::Debug, Duration::from_secs(1))
}

/// A writable database, created if missing.
pub fn read_write(path: &Path) -> SqliteConnectOptions {
    options(path).create_if_missing(true)
}

/// A source database, opened read-only. `immutable` skips SQLite's locking
/// and change detection entirely, which is only safe for a private copy that
/// nothing else writes to (see `extractors::local_copy`).
pub fn read_only(path: &Path, immutable: bool) -> SqliteConnectOptions {
    options(path).read_only(true).immutable(immutable)
}
