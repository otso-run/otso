
# Implementation Plan: Otso iOS App

**Branch**: `001-otso-based-on` | **Date**: 2025-09-27 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/001-otso-based-on/spec.md`

## Execution Flow (/plan command scope)
```
1. Load feature spec from Input path
   → If not found: ERROR "No feature spec at {path}"
2. Fill Technical Context (scan for NEEDS CLARIFICATION)
   → Detect Project Type from file system structure or context (web=frontend+backend, mobile=app+api)
   → Set Structure Decision based on project type
3. Fill the Constitution Check section based on the content of the constitution document.
4. Evaluate Constitution Check section below
   → If violations exist: Document in Complexity Tracking
   → If no justification possible: ERROR "Simplify approach first"
   → Update Progress Tracking: Initial Constitution Check
5. Execute Phase 0 → research.md
   → If NEEDS CLARIFICATION remain: ERROR "Resolve unknowns"
6. Execute Phase 1 → contracts, data-model.md, quickstart.md, agent-specific template file (e.g., `CLAUDE.md` for Claude Code, `.github/copilot-instructions.md` for GitHub Copilot, `GEMINI.md` for Gemini CLI, `QWEN.md` for Qwen Code or `AGENTS.md` for opencode).
7. Re-evaluate Constitution Check section
   → If new violations: Refactor design, return to Phase 1
   → Update Progress Tracking: Post-Design Constitution Check
