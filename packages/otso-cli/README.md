# otso-cli

Connects your services to otso, keeps local copies of your data, and builds the search index.

```bash
pnpm otso sources        # from the repo root; or `bun bin/otso.ts …` in this folder
```

## How each source gets in

| Kind | Sources | What you do |
| --- | --- | --- |
| API | Are.na, Readwise, Pinboard, Last.fm, GitHub | `otso auth <source>` once (the token is verified, then saved to `~/.otso/config`), then `otso sync <source>` whenever you like |
| Export | Spotify, Claude, LinkedIn, Twitter/X, Google Takeout, Gmail (plus Pinboard JSON and Last.fm CSV) | `otso ingest <source>` shows how to request the archive and opens the page; when it arrives, `otso ingest <source> ~/Downloads/<file>` |
| Local | Safari, Helium, Messages, Apple Notes, Apple Photos, Apple Podcasts, Things 3, Timing | `otso sync <source>` reads a temporary copy of the app's database. Safari, Messages, Notes and Photos need Full Disk Access for your terminal |

`otso import` runs the same steps as a guided terminal UI.

Coming from chronicle-etl? `otso migrate chronicle` reads `~/.config/chronicle/etl` (secrets and job files), verifies each token with its service, and saves the working ones to `~/.otso/config`. It never prints values and doesn't change the chronicle files.

`otso adopt chronicle --archive <chronicle data folder>` copies an existing Chronicle archive into sources-dir, rewriting each row's id to the one otso's connector would produce (repeated rows collapse to one; sources without a connector are copied as they are). The archive is opened read-only. Afterwards, `otso index --fresh` rebuilds the index, and later syncs and imports add only what's new.

Every run is idempotent: rows are upserted on a stable id (Are.na block id, Readwise highlight id, Spotify timestamp + track, and so on), so syncing or re-importing the same archive twice changes nothing. API syncs are incremental. Readwise asks for highlights updated since the last sync, Last.fm for scrobbles after the newest stored one, Pinboard skips the download when `posts/update` is unchanged, and Are.na only re-reads channels whose `updated_at` moved. `--full` ignores those cursors.

### Google Takeout

A Takeout arrives as many zips. Unzip them all into one folder (the parts merge into a single `Takeout/` tree) and give otso the folder, which also skips keeping a copy of a many-GB archive:

```bash
otso ingest google-takeout ~/takeout-extracted   # everything below except Mail
otso ingest gmail ~/takeout-extracted            # Takeout/Mail/*.mbox, streamed
```

| Takeout product | otso source | What's indexed |
| --- | --- | --- |
| My Activity → Search | `google-search` | searches |
| Chrome | `chrome` | browser history |
| YouTube and YouTube Music | `youtube` | watch history |
| Calendar | `gcal` | events from every `.ics` |
| Mail | `gmail` (own db) | subject, people, text (32 KB cap), attachment names, labels; spam is left out of search |
| Google Chat | `google-chat` | one entry per message, titled with sender and space or DM |
| Voice | `google-voice` | texts, calls and voicemail transcripts |
| Maps (your places), Maps, Saved, Timeline | `google-maps` | starred places, reviews, labeled places, saved lists, Timeline visits |
| My Activity → Gemini Apps | `gemini` | prompts and replies |
| NotebookLM, Gemini | `notebooklm` | notes, chats and text sources per notebook; Gems |
| My Activity, other products | `google-activity` | Maps, Discover, Image Search, Play, News and so on (Search, Chrome, YouTube and Ads are covered elsewhere or skipped) |
| Keep | `google-keep` | notes and checklists, not trashed ones |
| Contacts | `google-contacts` | one entry per person, with their groups |
| Blogger | `blogger` | posts, pages and comments, drafts included |
| Groups | `google-groups` | messages from any `.mbox` under `Groups/` |
| Google Photos | `googlephotos` | the JSON sidecars only: title, description, people, albums, place. Photos and videos are never read, so the media can be left out when unzipping |

Choose JSON for My Activity under "Multiple formats"; the HTML version can't be read. Drive file contents aren't imported. Things without a date of their own (saved lists, labeled places, NotebookLM files, most contacts) are dated by their file time in the export.

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

