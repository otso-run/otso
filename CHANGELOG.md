# Changelog

All notable changes to Otso will be documented in this file.

## [Unreleased]

### Added

- **Aggregation strategies for high-volume sources** — Daily, hourly, and session-based aggregation reduces millions of records to manageable summaries
  - `daily` — Groups events by date + key fields
  - `hourly` — Groups events by hour + key fields
  - `session` — Groups events with configurable gap threshold (default 30 min)
- **Documentation site** at otso.run with tutorials and reference docs
- **Run Local Search tutorial** — Step-by-step guide to set up indexer and search UI
- **sources.toml reference** — Complete configuration documentation

### Changed

- Revised documentation to clearly separate "Available Now" from "Roadmap" features
- Updated architecture diagrams to reflect current working components

### Fixed

- Fixed localhost URL in tutorial that was breaking Vercel builds

## [0.1.0] - 2025-01-10

### Added

- **otso-indexer** — Rust-based data indexer
  - Configuration-driven source extraction via `sources.toml`
  - Parallel source processing with JoinSet
  - Batch transactions with automatic rollback
  - Robust timestamp parsing (15+ formats)
  - FTS5 search projection
  - 23 pre-configured sources across 14 categories

- **otso-search** — SvelteKit search UI
  - Full-text search across all indexed sources
  - Timeline histogram visualization
  - Category and source filtering
  - Date range selection
  - Keyboard navigation
  - Virtual scrolling for large result sets

- **Test coverage**
  - 30 Rust tests (config, timestamp, event store, aggregation)
  - Playwright tests for search UI
