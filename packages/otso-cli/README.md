# otso-cli

Connects your services to otso, keeps local copies of your data, and builds the search index.

```bash
pnpm otso sources        # from the repo root; or `bun bin/otso.ts …` in this folder
```

## How each source gets in

| Kind | Sources | What you do |
| --- | --- | --- |
| API | Are.na, Readwise, Pinboard, Last.fm, GitHub | `otso auth <source>` once (the token is verified, then saved to `~/.otso/config`), then `otso sync <source>` whenever you like |
| Export | Spotify, Claude, LinkedIn, Twitter/X, Google Takeout (plus Pinboard JSON and Last.fm CSV) | `otso ingest <source>` shows how to request the archive and opens the page; when it arrives, `otso ingest <source> ~/Downloads/<file>` |
| Local | Safari, Messages, Apple Notes, Apple Photos, Apple Podcasts, Things 3 | `otso sync <source>` reads a temporary copy of the app's database. Safari, Messages, Notes and Photos need Full Disk Access for your terminal |

`otso import` runs the same steps as a guided terminal UI.

Coming from chronicle-etl? `otso migrate chronicle` reads `~/.config/chronicle/etl` (secrets and job files), verifies each token with its service, and saves the working ones to `~/.otso/config`. It never prints values and doesn't change the chronicle files.

`otso adopt chronicle --archive <chronicle data folder>` copies an existing Chronicle archive into sources-dir, rewriting each row's id to the one otso's connector would produce (repeated rows collapse to one; sources without a connector are copied as they are). The archive is opened read-only. Afterwards, `otso index --fresh` rebuilds the index, and later syncs and imports add only what's new.

Every run is idempotent: rows are upserted on a stable id (Are.na block id, Readwise highlight id, Spotify timestamp + track, and so on), so syncing or re-importing the same archive twice changes nothing. API syncs are incremental. Readwise asks for highlights updated since the last sync, Last.fm for scrobbles after the newest stored one, Pinboard skips the download when `posts/update` is unchanged, and Are.na only re-reads channels whose `updated_at` moved. `--full` ignores those cursors.

## Where things go

```
~/.otso/config/                    tokens (<source>-credentials.json, 0600) and settings.json
data/config/sources.toml           indexer queries (tracked)
data/sources/<source>/chronicle/chronicle.db   what the CLI writes (gitignored)
data/sources/<source>/exports/     a copy of each archive you ingested (gitignored)
data/otso/                         events.db + search.db built by `otso index` (gitignored)
```

The data folder is the repo's `data/` when you run inside the repo. Override it with `OTSO_DATA_DIR` or `otso config set data-dir <path>`, the per-source folder with `OTSO_SOURCES_DIR` or `otso config set sources-dir <path>`, and the credentials folder with `OTSO_CONFIG_DIR`. `sources.toml` always comes from the checkout you are running (override with `OTSO_SOURCES_TOML`), so a branch can change queries without moving any data.

### Personal setup: archive on a share, code in any branch

Settings live in `~/.otso/config/settings.json`, outside every checkout, so set them once:

```bash
otso config set sources-dir /Volumes/<share>/otso/sources  # archives + chronicle.db per source, on the NAS
otso config set data-dir ~/.otso/data                     # events.db + search.db, on the local disk
```

Personal sources (one per Twitter account, for example) are added to `~/.otso/config/sources.local.toml`, never to the repo's `sources.toml`; `otso index` merges the two.

Then `main`, a feature branch, or a worktree all sync into the same archive and index it with their own `sources.toml`. To try a branch without touching your real index, point one shell at a throwaway data dir: `OTSO_DATA_DIR=/tmp/otso-try pnpm otso index`. To run otso-search against the same index, start it with `OTSO_DATA_DIR=~/.otso/data`.

Keep the index local. On SMB the indexer's parallel writes hit `database is locked` (tested); the per-source databases are fine there, and the CLI switches them from WAL to a rollback journal automatically on network shares (`OTSO_SQLITE_JOURNAL=wal|delete` overrides).

Each `chronicle.db` has the tables the `sources.toml` queries read, plus an `_otso_sync` table holding the sync cursor and the last run. Deleting a source's `chronicle.db` resets it.

## Indexing

`otso index` runs `packages/otso-indexer` with `--sources-dir data/sources`, so it reads the real data even though `sources.toml` defaults to `data/fixtures`. It appends new events to `data/otso/events.db` and adds only those to `search.db`, the index otso-search reads, so a routine run takes seconds. `otso index --fresh` starts both over (needed only after ids change, e.g. after `otso adopt`). `otso index --fixtures` indexes the mock data instead. Build the indexer once with `cargo build --release` in `packages/otso-indexer`; without that build it falls back to `cargo run`.

## Running on a schedule

`otso sync` with no arguments syncs every connected API source and every local source that has been synced before. To also index, add `--index`:

```bash
cd ~/GitHub/otso && pnpm otso sync --index
```

For non-interactive auth, set the credential fields as environment variables, for example `OTSO_ARENA_ACCESS_TOKEN`, `OTSO_LASTFM_USERNAME` and `OTSO_LASTFM_API_KEY`.

## Adding a source

Add a connector in `src/connectors/` (see `types.ts`), register it in `src/connectors/index.ts`, and make sure `sources.toml` has queries for its tables. Tests in `test/` run each connector's output through the real `sources.toml` queries:

```bash
bun test
```
