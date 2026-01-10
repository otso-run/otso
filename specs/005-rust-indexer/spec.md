# Feature Specification: Rust Indexer Refactor

**Feature Branch**: `002-data-ingestion-and-search`
**Created**: 2025-01-10
**Status**: Draft
**Input**: Refactor Chronicle's indexer with improved architecture

---

## Problem Statement

Chronicle's Rust indexer has 1260 lines with 50+ source configurations hardcoded. Key issues:

1. **Hardcoded Configuration**: Source definitions require recompilation to modify
2. **No Validation**: SQL errors discovered at runtime
3. **Brittle Timestamps**: 15+ ad-hoc date format handlers
4. **No Transactions**: Partial failures leave inconsistent state
5. **No Aggregation**: High-volume sources indexed as-is
6. **Coupled Components**: Extraction, transformation, and indexing are interleaved

## User Scenarios & Testing *(mandatory)*

### Primary User Story
As a data operator, I want to configure sources via TOML files and run the indexer without recompilation, so that I can easily add, modify, or disable data sources.

### Acceptance Scenarios
1. **Given** a `sources.toml` file, **When** the indexer starts, **Then** it loads and validates all configurations before processing
2. **Given** a timestamp in any of the 15+ formats, **When** it's parsed, **Then** it returns a valid Unix timestamp or a clear error
3. **Given** a source is marked `enabled = false`, **When** the indexer runs, **Then** that source is skipped
4. **Given** an aggregation config for Timing, **When** processing completes, **Then** 2.2M records become ~50K daily summaries
5. **Given** a batch fails mid-process, **When** recovery runs, **Then** all events from that batch are rolled back

### Edge Cases
- What happens when `sources.toml` doesn't exist?
- How does the indexer handle sources with no matching database?
- What occurs when SQL syntax is valid but returns wrong columns?
- How does aggregation handle events spanning time zone boundaries?

## Requirements *(mandatory)*

### Functional Requirements

#### Configuration Loading
- **FR-001**: Indexer MUST load source configurations from `sources.toml`
- **FR-002**: Indexer MUST validate all configurations before processing begins
- **FR-003**: Indexer MUST report validation errors with line numbers and suggestions
- **FR-004**: Indexer MUST support `--source <name>` to process a single source

#### Pipeline Architecture
- **FR-005**: Indexer MUST separate extraction, transformation, and loading phases
- **FR-006**: Indexer MUST use the event store for all persistence
- **FR-007**: Indexer MUST trigger projection updates after batch commit
- **FR-008**: Indexer MUST support `--rebuild` to fully rebuild projections

#### Timestamp Parsing
- **FR-009**: Indexer MUST parse all known timestamp formats (ISO8601, Unix, RFC2822)
- **FR-010**: Indexer MUST validate timestamps are in reasonable range (1970-2100)
- **FR-011**: Indexer MUST log unparseable timestamps with source context
- **FR-012**: Indexer MUST NOT silently drop events with bad timestamps

#### Aggregation
- **FR-013**: Indexer MUST support aggregation strategies per source
- **FR-014**: Indexer MUST apply aggregation before event store insertion
- **FR-015**: Indexer MUST preserve original count in aggregated entries
- **FR-016**: Aggregation MUST be idempotent (same input = same output)

#### CLI Interface
- **FR-017**: Indexer MUST provide `build` command for full indexing
- **FR-018**: Indexer MUST provide `stats` command for source statistics
- **FR-019**: Indexer MUST provide `validate` command to check configuration
- **FR-020**: Indexer MUST provide `rebuild` command for projection rebuilds

### Non-Functional Requirements
- **NFR-001**: Configuration validation MUST complete in under 1 second
- **NFR-002**: Indexer MUST process 10,000 events/second on commodity hardware
- **NFR-003**: Memory usage MUST stay under 500MB for typical workloads
- **NFR-004**: Indexer MUST support parallel source processing

## Key Entities *(mandatory)*

### CLI Commands
- **build**: Index all enabled sources (default)
- **build --source <name>**: Index specific source
- **build --meili-only**: Rebuild Meilisearch only
- **stats**: Show per-source statistics
- **validate**: Validate configuration without processing
- **rebuild**: Full projection rebuild from event store

### Pipeline Phases
1. **Config**: Load and validate `sources.toml`
2. **Extract**: Read records from source databases
3. **Transform**: Parse timestamps, apply aggregation, create events
4. **Load**: Append to event store in batch transaction
5. **Project**: Update FTS5 and Meilisearch projections

---

## Review & Acceptance Checklist

### Content Quality
- [x] Focused on indexer improvements
- [x] Pipeline architecture defined
- [x] CLI interface specified
- [x] All mandatory sections completed
