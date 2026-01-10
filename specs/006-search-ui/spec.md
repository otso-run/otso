# Feature Specification: Search Web UI

**Feature Branch**: `002-data-ingestion-and-search`
**Created**: 2025-01-10
**Status**: Draft
**Input**: Migrate Chronicle's SvelteKit search UI to Otso

---

## Problem Statement

Chronicle has a working SvelteKit search frontend that needs to be migrated to Otso. The migration should:

1. Preserve all existing functionality
2. Update branding to Otso
3. Integrate with new event store API
4. Support visibility filtering for privacy

## User Scenarios & Testing *(mandatory)*

### Primary User Story
As a user, I want to search across all my data sources from a web interface, so that I can find and browse my personal history.

### Acceptance Scenarios
1. **Given** I'm on the search page, **When** I type a query, **Then** I see results from all sources with highlighting
2. **Given** search results are displayed, **When** I filter by source, **Then** only results from that source appear
3. **Given** I have Meilisearch available, **When** I search, **Then** I get typo-tolerant results with facets
4. **Given** Meilisearch is unavailable, **When** I search, **Then** I get FTS5 results (degraded mode)
5. **Given** I click on a result, **When** the detail modal opens, **Then** I see full content and metadata

### Edge Cases
- What happens when both search backends are unavailable?
- How does the UI handle very long search results?
- What occurs when a source icon is missing?
- How does timeline histogram work with sparse data?

## Requirements *(mandatory)*

### Functional Requirements

#### Search Interface
- **FR-001**: UI MUST provide a search input with instant search
- **FR-002**: UI MUST display results in a scrollable list
- **FR-003**: UI MUST highlight matching terms in results
- **FR-004**: UI MUST show source icon and entry type for each result

#### Filtering
- **FR-005**: UI MUST provide source filter with counts
- **FR-006**: UI MUST provide date range filter by month
- **FR-007**: UI MUST provide category filter (music, browse, social, etc.)
- **FR-008**: Filters MUST be combinable (AND logic)

#### Timeline
- **FR-009**: UI MUST display timeline histogram above results
- **FR-010**: Timeline MUST show activity by month/year
- **FR-011**: Timeline MUST be colored by source category
- **FR-012**: Clicking timeline section MUST filter to that date range

#### Detail View
- **FR-013**: UI MUST show detail modal when clicking a result
- **FR-014**: Detail MUST display full content, metadata, and external link
- **FR-015**: Detail MUST be closable via escape key or backdrop click

#### API Integration
- **FR-016**: UI MUST connect to search API endpoint
- **FR-017**: UI MUST gracefully handle API errors
- **FR-018**: UI MUST show loading state during search
- **FR-019**: UI MUST display which backend is being used (FTS5/Meilisearch)

### Non-Functional Requirements
- **NFR-001**: Search results MUST appear in under 200ms
- **NFR-002**: UI MUST be responsive on mobile and desktop
- **NFR-003**: UI MUST work in all modern browsers
- **NFR-004**: Initial page load MUST be under 1 second

## Key Components *(from Chronicle)*

### Components to Migrate
- `+page.svelte` - Main search page
- `TimelineHistogram.svelte` - Activity timeline
- `CategoryFilters.svelte` - Source/category filters
- `SearchResults.svelte` - Result list
- `DocumentModal.svelte` - Detail view

### API Endpoints to Migrate
- `POST /api/search` - Search with filters
- `GET /api/timeline` - Timeline histogram data
- `GET /api/stats` - Index statistics
- `GET /api/document/[id]` - Document detail

### Data Files to Migrate
- `sources.ts` - Source metadata and icons
- `actions.ts` - Entry type to verb mapping

---

## Migration Checklist

### Phase 1: Copy and Rename
- [ ] Copy Chronicle's `/apps/search` to Otso `/packages/otso-search`
- [ ] Update package.json name and dependencies
- [ ] Update svelte.config.js for Otso paths
- [ ] Remove Chronicle-specific branding

### Phase 2: API Integration
- [ ] Update search API to use new event store
- [ ] Update timeline API for new schema
- [ ] Add visibility filtering to all endpoints
- [ ] Test dual-backend fallback

### Phase 3: Styling
- [ ] Update colors to Otso palette (if defined)
- [ ] Update logo and favicon
- [ ] Test responsive layout
- [ ] Verify accessibility

---

## Review & Acceptance Checklist

### Content Quality
- [x] Focused on UI migration
- [x] Component inventory defined
- [x] API endpoints specified
- [x] All mandatory sections completed
