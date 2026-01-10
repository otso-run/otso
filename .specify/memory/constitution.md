<!-- Sync Impact Report
Version change: New → 1.0.0
Modified principles: N/A (initial version)
Added sections: All (initial creation)
Removed sections: N/A
Templates requiring updates:
  ✅ plan-template.md - references constitution v2.1.1, needs update
  ⚠ spec-template.md - needs review for alignment
  ⚠ tasks-template.md - needs review for alignment
  ⚠ agent-file-template.md - needs review for alignment
Follow-up TODOs:
  - RATIFICATION_DATE requires user confirmation or marking as TODO
-->

# Otso Constitution

## Core Principles

### I. Local-First Architecture
Every feature MUST prioritize local data storage and offline functionality. Data synchronization happens opportunistically, not as a requirement for functionality. Users maintain full control and ownership of their data without dependency on external services.

### II. IndieWeb Standards
All data formats and protocols MUST follow IndieWeb standards where applicable. Support for microformats, Webmention, and other IndieWeb building blocks is mandatory. Interoperability with the broader IndieWeb ecosystem takes precedence over proprietary solutions.

### III. Privacy by Design
User privacy MUST be the default, not an option. No telemetry, tracking, or analytics without explicit opt-in consent. All network communication must be transparent and auditable by the user.

### IV. Modularity and Composability
Features MUST be developed as independent, composable modules. Each module must have a clear, single responsibility and well-defined interfaces. Dependencies between modules should be minimal and explicit.

### V. Open Source Stewardship
Code MUST remain open, transparent, and forkable. Community contributions are welcomed and respected. Development happens in public with clear documentation of decisions and rationale.

## Technical Standards

### Development Workflow
- All code must pass linting and type checking before merge
- Test coverage for critical paths is mandatory
- Documentation updates accompany feature changes
- Semantic versioning for all releases

### Architecture Requirements
- Monorepo structure with clear package boundaries
- TypeScript for type safety across packages
- Progressive web app capabilities for web interfaces
- Native platform support through dedicated packages

## Community Guidelines

### Contributing Standards
- Welcome contributors of all backgrounds and skill levels
- Provide clear onboarding documentation
- Maintain respectful and inclusive communication
- Credit all contributors appropriately

### Decision Making
- Technical decisions documented in ADRs (Architecture Decision Records)
- Major changes discussed publicly before implementation
- Community feedback period for breaking changes
- Consensus-seeking with fallback to maintainer decision

## Governance

### Amendment Process
Constitutional amendments require:
1. Proposal with clear rationale and impact analysis
2. Community discussion period (minimum 7 days)
3. Documentation of concerns and resolutions
4. Version bump according to semantic versioning

### Compliance
- All pull requests must verify constitutional compliance
- Violations require explicit justification in complexity tracking
- Regular audits to ensure principles are actively maintained
- Use .specify/memory/constitution.md as source of truth

### Versioning Policy
- MAJOR: Removal or fundamental change to core principles
- MINOR: Addition of new principles or sections
- PATCH: Clarifications and non-semantic improvements

**Version**: 1.0.0 | **Ratified**: TODO(RATIFICATION_DATE): Requires confirmation of initial adoption date | **Last Amended**: 2025-09-27