# Tasks: Otso iOS App UI Prototype

**Input**: Design documents from `/specs/001-otso-based-on/`
**Prerequisites**: plan.md (required), research.md, data-model.md, contracts/

## Execution Flow (main)
```
1. Load plan.md from feature directory
   → If not found: ERROR "No implementation plan found"
   → Extract: tech stack, libraries, structure
2. Load optional design documents:
   → data-model.md: Extract entities → model tasks
   → contracts/: Each file → contract test task
   → research.md: Extract decisions → setup tasks
3. Generate tasks by category:
   → Setup: project init, dependencies, linting
   → Tests: contract tests, integration tests
   → Core: models, services, CLI commands
   → Integration: DB, middleware, logging
   → Polish: unit tests, performance, docs
4. Apply task rules:
   → Different files = mark [P] for parallel
   → Same file = sequential (no [P])
   → Tests before implementation (TDD)
5. Number tasks sequentially (T001, T002...)
6. Generate dependency graph
7. Create parallel execution examples
8. Validate task completeness:
   → All contracts have tests?
   → All entities have models?
   → All endpoints implemented?
9. Return: SUCCESS (tasks ready for execution)
```

## Format: `[ID] [P?] Description`
- **[P]**: Can run in parallel (different files, no dependencies)
- Include exact file paths in descriptions

## Path Conventions
- **iOS app**: `packages/otso-apple/Otso/Otso/`
- **Share extension**: `packages/otso-apple/OtsoShareExtension/`
- Paths shown below are relative to repository root

## Phase 3.1: Setup & Configuration
- [x] T001 Configure SwiftUI previews with mock data in packages/otso-apple/Otso/Otso/Preview Content/PreviewData.swift
- [ ] T002 [P] Add SF Symbols and color assets to packages/otso-apple/Otso/Otso/Resources/Assets.xcassets
- [x] T003 [P] Create app color scheme with semantic colors in packages/otso-apple/Otso/Otso/Extensions/Color+Theme.swift

## Phase 3.2: Core Navigation & Layout (UI Only)
- [x] T004 Update main ContentView with tab navigation in packages/otso-apple/Otso/Otso/ContentView.swift
- [x] T005 Enhance liquid glass tab bar with animations in packages/otso-apple/Otso/Otso/LiquidTabBar.swift
- [ ] T006 [P] Create custom navigation styles in packages/otso-apple/Otso/Otso/Styles/NavigationStyles.swift
- [ ] T007 [P] Add haptic feedback utilities in packages/otso-apple/Otso/Otso/Utilities/HapticFeedback.swift

## Phase 3.3: Welcome & Onboarding Views
- [x] T008 [P] Create welcome view with IndieAuth sign-in button in packages/otso-apple/Otso/Otso/Views/Onboarding/WelcomeView.swift
- [x] T009 [P] Design website URL input view in packages/otso-apple/Otso/Otso/Views/Onboarding/WebsiteInputView.swift
- [ ] T010 [P] Build authorization flow UI screens in packages/otso-apple/Otso/Otso/Views/Onboarding/AuthorizationView.swift

## Phase 3.4: Post Composer Interface
- [x] T011 Create main composer view with TextEditor in packages/otso-apple/Otso/Otso/Views/PostComposer/ComposerView.swift
- [x] T012 [P] Add character counter component in packages/otso-apple/Otso/Otso/Views/PostComposer/CharacterCounter.swift
- [x] T013 [P] Design post type selector (note/article/photo) in packages/otso-apple/Otso/Otso/Views/PostComposer/PostTypeSelector.swift
- [x] T014 [P] Create visibility picker (public/unlisted/private) in packages/otso-apple/Otso/Otso/Views/PostComposer/VisibilityPicker.swift
- [x] T015 Build media attachment grid view in packages/otso-apple/Otso/Otso/Views/PostComposer/MediaGridView.swift
- [ ] T016 [P] Design hashtag/mention highlighting in packages/otso-apple/Otso/Otso/Views/PostComposer/SyntaxHighlighter.swift
- [ ] T017 [P] Create toolbar with formatting options in packages/otso-apple/Otso/Otso/Views/PostComposer/ComposerToolbar.swift

## Phase 3.5: Drafts Management Views
- [ ] T018 Build drafts list view with search/filter in packages/otso-apple/Otso/Otso/Views/DraftsView/DraftsListView.swift
- [ ] T019 [P] Create draft row with preview and swipe actions in packages/otso-apple/Otso/Otso/Views/DraftsView/DraftRowView.swift
- [ ] T020 [P] Design empty state for no drafts in packages/otso-apple/Otso/Otso/Views/DraftsView/EmptyDraftsView.swift
- [ ] T021 [P] Add draft sorting/filtering controls in packages/otso-apple/Otso/Otso/Views/DraftsView/DraftsFilterBar.swift