### Several Macs, one archive

Point every Mac's `sources-dir` at the same share; index on one of them.

- **Browser history** (Safari, Helium) doesn't sync between Macs, so each Mac writes its own source: `safari-<device>/`, `helium-<device>/`. The device name comes from the Mac's hostname the first time and is saved as `device` in `~/.otso/config/settings.json` (`otso config set device <name>` to change it). `otso index` finds every `<source>-<device>/` folder in sources-dir and indexes it under that name, so search shows which Mac each visit came from. The first per-device sync also moves that Mac's rows out of the old shared `safari/` source.
- **iCloud data** (Messages, Notes, Photos) is the same on every Mac, so it stays one source each, keyed on the iCloud id (message guid, note `ZIDENTIFIER`, photo `ZCLOUDASSETGUID`). Whichever Mac syncs, an item is stored once. Rows an older otso stored under a Mac's local ids are replaced the next time that Mac syncs; run `otso index --fresh` afterwards so search drops the old copies.
- A local source whose app isn't on this Mac (Things on a Mac without it) is skipped by `otso sync`, not an error.
- If sources-dir is on a share that isn't mounted, sync stops instead of writing to an empty `/Volumes/<share>` folder.

Each `chronicle.db` has the tables the `sources.toml` queries read, plus an `_otso_sync` table holding the sync cursor and the last run. Deleting a source's `chronicle.db` resets it.

## Indexing

`otso index` runs `packages/otso-indexer` with `--sources-dir data/sources`, so it reads the real data even though `sources.toml` defaults to `data/fixtures`. It appends new events to `data/otso/events.db` and adds only those to `search.db`, the index otso-search reads, so a routine run takes seconds. `otso index --fresh` starts both over (needed only after ids change, e.g. after `otso adopt`). `otso index --fixtures` indexes the mock data instead. Build the indexer once with `cargo build --release` in `packages/otso-indexer`; without that build it falls back to `cargo run`.

When `sources-dir` is on a network share, the indexer copies each source database to `~/.otso/cache/sources` and reads the copy, which is much faster than querying SQLite over SMB. A copy is reused until its source changes, so a routine run only copies the sources that synced since. Sources marked `fixture = true` in `sources.toml` (the mock Twitter accounts) are built only by `otso index --fixtures`.

## Run log

Every `otso sync` and `otso index` adds a line to `~/.otso/logs/runs.jsonl` with each source's time, row counts and errors, and for index runs the time spent copying, reading and writing each source and any query slower than a second. The log holds names, counts, timings and error messages, never the data itself. `otso index` prints a short summary instead of every slow statement, and `otso log` shows recent runs and the sources that are slow or failing:

```bash
pnpm otso log                   # last 10 runs, then slow or failing sources
pnpm otso log --source lastfm   # one source over time
pnpm otso log --kind sync -n 30 --json
```

## Running on a schedule

`otso sync` with no arguments syncs every connected API source and every local source that's on this Mac and has been synced before (by any Mac). Each source reports what's new and what's already stored, and when and from which Mac it was last synced. To also index, add `--index`:

```bash
cd ~/GitHub/otso && pnpm otso sync --index
```

To sync on a timer, install a launchd agent from a checkout outside `~/Documents` (launchd agents can't read it):

```bash
pnpm otso schedule install --every 60            # all sources, hourly
pnpm otso schedule install safari helium --every 30
pnpm otso schedule status
pnpm otso schedule uninstall
```

Runs are logged to `~/Library/Logs/otso/sync.log`. Add `--index` only on the Mac that holds the index. Safari, Messages, Notes and Photos need Full Disk Access for the `bun` binary the agent runs (install prints its path).

For non-interactive auth, set the credential fields as environment variables, for example `OTSO_ARENA_ACCESS_TOKEN`, `OTSO_LASTFM_USERNAME` and `OTSO_LASTFM_API_KEY`.

## Adding a source

Add a connector in `src/connectors/` (see `types.ts`), register it in `src/connectors/index.ts`, and make sure `sources.toml` has queries for its tables. Tests in `test/` run each connector's output through the real `sources.toml` queries:

```bash
bun test
```
