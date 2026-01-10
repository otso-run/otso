# Repository Guidelines

## Project Structure & Module Organization
- `packages/otso.run`: Astro/Starlight docs site. Author guides in `src/content/docs`, reusable layouts in `src/pages`, shared styles in `src/styles`, and static assets in `public`.
- `packages/otso-apple/Otso`: SwiftUI app with `Otso.xcodeproj`, plus test bundles `OtsoTests` and `OtsoUITests`.
- `ai/` captures agent playbooks; `specs/` holds product briefs and research. Workspace-wide settings live at the root (`pnpm-workspace.yaml`, `vercel.json`, `commitlint.config.cjs`).

## Build, Test, and Development Commands
- `pnpm install`: sync workspace dependencies after cloning or pulling.
- `pnpm dev`, `pnpm build`, `pnpm preview`: run, build, and serve the docs via `pnpm --filter otso.run ...`.
- `pnpm --filter otso.run astro check`: quick content lint to catch broken imports and metadata.
- `xcodebuild -project packages/otso-apple/Otso/Otso.xcodeproj -scheme Otso build`: command-line build for the iOS app; open the same project in Xcode for UI work.

## Coding Style & Naming Conventions
- Follow Prettier defaults: two-space indentation, kebab-case route folders, PascalCase component exports, and lowercase frontmatter keys.
- Prefer `.mdx` when embedding interactive components; reserve `.astro` for layouts or wrappers.
- Swift code should mirror Apple guidelines—camelCase members, UpperCamelCase types, and focused SwiftUI views grouped by feature inside the matching module.
- Name assets descriptively (`otso-*.png`) and add short comments only when behavior diverges from a standard pattern.

## Testing Guidelines
- Docs: `pnpm --filter otso.run astro check` before committing, then `pnpm --filter otso.run build` prior to pushing to ensure the static build passes.
- iOS: `xcodebuild test -project packages/otso-apple/Otso/Otso.xcodeproj -scheme Otso -destination 'platform=iOS Simulator,name=iPhone 15'` exercises both unit and UI suites. New files should end with `Tests.swift` and keep fixtures in their target folders.

## Commit & Pull Request Guidelines
- Stick to Conventional Commits (`feat: ...`, `refactor: ...`, `feat(apple): ...`) as seen in the git log; write subjects in the imperative tense.
- PRs should outline the change, reference specs or issues, and list manual verification. Include screenshots or clips for UI differences and mention any new commands or environment variables.

## Configuration & Deployment Notes
- Vercel reads `vercel.json`; run `pnpm build` locally before requesting a deploy. Keep secrets out of the repo (local `.env`, Xcode build settings) and update `ai/` prompts whenever workflows change so other agents can reproduce them.
