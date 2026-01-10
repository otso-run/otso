# Feature Specification: Event Store Architecture

**Feature Branch**: `002-data-ingestion-and-search`
**Created**: 2025-01-10
**Status**: Draft
**Input**: Design unified event store for Otso data pipeline

---

## Problem Statement

Chronicle stores data in per-source SQLite databases with no unified view or transaction support. This creates several issues:

1. **No Transaction Support**: Partial failures during indexing leave inconsistent state
2. **No Rollback**: Cannot undo failed batch operations
3. **Per-Source Isolation**: Cross-source queries require search index
4. **No Audit Trail**: No record of when data was ingested or modified
5. **No Visibility Enforcement**: Privacy levels not enforced at storage layer

## User Scenarios & Testing *(mandatory)*

### Primary User Story
As a data system operator, I want all ingested data stored in a unified event store with transaction support, so that failed operations can be rolled back without leaving corrupted state.

### Secondary User Story
As a privacy-conscious user, I want visibility levels enforced at the storage layer, so that private data is never accidentally exposed in search results.

### Acceptance Scenarios
1. **Given** a batch of 1000 events is being ingested, **When** an error occurs at event 500, **Then** all 1000 events are rolled back and the store remains in its previous state
2. **Given** events exist from multiple sources, **When** I query the event store directly, **Then** I can filter and aggregate across all sources
3. **Given** an event has visibility "private", **When** search projections are built, **Then** that event is excluded from searchable indexes
4. **Given** a batch was successfully committed, **When** I need to undo it, **Then** I can soft-delete all events in that batch by batch_id
5. **Given** the indexer crashes during processing, **When** it restarts, **Then** it can identify and roll back any pending batches

### Edge Cases
- What happens when SQLite file is corrupted?
- How does the system handle concurrent writes from multiple extractors?
- What occurs when disk space runs out during a batch?
- How does soft-delete interact with unique constraints?
- What happens when an event's timestamp is in the future?

## Requirements *(mandatory)*

### Functional Requirements

#### Event Storage
- **FR-001**: System MUST use append-only event storage (events are never modified, only marked deleted)
- **FR-002**: Each event MUST have a globally unique event_id (UUID)
- **FR-003**: Each event MUST record source, source_id, and event_type
- **FR-004**: Each event MUST store occurred_at (when it happened) and ingested_at (when we recorded it)
- **FR-005**: Each event MUST have a visibility level (public, unlisted, private, secret)

#### Transaction Support
- **FR-006**: System MUST support batch transactions with atomic commit/rollback
- **FR-007**: Each batch MUST have a unique batch_id for tracking
- **FR-008**: Failed batches MUST be automatically rolled back
- **FR-009**: Committed batches MUST be recorded with event count and timestamp
- **FR-010**: System MUST recover pending batches on startup and roll them back

#### Soft Delete
- **FR-011**: Events MUST support soft delete via deleted_at timestamp
- **FR-012**: Deleted events MUST be excluded from normal queries
- **FR-013**: Batch rollback MUST soft-delete all events with matching batch_id
- **FR-014**: System MUST support hard delete for GDPR/data retention compliance

#### Deduplication
- **FR-015**: System MUST prevent duplicate events based on (source, source_id, event_type)
- **FR-016**: Duplicate detection MUST work across batches
- **FR-017**: System MUST support upsert semantics for re-ingestion

#### Visibility Enforcement
- **FR-018**: Secret events MUST never be written to projections
- **FR-019**: Private events MUST only be visible to authenticated owner
- **FR-020**: Visibility level MUST be immutable after creation (except by owner)

#### Sync State
- **FR-021**: System MUST track sync cursor per source for incremental extraction
- **FR-022**: System MUST record last successful sync timestamp per source
- **FR-023**: Sync state MUST be updated atomically with batch commit

### Non-Functional Requirements
- **NFR-001**: Batch commit MUST complete in under 100ms for 10,000 events
- **NFR-002**: Individual event insert MUST complete in under 1ms
- **NFR-003**: Storage MUST support 10 million+ events efficiently
- **NFR-004**: WAL mode MUST be enabled for concurrent read/write access

## Key Entities *(mandatory)*

### Event
**Purpose**: Single unit of data in the event store
- **event_id**: UUID - globally unique identifier
- **event_type**: String - "ingest", "update", "delete"
- **source**: String - source identifier (spotify, github, etc.)
- **source_id**: String - original ID from source
- **action_type**: String - Schema.org action (ListenAction, ViewAction, etc.)
- **object_type**: String - Schema.org object (MusicRecording, WebPage, etc.)
- **payload**: JSON - full event data
- **visibility**: Enum - public, unlisted, private, secret
- **occurred_at**: Integer - Unix timestamp of when event happened
- **ingested_at**: Integer - Unix timestamp of when we recorded it
- **batch_id**: UUID - batch this event belongs to (nullable for legacy)
- **deleted_at**: Integer - soft delete timestamp (null if not deleted)

### Batch
**Purpose**: Transaction unit for atomic operations
- **batch_id**: UUID - unique batch identifier
- **source**: String - source being processed
- **started_at**: Integer - when batch started
- **completed_at**: Integer - when batch finished (null if pending)
- **event_count**: Integer - number of events in batch
- **status**: Enum - pending, committed, rolled_back

### SyncState
**Purpose**: Track incremental sync progress per source
- **source**: String - source identifier (primary key)
- **last_cursor**: String - cursor for resuming extraction
- **last_sync_at**: Integer - when last sync completed
- **total_events**: Integer - cumulative events from this source
- **last_error**: String - last error message (null if success)
- **retry_count**: Integer - consecutive failures

## Constraints

### Chronicle Compatibility
- MUST be able to import existing per-source chronicle.db files
- MUST produce events that can rebuild Chronicle-compatible projections

### Otso Architecture Alignment
- MUST integrate with Rust indexer architecture
- MUST support projection rebuild pattern
- MUST enforce Otso visibility levels (public, unlisted, private, secret)

### Performance
- MUST handle Chronicle's ~5M events efficiently
- MUST support batch sizes up to 100,000 events
- MUST not degrade query performance as event count grows

---

## Review & Acceptance Checklist

### Content Quality
- [x] Focused on what the event store enables
- [x] Transaction semantics clearly defined
- [x] Written for developers implementing the store
- [x] All mandatory sections completed

### Requirement Completeness
- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable
- [x] Success criteria are measurable
- [x] Scope is clearly bounded

---

## Execution Status

- [x] Problem statement defined
- [x] User scenarios identified
- [x] Requirements generated
- [x] Entities defined
- [x] Constraints identified
- [x] Review checklist passed
