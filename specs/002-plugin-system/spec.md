# Feature Specification: Data Source Plugin System

**Feature Branch**: `002-data-ingestion-and-search`
**Created**: 2025-01-10
**Status**: Draft
**Input**: Migrate Chronicle's 50+ data sources into Otso with improved architecture

## Execution Flow (main)
```
1. Parse feature request from Input
   → If empty: ERROR "No feature description provided"
2. Extract key concepts from Chronicle analysis
   → Identify: source configurations, extraction patterns, schema mappings
3. For each unclear aspect:
   → Mark with [NEEDS CLARIFICATION: specific question]
4. Fill User Scenarios & Testing section
   → If no clear user flow: ERROR "Cannot determine user scenarios"
5. Generate Functional Requirements
   → Each requirement must be testable
   → Mark ambiguous requirements
6. Identify Key Entities (configuration schemas)
7. Run Review Checklist
   → If any [NEEDS CLARIFICATION]: WARN "Spec has uncertainties"
   → If implementation details found: WARN "Consider abstracting"
8. Return: SUCCESS (spec ready for planning)
```

---

## ⚡ Quick Guidelines
- ✅ Focus on WHAT the plugin system enables and WHY
- ✅ Define configuration formats (these are the "contracts")
- ❌ Avoid internal implementation details (code structure, specific libraries)
- 👥 Written for developers who will create new plugins

### Section Requirements
- **Mandatory sections**: Must be completed for every feature
- **Optional sections**: Include only when relevant to the feature
- When a section doesn't apply, remove it entirely (don't leave as "N/A")

---

## Problem Statement

Chronicle has 50+ data sources with configurations hardcoded in a 1260-line Rust file (`main.rs`). This creates several issues:

1. **Recompilation Required**: Adding or modifying a source requires rebuilding the Rust indexer
2. **No Validation**: Source configurations are not validated until runtime
3. **No Discoverability**: No way to list available sources or their capabilities
4. **Schema Inconsistencies**: Some sources follow Chronicle schema, others use custom schemas
5. **No Plugin Lifecycle**: No hooks for initialization, cleanup, or error handling

## User Scenarios & Testing *(mandatory)*

### Primary User Story
As a data system administrator, I want to configure data sources through external files, so that I can add, modify, or disable sources without recompiling the indexer.

### Secondary User Story
As a plugin developer, I want a clear contract for creating new data source plugins, so that I can add support for new platforms without understanding the entire system.

### Acceptance Scenarios
1. **Given** a TOML configuration file exists, **When** the indexer starts, **Then** it loads all enabled sources from the config without code changes
2. **Given** a source configuration has invalid SQL, **When** the configuration is validated, **Then** the error is reported with line number and suggestion
3. **Given** a high-volume source (>1M records), **When** aggregation is configured, **Then** only aggregated entries are indexed (e.g., daily summaries)
4. **Given** a source's database doesn't exist, **When** the indexer runs, **Then** the source is skipped with a warning (not an error)
5. **Given** a plugin manifest exists, **When** listing available sources, **Then** all discoverable plugins are shown with their capabilities

### Edge Cases
- What happens when `sources.toml` has syntax errors?
- How does the system handle circular references between sources?
- What occurs when a source's SQL returns unexpected column types?
- How does aggregation handle gaps in data (missing days)?
- What happens when credentials are missing for API-based sources?

## Requirements *(mandatory)*

### Functional Requirements

#### Configuration Loading
- **FR-001**: System MUST load source configurations from external TOML file(s)
- **FR-002**: System MUST validate all configurations before processing begins
- **FR-003**: System MUST support enabling/disabling individual sources without removing their config
- **FR-004**: System MUST support default values that apply to all sources
- **FR-005**: System MUST allow per-source overrides of default values

#### Source Definition
- **FR-006**: Each source MUST have a unique name identifier
- **FR-007**: Each source MUST specify its database path relative to data directory
- **FR-008**: Each source MUST define one or more SQL queries for data extraction
- **FR-009**: Each query MUST specify the entry type it produces (listen, visit, bookmark, etc.)
- **FR-010**: Each query MUST map to Schema.org action and object types

#### Validation
- **FR-011**: System MUST validate SQL syntax before execution
- **FR-012**: System MUST validate that referenced tables exist in the source database
- **FR-013**: System MUST validate field mappings match expected types
- **FR-014**: System MUST provide clear error messages with fix suggestions

