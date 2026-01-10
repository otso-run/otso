# Feature Specification: Search Projections

**Feature Branch**: `002-data-ingestion-and-search`
**Created**: 2025-01-10
**Status**: Draft
**Input**: Design search index projections for SQLite FTS5 and Meilisearch

---

## Problem Statement

Chronicle maintains dual search indexes (SQLite FTS5 and Meilisearch) that can diverge during failures. There's no mechanism to ensure consistency or rebuild from the source of truth.

Issues identified:
1. **Index Divergence**: FTS5 and Meilisearch can get out of sync
2. **No Atomic Updates**: Index updates are not tied to batch transactions
3. **No Visibility Enforcement**: Private/secret events can appear in search
4. **No Rebuild Capability**: Indexes cannot be rebuilt from events
5. **No Facet Updates**: Adding new facets requires manual reindexing

## User Scenarios & Testing *(mandatory)*

### Primary User Story
As a search user, I want consistent search results across both local (FTS5) and server (Meilisearch) backends, so that my search experience is the same regardless of connectivity.

### Secondary User Story
As a system operator, I want to rebuild search indexes from the event store, so that I can recover from corruption or apply schema changes.

### Acceptance Scenarios
1. **Given** events are committed to the event store, **When** projections are updated, **Then** both FTS5 and Meilisearch contain identical searchable content
2. **Given** an event has visibility "secret", **When** projections are built, **Then** the event does not appear in any search index
3. **Given** a batch is rolled back, **When** projections are updated, **Then** the rolled-back events are removed from search
4. **Given** a new facet is added to the schema, **When** projections are rebuilt, **Then** the new facet is populated for all events
5. **Given** Meilisearch is unavailable, **When** projections are updated, **Then** FTS5 is still updated (degraded mode)

### Edge Cases
- What happens when Meilisearch index swap fails?
- How does the system handle very large rebuilds (5M+ events)?
- What occurs when event payloads are malformed JSON?
- How does aggregation interact with projection building?
- What happens when FTS5 tokenization differs from Meilisearch?

## Requirements *(mandatory)*

### Functional Requirements

#### Projection Pattern
- **FR-001**: Search indexes MUST be treated as projections derived from the event store
- **FR-002**: Projections MUST be rebuildable from events at any time
- **FR-003**: Projections MUST track their last processed event for incremental updates
- **FR-004**: Projections MUST support both full rebuild and incremental update modes

#### SQLite FTS5 Projection
- **FR-005**: System MUST maintain an FTS5 full-text index for offline search
- **FR-006**: FTS5 MUST support prefix matching and phrase search
- **FR-007**: FTS5 MUST use porter stemming for English content
- **FR-008**: FTS5 index MUST be in a separate database file (not in events.db)

#### Meilisearch Projection
- **FR-009**: System MUST maintain a Meilisearch index for server-based search
- **FR-010**: Meilisearch MUST support faceted search by source and category
- **FR-011**: Meilisearch MUST use atomic index swapping for rebuilds
- **FR-012**: Meilisearch MUST be optional (system works without it)

#### Visibility Enforcement
- **FR-013**: Secret events MUST never be indexed in any projection
- **FR-014**: Private events MUST only be searchable by authenticated owner
- **FR-015**: Visibility filters MUST be applied at query time, not just index time

#### Search Entry Format
- **FR-016**: Each indexed entry MUST include: id, source, entry_type, title, content, ts
- **FR-017**: Entries MUST include category and action_type facets
- **FR-018**: Entries MUST include year and month fields for date filtering

#### Consistency
- **FR-019**: Both projections MUST process events in the same order
- **FR-020**: Failed projection updates MUST be retryable
- **FR-021**: Projection state MUST survive process restarts

### Non-Functional Requirements
- **NFR-001**: Incremental update MUST process 1000 events/second
- **NFR-002**: Full rebuild MUST complete in under 10 minutes for 1M events
- **NFR-003**: Search latency MUST be under 100ms for typical queries
- **NFR-004**: FTS5 database size MUST be under 2x event payload size

## Key Entities *(mandatory)*

### SearchEntry
**Purpose**: Denormalized entry for search indexing
- **id**: Integer - sequential ID for this projection
- **event_id**: UUID - reference back to event store
- **source**: String - source identifier
- **entry_type**: String - listen, visit, bookmark, etc.
- **action_type**: String - Schema.org action type
- **object_type**: String - Schema.org object type
- **title**: String - primary searchable text
- **content**: String - secondary searchable text
- **ts**: Integer - Unix timestamp
- **external_id**: String - original source ID
- **url**: String - optional URL
- **visibility**: String - for runtime filtering
- **category**: String - semantic category (music, browse, etc.)
- **year**: Integer - extracted from timestamp
- **month**: String - "YYYY-MM" format for range queries

### ProjectionState
**Purpose**: Track projection progress
- **projection_name**: String - "fts5" or "meilisearch"
- **last_event_id**: UUID - last processed event
- **last_updated_at**: Integer - timestamp
- **entry_count**: Integer - total entries
- **status**: String - healthy, rebuilding, error
- **error_message**: String - last error if any

---

## Constraints

### Chronicle Compatibility
- Entry format MUST match Chronicle's current search schema
- Categories MUST use same semantic groupings

### Performance
- MUST handle Chronicle's ~1.3M indexed events efficiently
- Batch size MUST be configurable (default 10,000)
- Must support parallel processing where possible

---

## Review & Acceptance Checklist

### Content Quality
- [x] Focused on search functionality
- [x] Dual-backend approach clearly defined
- [x] Visibility enforcement specified
- [x] All mandatory sections completed

### Requirement Completeness
- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable
- [x] Success criteria are measurable
- [x] Scope is clearly bounded
