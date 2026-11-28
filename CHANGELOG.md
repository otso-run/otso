# Changelog

All notable changes to Otso are recorded here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `otso ingest google-takeout` reads much more of a Google Takeout: Google Chat messages, Google Voice texts, calls and voicemail transcripts, Maps starred places, reviews, saved lists and Timeline visits, Gemini prompts and replies, NotebookLM notebooks, Keep notes, Contacts, Blogger posts and comments, Google Groups messages, every other My Activity product, and Google Photos metadata (titles, descriptions, people, albums and places, never the photos themselves). Each gets its own search source. Unzip all the parts into one folder and pass the folder. [#42](https://github.com/otso-run/otso/pull/42)
- `otso ingest gmail` reads the Mail mbox from a Takeout as its own source. The mailbox is streamed, so a mailbox of tens of GB is fine; subjects, people, message text, attachment names and labels are searchable, spam is left out, and each result opens the message in Gmail. [#42](https://github.com/otso-run/otso/pull/42)
- Readwise Reader documents keep their full article text, and search finds words from the body, not just the title and summary. Results also show the author, site, published date, reading time, tags, notes, reading progress and when you saved and last opened each one. The first sync after upgrading fetches every Reader document once to fill this in. [#38](https://github.com/otso-run/otso/pull/38)
- A Coverage page in Otso Search (`/coverage`) lines up every source on one time axis, so you can see where each archive starts, where it has gaps and which sources have gone quiet. Choose the smallest gap worth flagging, drag to zoom, and open a source's longest gaps or jump to it in search. It works on phones too. [#41](https://github.com/otso-run/otso/pull/41)
- `otso sync apple-reminders` brings in Apple Reminders from every account, with notes, list, due date and flag. Like Things, each reminder shows up when it was made and again when it was completed, and reminders deleted in the app are removed. Needs Full Disk Access. [#49](https://github.com/otso-run/otso/pull/49)
- The Coverage page groups sources by the same categories as search, so all browsers or all music services share one lane that only shows a gap when none of them had anything. Select a group to see its sources, or turn grouping off with **by category**. [#43](https://github.com/otso-run/otso/pull/43)
- `otso log` shows recent sync and index runs, then the sources that are failing or slow, with how long each spent copying, reading and writing and any query slower than a second. Every `otso sync` and `otso index` now records a line in `~/.otso/logs/runs.jsonl` with each source's time, counts and errors, never the data itself. [#39](https://github.com/otso-run/otso/pull/39)

### Changed

- `otso index` picks up edited rows. When a source row changes, or a `sources.toml` query starts selecting more, its search entry is replaced on the next build, so `otso index --fresh` is no longer needed after changing a query. Queries can also return a `metadata` JSON column that shows in the result detail. [#38](https://github.com/otso-run/otso/pull/38)
- `otso index` is several times faster when source databases sit on a network share. A fresh build that took over ten minutes now takes about two, and a routine run with nothing new went from about 50 seconds to about 15. Each source database is copied to `~/.otso/cache/sources` once and reused until it changes, events are written in large batches by one writer at a time, and the search index reads only the events it doesn't have yet. [#39](https://github.com/otso-run/otso/pull/39)
- `otso index` prints a short summary (slowest sources, new search entries, slow queries and failures) instead of a warning for every slow database statement. [#39](https://github.com/otso-run/otso/pull/39)

### Fixed

- Events from an indexer run that was interrupted part way come back on the next `otso index`. Before, they were dropped from the event store for good. [#38](https://github.com/otso-run/otso/pull/38)
- Reader syncs wait out Readwise's rate limit instead of failing part way through a large pull. [#38](https://github.com/otso-run/otso/pull/38)
- A large source no longer fails a fresh `otso index` with "database is locked" when several sources write at once. [#39](https://github.com/otso-run/otso/pull/39)
- The two mock Twitter accounts used for demo data no longer show up in a real `otso index`; only `otso index --fixtures` builds them. [#39](https://github.com/otso-run/otso/pull/39)

## [0.2.0] - 2026-11-27

### Added

- `otso-cli`, a command line and terminal UI for getting personal data into Otso. The import flow walks through choosing sources, connecting accounts and running a first sync, with Are.na, Safari and Spotify as the first plugins. [#31](https://github.com/otso-run/otso/pull/31)
- `otso auth`, `otso sync`, `otso ingest`, `otso index`, `otso status` and `otso config`, covering 16 sources in three groups. API sources (Are.na, Readwise, Pinboard, Last.fm, GitHub) save a verified token and sync incrementally. Exports (Spotify, Claude, LinkedIn, Twitter/X, Google Takeout, Pinboard JSON, Last.fm CSV) open the export page, then process the zip or folder and keep a copy. Local macOS apps (Safari, Messages, Notes, Photos, Podcasts, Things) are read from a temporary copy of the app's database. Every write is an upsert on a stable id, so any run can be repeated. [#32](https://github.com/otso-run/otso/pull/32)
- Settings live in `~/.otso/config/settings.json` and apply to every checkout, and personal sources go in `~/.otso/config/sources.local.toml` instead of the repo. Source databases can sit on a network share; the search index should stay on a local disk. [#32](https://github.com/otso-run/otso/pull/32)
- `otso ingest claude` reads the whole claude.ai data export, in both the older single-zip shape and the newer split export. Projects, project knowledge files, memories, published artifacts and docs, design chats, reflections, routines and Claude Code threads each get their own table and search entries, and conversations link back to claude.ai. Login history, app state, file listings, run logs and raw tool transcripts are deliberately left out. [#34](https://github.com/otso-run/otso/pull/34)
- Several Macs can sync into one archive, with one of them doing the indexing. Browser history is stored per device, so search shows which Mac a visit came from. [#35](https://github.com/otso-run/otso/pull/35)
- Helium as a browser history source, through a generic Chromium `History` reader that other Chromium browsers can reuse. [#35](https://github.com/otso-run/otso/pull/35)
- `otso schedule install`, `uninstall` and `status`, which manage a launchd agent that syncs (and optionally indexes) on an interval and logs to `~/Library/Logs/otso/`. [#35](https://github.com/otso-run/otso/pull/35)
- A phone layout for `otso-search`, leaving desktop unchanged. The search field is sized for touch and doesn't trigger zoom on iOS. Category filters scroll as one row of chips, sources and result details open as bottom sheets, result rows take two lines, and the timeline is pinned to the bottom. [#37](https://github.com/otso-run/otso/pull/37)
- `otso-indexer --sources-dir`, so the CLI can point the indexer at a data folder outside the checkout. [#32](https://github.com/otso-run/otso/pull/32)

### Changed

- API tokens are stored in `~/.otso/config` with owner-only permissions, instead of a `data/config/` folder in the working directory. [#31](https://github.com/otso-run/otso/pull/31)
- Upgraded the workspace to pnpm 12.23.0. [#31](https://github.com/otso-run/otso/pull/31)
- Apple Notes and Photos are keyed on their iCloud ids instead of per-Mac ids, so the same note or photo synced from two Macs is stored once. The first sync on each Mac replaces the rows it stored under its old ids. [#35](https://github.com/otso-run/otso/pull/35)
- `otso sync` skips local sources whose app isn't installed and exits cleanly. With no arguments it syncs the local apps that are on this Mac and have been synced before. It stops when the sources folder is on a network share that isn't mounted, rather than creating a local folder in its place. Each source reports how many events are stored and when it was last synced. [#35](https://github.com/otso-run/otso/pull/35)
- Sources with a suffix, like per-device browser history, take their category and display name from the base source in both the indexer and the search UI. [#35](https://github.com/otso-run/otso/pull/35)

### Fixed

- Are.na sync picks up edited blocks, which the unchanged-channel skip used to miss because editing a block doesn't touch its channel. It also picks up your blocks that live in other people's channels. Each sync now reports blocks new and updated. [#33](https://github.com/otso-run/otso/pull/33)
- `otso status` no longer lists sources from `sources.local.toml` twice. [#35](https://github.com/otso-run/otso/pull/35)

### Removed

- Build output (`otso-indexer/target/`, `otso-search/.svelte-kit/`) is no longer tracked. Local data folders are ignored at any depth, so personal databases copied into a package are never committed. [#31](https://github.com/otso-run/otso/pull/31)

## [0.1.0] - 2026-01-10

### Added

- `otso-indexer`, a Rust indexer that extracts events from SQLite sources described in `sources.toml`. It processes sources in parallel, writes in batch transactions that roll back on failure, parses more than 15 timestamp formats, and builds an FTS5 search projection. Ships with 23 sources across 14 categories. [#30](https://github.com/otso-run/otso/pull/30)
- Aggregation for high-volume sources, so millions of records become a manageable set of summaries: `daily` and `hourly` group by time and key fields, and `session` groups events separated by less than a gap threshold (30 minutes by default). [#30](https://github.com/otso-run/otso/pull/30)
- `otso-search`, a SvelteKit search UI with full-text search across every indexed source, a timeline histogram, category, source and date filters, keyboard navigation, and virtual scrolling for long result lists. [#30](https://github.com/otso-run/otso/pull/30)
- Specs for the plugin system, event store, projections and indexer, plus 30 Rust tests and 22 Playwright tests. [#30](https://github.com/otso-run/otso/pull/30)
- Docs: a Run Local Search tutorial for setting up the indexer and search UI, and a `sources.toml` reference. [#30](https://github.com/otso-run/otso/pull/30)
- Docs: Chronicle in the ecosystem page, Omnivore in the inspirations list, and Apple Podcasts, email (IMAP/mbox), iMessage, Safari, shell history and Zulip in the sources table. [#26](https://github.com/otso-run/otso/pull/26) [#28](https://github.com/otso-run/otso/pull/28)
- Vercel Analytics on otso.run. [#25](https://github.com/otso-run/otso/pull/25)

### Changed

- The docs separate what's available now from what's on the roadmap, and the architecture diagrams show the components that actually run. [#30](https://github.com/otso-run/otso/pull/30)
- Homepage cards on otso.run no longer have link underlines, and show a visible focus outline instead. [#27](https://github.com/otso-run/otso/pull/27)

### Fixed

- A localhost URL in the tutorial that broke the Vercel build. [#30](https://github.com/otso-run/otso/pull/30)

[Unreleased]: https://github.com/otso-run/otso/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/otso-run/otso/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/otso-run/otso/releases/tag/v0.1.0
