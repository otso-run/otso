# Research: Otso iOS App

**Date**: 2025-09-27
**Feature**: iOS native app with liquid glass interface

## iOS Development Best Practices Research

### Decision: SwiftUI with UIKit Interop
**Rationale**: SwiftUI provides the modern declarative UI framework needed for liquid glass effects while UIKit interop enables share extension functionality.
**Alternatives considered**:
- Pure UIKit: More control but verbose, lacks modern animation capabilities
- React Native: Cross-platform but cannot achieve native liquid glass performance
- Flutter: Good performance but doesn't match iOS system defaults closely

### Decision: SwiftData for Local Storage
**Rationale**: Already implemented in the project. Modern Swift-native persistence framework with automatic iCloud sync capability, offline-first by design, seamless SwiftUI integration with @Query and @Model.
**Alternatives considered**:
- Core Data: Older, more verbose API, requires more boilerplate
- SQLite directly: More control but requires manual sync implementation
- Realm: Good alternative but adds third-party dependency

### Decision: IndieAuth via ASWebAuthenticationSession
**Rationale**: Apple's recommended OAuth flow implementation, handles app switching gracefully, secure by default.
**Alternatives considered**:
- WKWebView: Deprecated for OAuth flows
- SFSafariViewController: Less integrated experience
- Custom implementation: Security risks

## Liquid Glass Interface Research

### Decision: Materials + Blur Effects
**Rationale**: Use iOS native materials (ultraThinMaterial, thinMaterial) combined with custom blur shaders for liquid glass effect.
**Implementation approach**:
- SwiftUI Materials for base translucency
- Metal shaders for liquid animations
- CAEmitterLayer for particle effects
- 60fps target with ProMotion support

### Decision: System-Aligned Design
**Rationale**: Follow Human Interface Guidelines strictly for familiarity and accessibility.
**Key principles**:
- SF Symbols for all icons
- Dynamic Type support
- System colors and semantic colors
- Standard navigation patterns
- Native haptic feedback

## Share Extension Research

### Decision: Action Extension Type
**Rationale**: Action extensions can modify content before sharing, perfect for Raindrop-like functionality.
**Implementation details**:
- NSExtensionActivationRule for URL/text/image support
- Shared container with main app via App Groups
- Background upload capability
- Quick tagging interface

## Post Composition Research

### Decision: TextEditor with Markdown Support
**Rationale**: Native TextEditor with custom markdown rendering provides Ivory/Bluesky-like experience.
**Features planned**:
- @mention autocomplete
- #hashtag highlighting
- Media attachment grid
- Character counter
- Draft autosave every keystroke
- Post visibility selector

## Micropub Integration Research

### Decision: URLSession with Background Tasks
**Rationale**: Native networking with background upload support for reliability.
**Implementation approach**:
- Codable models for Micropub JSON
- Background URL session configuration
- Retry logic with exponential backoff
- Queue for offline posts

## Performance Targets Research

### Decision: Aggressive Performance Goals
**Cold start**: <300ms (measured from tap to interactive)
**Scrolling**: Consistent 120fps on ProMotion displays
**Draft save**: <16ms (within single frame)
**Memory**: <50MB baseline, <150MB with media
**Battery**: <5% drain per hour active use

## Accessibility Research

### Decision: Full VoiceOver Support
**Rationale**: IndieWeb community values inclusion, iOS users expect accessibility.
**Requirements**:
- All custom controls fully labeled
- Rotor actions for post actions
- Reduced motion alternatives
- High contrast mode support
- Text size up to AX5

## Security & Privacy Research

### Decision: Keychain + Biometric Auth
**Rationale**: iOS standard for credential storage with Face ID/Touch ID protection.
**Implementation**:
- Keychain Services for tokens
- Local Authentication framework
- Certificate pinning for known endpoints
- No analytics or crash reporting by default

## Testing Strategy Research

### Decision: XCTest + UI Testing
**Rationale**: Apple's native testing framework with Xcode integration.
**Test coverage goals**:
- Unit tests: Models, services, utilities (80% coverage)
- Integration tests: API communication, Core Data operations
- UI tests: Critical user flows (login, post, draft)
- Performance tests: Scrolling, memory, launch time

## Resolved Clarifications

1. **Performance targets**: 60fps minimum, 120fps on ProMotion, <300ms cold start
2. **Data retention**: Indefinite local storage with manual cleanup options
3. **Multi-user**: Single active account with fast account switching

## Technologies Confirmed

- **Language**: Swift 5.9+
- **UI Framework**: SwiftUI with UIKit bridges
- **Storage**: SwiftData (already implemented)
- **Networking**: URLSession
- **Auth**: ASWebAuthenticationSession
- **Testing**: XCTest, XCUITest
- **Minimum iOS**: 17.0 (required for SwiftData)
- **Package Manager**: Swift Package Manager