## Phase 3.6: Posts Viewer Interface
- [ ] T022 Create posts timeline view in packages/otso-apple/Otso/Otso/Views/PostsViewer/PostsTimelineView.swift
- [ ] T023 [P] Design individual post card with media in packages/otso-apple/Otso/Otso/Views/PostsViewer/PostCardView.swift
- [ ] T024 [P] Build post detail view with metadata in packages/otso-apple/Otso/Otso/Views/PostsViewer/PostDetailView.swift
- [ ] T025 [P] Create post actions menu (edit/delete/share) in packages/otso-apple/Otso/Otso/Views/PostsViewer/PostActionsMenu.swift
- [ ] T026 [P] Add pull-to-refresh functionality in packages/otso-apple/Otso/Otso/Views/PostsViewer/RefreshableScrollView.swift

## Phase 3.7: Settings & Account Management
- [ ] T027 [P] Create main settings view in packages/otso-apple/Otso/Otso/Views/Settings/SettingsView.swift
- [ ] T028 [P] Design account list/switcher view in packages/otso-apple/Otso/Otso/Views/Settings/AccountsView.swift
- [ ] T029 [P] Build account detail/profile view in packages/otso-apple/Otso/Otso/Views/Settings/AccountDetailView.swift
- [ ] T030 [P] Create app preferences view in packages/otso-apple/Otso/Otso/Views/Settings/PreferencesView.swift

## Phase 3.8: Liquid Glass UI Components
- [ ] T031 [P] Create translucent material backgrounds in packages/otso-apple/Otso/Otso/Components/GlassBackground.swift
- [ ] T032 [P] Design animated blur effects in packages/otso-apple/Otso/Otso/Components/AnimatedBlur.swift
- [ ] T033 [P] Build liquid morphing animations in packages/otso-apple/Otso/Otso/Components/LiquidMorphView.swift
- [ ] T034 [P] Create glass-style buttons and controls in packages/otso-apple/Otso/Otso/Components/GlassButton.swift

## Phase 3.9: Loading & Feedback States
- [ ] T035 [P] Design loading indicators with liquid animation in packages/otso-apple/Otso/Otso/Components/LiquidLoader.swift
- [ ] T036 [P] Create success/error feedback views in packages/otso-apple/Otso/Otso/Components/FeedbackView.swift
- [ ] T037 [P] Build skeleton loading placeholders in packages/otso-apple/Otso/Otso/Components/SkeletonView.swift
- [ ] T038 [P] Add toast/banner notifications in packages/otso-apple/Otso/Otso/Components/ToastView.swift

## Phase 3.10: Share Extension UI
- [ ] T039 Create share extension view controller UI in packages/otso-apple/OtsoShareExtension/ShareViewController.swift
- [ ] T040 [P] Design quick compose interface for share sheet in packages/otso-apple/OtsoShareExtension/QuickComposeView.swift
- [ ] T041 [P] Build URL preview component in packages/otso-apple/OtsoShareExtension/URLPreviewView.swift

## Dependencies
- Setup (T001-T003) before all UI work
- Core navigation (T004-T007) before feature views
- Liquid glass components (T031-T034) can be parallel with feature views
- Share extension (T039-T041) independent of main app

## Parallel Example
```
# Launch UI component tasks together:
Task: "Create translucent material backgrounds in packages/otso-apple/Otso/Otso/Components/GlassBackground.swift"
Task: "Design animated blur effects in packages/otso-apple/Otso/Otso/Components/AnimatedBlur.swift"
Task: "Build liquid morphing animations in packages/otso-apple/Otso/Otso/Components/LiquidMorphView.swift"
Task: "Create glass-style buttons and controls in packages/otso-apple/Otso/Otso/Components/GlassButton.swift"
```

## Notes
- All tasks focus on UI/UX only - no data persistence or API calls
- Use mock data and @State for prototype interactions
- Prioritize visual polish and animations
- Follow iOS 17+ design guidelines
- Ensure all views work in both light/dark modes
- Support Dynamic Type for accessibility

## Task Generation Rules
*Applied during main() execution*

1. **UI Components Only**:
   - Pure SwiftUI views with @State for local state
   - Mock data for all content
   - No real networking or storage

2. **From Quickstart Flows**:
   - Each user flow → set of UI screens
   - Focus on visual transitions and feedback

3. **Liquid Glass Priority**:
   - Emphasize translucent materials
   - Smooth 60fps animations
   - Native iOS feel with custom flair

4. **Ordering**:
   - Setup → Navigation → Features → Polish
   - Independent components can be parallel [P]

## Validation Checklist
*GATE: Checked by main() before returning*

- [x] All core flows have UI screens
- [x] Liquid glass components defined
- [x] Navigation structure established
- [x] Share extension UI included
- [x] Each task specifies exact file path
- [x] No data/API implementation in tasks