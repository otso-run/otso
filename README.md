# otso

Local-first toolkit for archiving, searching, and owning your digital trails.

## What Works Now

Otso currently provides:

- **Data Extraction** — Index events from 23+ data sources (Twitter archives, Pinboard, Spotify, GitHub, Apple Notes, and more) via a Rust-based indexer
- **Unified Search** — SvelteKit web UI with full-text search, timeline histogram, and category filters
- **Local Storage** — SQLite event store with FTS5 projections, all on your machine

```
┌─────────────────────────────────────────────────┐
│  SOURCE DATA (SQLite databases)                 │
│  Twitter, Pinboard, Spotify, GitHub, etc.       │
└───────────────────────┬─────────────────────────┘
                        ▼
┌─────────────────────────────────────────────────┐
│  otso-indexer (Rust)                            │
│  Configurable via sources.toml                  │
└───────────────────────┬─────────────────────────┘
                        ▼
┌─────────────────────────────────────────────────┐
│  Event Store + FTS5 Search Index (SQLite)       │
└───────────────────────┬─────────────────────────┘
                        ▼
┌─────────────────────────────────────────────────┐
│  otso-search (SvelteKit)                        │
│  Timeline · Filters · Full-text search          │
└─────────────────────────────────────────────────┘
```

## Quick Start

### Prerequisites

- Rust 1.70+
- Node.js 18+ and pnpm
- Your data in SQLite format (see [sources.toml](data/config/sources.toml) for schema)

### Run the Search UI

```bash
# Clone and install
git clone https://github.com/yourusername/otso.git
cd otso
pnpm install

# Build the indexer
cd packages/otso-indexer
cargo build --release

# Index your data (uses fixtures for demo)
cargo run --release -- -c ../../data/config/sources.toml build

# Start the search UI
cd ../otso-search
pnpm dev
# Open http://localhost:5173
```

### Add Your Own Data

1. Place your SQLite database in `data/sources/your-source/chronicle/chronicle.db`
2. Add a source configuration to `data/config/sources.toml`:

```toml
[[sources]]
name = "your-source"
enabled = true
db_path = "your-source/chronicle/chronicle.db"
category = "notes"  # reading, music, social, etc.

[[sources.queries]]
table = "events"
entry_type = "note"
sql = """
SELECT
    id as external_id,
    title,
    content,
    created_at as occurred_at,
    url
FROM your_table
"""
```

3. Rebuild the index: `cargo run --release -- build`

## Configured Sources

| Category | Sources |
|----------|---------|
| Reading | pinboard, readwise |
| Music | spotify, lastfm, apple-podcasts |
| Social | twitter archives, linkedin |
| Productivity | things, timing |
| Browse | safari, chrome, google-search |
| Notes | apple-notes, notion |
| Photos | apple-photos |
| Location | foursquare |
| Code | github |
| AI | claude conversations |
| Curation | are.na |
| Video | youtube |
| Calendar | google calendar |

## Roadmap

These features are planned but not yet implemented:

- [ ] CLI for publishing (`otso publish`)
- [ ] POSSE syndication to Mastodon/Bluesky
- [ ] PESOS import from live APIs
- [ ] iOS app for composing notes
- [ ] Micropub/Webmention support

## Documentation

Full documentation at [otso.run](https://otso.run).

## Contributing

We welcome contributions of all kinds. Read our [Contributing guide](https://otso.run/overview/contributing/) to get started.

## Open Source Philosophy

Otso is built in the open to empower individuals and communities. We believe software should be transparent, forkable, and shaped by those who use it.