8. Plan Phase 2 → Describe task generation approach (DO NOT create tasks.md)
9. STOP - Ready for /tasks command
```

**IMPORTANT**: The /plan command STOPS at step 7. Phases 2-4 are executed by other commands:
- Phase 2: /tasks command creates tasks.md
- Phase 3-4: Implementation execution (manual or via tools)

## Summary
Developing a native iOS app for Otso with a liquid glass interface that provides IndieAuth login, post composition similar to Ivory/Bluesky, draft management, posts viewer/editor from IndieAuth sites, and share sheet functionality similar to Raindrop. The app will follow iOS best practices, stick closely to system defaults, and prioritize local-first functionality with offline capabilities.

## Technical Context
**Language/Version**: Swift 5.9+ / SwiftUI
**Primary Dependencies**: SwiftUI, SwiftData, UIKit (for share extension), AuthenticationServices (IndieAuth)
**Storage**: SwiftData for local storage (already implemented), Keychain for credentials
**Testing**: XCTest, XCUITest for UI testing
**Target Platform**: iOS 17+, iPadOS 17+
**Project Type**: mobile - iOS native app
**Performance Goals**: 60fps UI animations, <300ms cold start, instant draft saving
**Constraints**: <100MB app size, offline-capable, background sync support
**Scale/Scope**: Single-user app, ~15-20 screens, support for unlimited drafts and accounts

## Constitution Check
*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

**Core Principles Compliance**:
- [x] Local-First: Offline functionality prioritized, sync is optional
- [x] IndieWeb Standards: Using microformats, Webmention where applicable
- [x] Privacy by Design: No tracking/telemetry without explicit opt-in
- [x] Modularity: Feature developed as independent, composable module
- [x] Open Source: Development in public with clear documentation

**Technical Standards**:
- [x] Linting and type checking configured (SwiftLint)
- [x] Test coverage for critical paths planned
- [x] Documentation updates included
- [x] Monorepo structure maintained (packages/otso-apple/)

## Project Structure

### Documentation (this feature)
```
specs/[###-feature]/
├── plan.md              # This file (/plan command output)
├── research.md          # Phase 0 output (/plan command)
├── data-model.md        # Phase 1 output (/plan command)
├── quickstart.md        # Phase 1 output (/plan command)
├── contracts/           # Phase 1 output (/plan command)
└── tasks.md             # Phase 2 output (/tasks command - NOT created by /plan)
```

### Source Code (repository root)
```
packages/otso-apple/
├── Otso/
│   ├── Otso/
│   │   ├── Models/
│   │   │   ├── Account.swift
│   │   │   ├── Post.swift
│   │   │   ├── Draft.swift
│   │   │   └── MediaAsset.swift
│   │   ├── Views/
│   │   │   ├── ContentView.swift
│   │   │   ├── LiquidTabBar.swift
│   │   │   ├── PostComposer/
│   │   │   ├── DraftsView/
│   │   │   ├── PostsViewer/
│   │   │   └── Settings/
│   │   ├── Services/
│   │   │   ├── IndieAuthService.swift
│   │   │   ├── MicropubService.swift
│   │   │   ├── StorageService.swift
│   │   │   └── SyncService.swift
│   │   ├── Extensions/
│   │   │   └── ShareExtension/
│   │   └── Resources/
│   │       ├── Assets.xcassets
│   │       └── Info.plist
│   └── OtsoTests/
│       ├── ModelTests/
│       ├── ServiceTests/
│       └── UITests/
└── OtsoShareExtension/
    ├── ShareViewController.swift
    └── Info.plist
```

**Structure Decision**: iOS native app structure within the monorepo at packages/otso-apple/. Using standard Xcode project organization with SwiftUI views, Core Data models, and services for IndieAuth/Micropub integration. Share extension implemented as a separate target for system-wide sharing capability.

## Phase 0: Outline & Research
1. **Extract unknowns from Technical Context** above:
   - For each NEEDS CLARIFICATION → research task
   - For each dependency → best practices task
   - For each integration → patterns task

2. **Generate and dispatch research agents**:
   ```
   For each unknown in Technical Context:
     Task: "Research {unknown} for {feature context}"
   For each technology choice:
     Task: "Find best practices for {tech} in {domain}"
   ```

3. **Consolidate findings** in `research.md` using format:
   - Decision: [what was chosen]
   - Rationale: [why chosen]
   - Alternatives considered: [what else evaluated]

**Output**: research.md with all NEEDS CLARIFICATION resolved

## Phase 1: Design & Contracts
*Prerequisites: research.md complete*

1. **Extract entities from feature spec** → `data-model.md`:
   - Entity name, fields, relationships
   - Validation rules from requirements
   - State transitions if applicable

2. **Generate API contracts** from functional requirements:
   - For each user action → endpoint
   - Use standard REST/GraphQL patterns
   - Output OpenAPI/GraphQL schema to `/contracts/`

3. **Generate contract tests** from contracts:
   - One test file per endpoint
   - Assert request/response schemas
   - Tests must fail (no implementation yet)

4. **Extract test scenarios** from user stories:
   - Each story → integration test scenario
   - Quickstart test = story validation steps

5. **Update agent file incrementally** (O(1) operation):
   - Run `.specify/scripts/bash/update-agent-context.sh claude`
     **IMPORTANT**: Execute it exactly as specified above. Do not add or remove any arguments.
   - If exists: Add only NEW tech from current plan
   - Preserve manual additions between markers
   - Update recent changes (keep last 3)
   - Keep under 150 lines for token efficiency
   - Output to repository root

**Output**: data-model.md, /contracts/*, failing tests, quickstart.md, agent-specific file

## Phase 2: Task Planning Approach
*This section describes what the /tasks command will do - DO NOT execute during /plan*

**Task Generation Strategy**:
- Load `.specify/templates/tasks-template.md` as base
- Generate tasks from Phase 1 design docs (contracts, data model, quickstart)
- Each SwiftData model → model implementation task [P]
- Each IndieAuth/Micropub contract → service implementation task
- Each UI flow from quickstart → view implementation task
- Share extension → separate target task
- Each core flow → XCUITest task

**Ordering Strategy**:
- Foundation first: Models, then services, then views
- TDD where applicable: Test contracts before implementation
- Dependency order: Auth before posting, models before views
- Mark [P] for parallel execution (independent Swift files)

**Estimated Output**: 30-35 numbered, ordered tasks in tasks.md

**Key Task Categories**:
1. **SwiftData Models** (7 models from data-model.md)
2. **Services** (IndieAuth, Micropub, Storage, Sync)
3. **Views** (Composer, Drafts, Posts Viewer, Settings, LiquidTabBar)
4. **Share Extension** (ShareViewController, App Groups)
5. **Testing** (XCTest for models/services, XCUITest for flows)

**IMPORTANT**: This phase is executed by the /tasks command, NOT by /plan

## Phase 3+: Future Implementation
*These phases are beyond the scope of the /plan command*

**Phase 3**: Task execution (/tasks command creates tasks.md)  
**Phase 4**: Implementation (execute tasks.md following constitutional principles)  
**Phase 5**: Validation (run tests, execute quickstart.md, performance validation)

## Complexity Tracking
*Fill ONLY if Constitution Check has violations that must be justified*

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| [e.g., 4th project] | [current need] | [why 3 projects insufficient] |
| [e.g., Repository pattern] | [specific problem] | [why direct DB access insufficient] |


## Progress Tracking
*This checklist is updated during execution flow*

**Phase Status**:
- [x] Phase 0: Research complete (/plan command)
- [x] Phase 1: Design complete (/plan command)
- [x] Phase 2: Task planning complete (/plan command - describe approach only)
- [ ] Phase 3: Tasks generated (/tasks command)
- [ ] Phase 4: Implementation complete
- [ ] Phase 5: Validation passed

**Gate Status**:
- [x] Initial Constitution Check: PASS
- [x] Post-Design Constitution Check: PASS
- [x] All NEEDS CLARIFICATION resolved (performance, retention, multi-user)
- [x] Complexity deviations documented (none - follows constitution)

---
*Based on Constitution v1.0.0 - See `.specify/memory/constitution.md`*