#### Aggregation
- **FR-015**: System MUST support aggregation strategies for high-volume sources
- **FR-016**: System MUST support daily, hourly, and unique-per-bucket aggregation
- **FR-017**: System MUST support specifying key fields for aggregation grouping
- **FR-018**: Aggregation MUST preserve original record counts in metadata

#### Plugin Discovery
- **FR-019**: System MUST discover plugins as Rust crates in a designated plugins directory
- **FR-020**: Each plugin MUST implement the `Extractor` trait
- **FR-021**: Plugin crates MUST specify extractors and their capabilities via Cargo.toml metadata
- **FR-022**: Plugins MUST specify credential requirements via typed configuration structs

#### Error Handling
- **FR-023**: Configuration errors MUST be non-fatal (other sources continue)
- **FR-024**: Missing databases MUST be warnings (not errors)
- **FR-025**: Failed queries MUST log errors with source context

### Non-Functional Requirements
- **NFR-001**: Configuration loading MUST complete in under 1 second for 100 sources
- **NFR-002**: Validation MUST provide actionable error messages
- **NFR-003**: System MUST work without network access (local files only)

## Key Entities *(mandatory)*

### SourcesConfig (Root)
**Purpose**: Top-level configuration container
- **defaults**: Default values for all sources
- **sources**: Array of individual source configurations

### SourceConfig
**Purpose**: Configuration for a single data source
- **name**: Unique source identifier (e.g., "spotify", "github")
- **enabled**: Whether to process this source (default: true)
- **db_path**: Path to SQLite database relative to data directory
- **category**: Semantic category (music, browse, social, comms, etc.)
- **visibility_default**: Default visibility for entries (public, unlisted, private)
- **aggregation**: Optional aggregation configuration
- **queries**: Array of SQL queries for data extraction

### QueryConfig
**Purpose**: SQL query definition for extracting data
- **table**: Target table name (for validation)
- **entry_type**: Type of entry produced (listen, visit, bookmark, etc.)
- **action_type**: Schema.org action type (ListenAction, ViewAction, etc.)
- **object_type**: Schema.org object type (MusicRecording, WebPage, etc.)
- **sql**: SQL query returning: external_id, title, content, ts_raw, url
- **field_mappings**: Optional field type definitions for validation

### AggregationConfig
**Purpose**: Configuration for high-volume source aggregation
- **strategy**: Aggregation method (daily, hourly, unique_per_bucket, first_last)
- **key_fields**: Fields to group by (e.g., ["app_name", "project"])
- **time_bucket**: Time granularity (day, hour)

### PluginManifest
**Purpose**: Metadata for a data extraction plugin
- **name**: Plugin identifier
- **version**: Semantic version
- **description**: Human-readable description
- **language**: Implementation language (ruby, python)
- **entry_point**: Path to main file
- **credentials**: Required credential fields
- **extractors**: Available extraction methods
- **schema**: Action and object types produced

---

## Constraints

### Chronicle Compatibility
- MUST support all 50+ existing Chronicle sources
- MUST produce same entry format as current system
- MUST maintain Schema.org type mappings

### Otso Architecture Alignment
- MUST respect Otso's visibility levels (public, unlisted, private, secret)
- MUST integrate with event store architecture (batch IDs, transactions)
- MUST support rebuild-from-events pattern for projections

---

## Clarifications

### Session 2025-01-10
- Q: Should sources.toml be a single file or split per-source? → A: Single file for simplicity, can split later if needed
- Q: Should plugin manifests be required for all sources? → A: Only for Ruby/Python extractors, not for SQL-only sources
- Q: How to handle sources that don't follow Chronicle schema? → A: Add schema mapping in query config, enforce at validation time

---

## Review & Acceptance Checklist
*GATE: Automated checks run during main() execution*

### Content Quality
- [x] Focused on user value and developer experience
- [x] Configuration contracts clearly defined
- [x] Written for plugin developers
- [x] All mandatory sections completed

### Requirement Completeness
- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

---

## Execution Status
*Updated by main() during processing*

- [x] User description parsed
- [x] Key concepts extracted from Chronicle
- [x] Ambiguities marked and resolved
- [x] User scenarios defined
- [x] Requirements generated
- [x] Entities identified
- [x] Review checklist passed
