# Otso Search

Otso Search is the local SvelteKit archive browser. For a Chronicle archive, refresh the sources you care about, build a Chronicle search index, then prepare an Otso-compatible snapshot. The timeline shows the dates of indexed records. A new export or a newer database file can still contain only older records.

## 1. Collect and normalize source data

From the Otso repository root, run the interactive importer with Bun and the workspace dependencies installed.

```sh
bun packages/otso-cli/bin/otso.ts import
```

Choose a source in the menu. The importer can collect files and credentials. The current checkout leaves the summary screen's indexer action unwired and has no SMB destination option.

| Source | Collection | Before indexing |
| --- | --- | --- |
| Safari | Use the CLI's local database flow on the Mac with the history. macOS may require Full Disk Access for the terminal. | Normalize the copied history database to the Chronicle schema expected by the Safari indexer query. |
| Spotify | Use the CLI's account-export flow and download the requested archive. | Unpack the export, then use Chronicle's `scripts/convert-spotify-to-chronicle.py` for supported listening-history files. |
| Google Takeout | Download a fresh JSON export for the Google products you want to refresh. | Use Chronicle's `scripts/parse-google-takeout-comprehensive.py` and `scripts/convert-google-takeout-to-chronicle.py`. Preserve the per-product SQLite tables queried by the indexer. |
| Apple Notes | Export on the Mac with `apple-notes-to-sqlite` and extract with the Chronicle Apple Notes plugin. | Follow the Dogsheep workflow in the Chronicle checkout and run `scripts/transform-apple-notes.rb`. |
| Are.na | Use the CLI plugin to save the API credential. | Run the Chronicle source extractor separately and normalize its output. |

The CLI stages files under `data/sources/` and credentials under `data/config/` relative to the working directory. In the separate Chronicle checkout, see `README.md` for plugin and conversion instructions and `tools/search-indexer/src/main.rs` for the configured database paths, tables, and columns. Typical input is `data/<source>/chronicle/chronicle.db`, though some account exports use a nested path. For full exports, build a fresh source database and verify its record count and latest event before replacing an older copy. A source needs a matching indexer configuration to appear in search.

## 2. Reindex on a local disk

On macOS, mount the SMB share in Finder with **Go → Connect to Server** and use its mounted path in Terminal. Set these paths from the Otso repository root. Keep the same shell open for the remaining steps.

```sh
otso_root="$PWD"
chronicle_checkout="$HOME/GitHub/chronicle"
share_data="/Volumes/Files/GitHub/chronicle/data"
run_dir="$(mktemp -d /tmp/otso-chronicle.XXXXXX)"
mkdir -p "$run_dir/chronicle" "$run_dir/data/otso" "$run_dir/data/search"
printf 'Snapshot directory: %s\n' "$run_dir"
```

To build from refreshed source databases on the share, make sure the source imports have finished, then stage their SQLite files locally. To use a freshly normalized database that is still on your Mac, place it at the matching source path under `"$run_dir/chronicle"` after staging and before building. Replace the staged database and its SQLite sidecar files together so the new database cannot pick up an older WAL.

```sh
rsync -a --include='*/' --include='chronicle.db' --include='chronicle.db-wal' \
  --exclude='*' --prune-empty-dirs "$share_data/" "$run_dir/chronicle/"
"$chronicle_checkout/bin/chronicle-search-indexer" \
  --data-dir "$run_dir/chronicle" build --fts-only
chronicle_index="$run_dir/chronicle/search/chronicle-search.db"
```

Review the indexer's output for skipped sources or failed queries. The indexer replaces its previous output in the chosen data directory. If you already have an up-to-date index on the share, you can instead set `chronicle_index="$share_data/search/chronicle-search.db"` and continue.

## 3. Prepare the Otso snapshot

The two apps use different SQLite schemas. The commands below use the existing Otso index only as a schema template. If `data/otso/search.db` is missing in your Otso checkout, follow **Run the Search UI** in the repository root README to create it first. Run this block in a fresh `run_dir` for each snapshot.

```sh
(
  set -e
  test -s "$chronicle_index"
  test -s "$otso_root/data/otso/search.db"
  cd "$run_dir"
  sqlite3 -bail -readonly "$chronicle_index" '.backup chronicle.db'
  sqlite3 -bail -readonly "$otso_root/data/otso/search.db" \
    '.schema search_entries' '.schema search_entry_map' > schema.sql
  sqlite3 -bail data/otso/search.db <<'SQL'
.read schema.sql
ATTACH 'chronicle.db' AS chronicle;
BEGIN;
INSERT INTO search_entries
  (rowid, title, content, source, entry_type, content_rowid, event_id, external_id, ts, year, month)
SELECT e.id, e.title, e.content, s.name, e.entry_type, e.id, 'chronicle:' || e.id,
       e.external_id, e.ts, CAST(strftime('%Y', e.ts, 'unixepoch') AS INTEGER),
       strftime('%Y-%m', e.ts, 'unixepoch')
FROM chronicle.entries e JOIN chronicle.sources s ON s.id = e.source_id;
INSERT INTO search_entry_map (rowid, event_id, source, entry_type, ts, visibility, year, month)
SELECT rowid, event_id, source, entry_type, coalesce(ts, 0), '',
       coalesce(year, 0), coalesce(month, '')
FROM search_entries;
COMMIT;
PRAGMA journal_mode = WAL;
SQL
  sqlite3 -bail -readonly data/otso/search.db > data/search/timeline.json <<'SQL'
WITH buckets AS (
  SELECT month, source, count(*) AS n FROM search_entry_map
  WHERE month <> '' GROUP BY month, source ORDER BY month, source
), totals AS (
  SELECT source, count(*) AS n FROM search_entry_map GROUP BY source ORDER BY n DESC
)
SELECT json_object(
  'buckets', json((SELECT json_group_array(json_object('month', month, 'source', source, 'count', n)) FROM buckets)),
  'minMonth', coalesce((SELECT min(month) FROM buckets), ''),
  'maxMonth', coalesce((SELECT max(month) FROM buckets), ''),
  'sourceTotals', json((SELECT json_group_array(json_object('source', source, 'count', n)) FROM totals))
);
SQL
)
```

The Chronicle SQLite index contains titles, text, timestamps, source names, and external IDs. Fields it does not store, such as original URLs, will be unavailable in this conversion.

## 4. Launch and verify

Use a temporary app directory so the FTS5 backend resolves `../../data/otso/search.db` to the new snapshot. The Vite configuration allows browser modules to load from the original workspace dependency directory. The loopback Meilisearch URL below selects the FTS5 fallback by pointing the health check at an unused port.

```sh
app_dir="$run_dir/packages/otso-search"
mkdir -p "$app_dir"
cd "$otso_root/packages/otso-search"
cp -R src static package.json svelte.config.js tsconfig.json "$app_dir/"
ln -s "$PWD/node_modules" "$app_dir/node_modules"
cat > "$app_dir/vite.config.ts" <<EOF_VITE
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
export default defineConfig({
  plugins: [sveltekit()],
  server: { fs: { allow: ['.', '$otso_root/node_modules'] } }
});
EOF_VITE

cd "$app_dir"
CHRONICLE_DATA_DIR="$run_dir/data" MEILISEARCH_URL=http://127.0.0.1:1 \
  npm run dev -- --host 127.0.0.1 --port 5173 --strictPort
```

Stop the previous Otso session before starting the replacement on port 5173. Open [Otso Search](http://127.0.0.1:5173), select the refreshed source, and search for a record from the new export. To see the exact newest indexed timestamp by source, run this in another terminal using the printed or saved `run_dir` path.

```sh
sqlite3 -readonly "$run_dir/data/otso/search.db" <<'SQL'
SELECT source, count(*), datetime(nullif(max(ts), 0), 'unixepoch') AS latest_utc
FROM search_entry_map GROUP BY source ORDER BY latest_utc DESC;
SQL
```

A browser reload reads the running snapshot. Repeat the reindex, conversion, and launch steps when newer normalized data is ready.

## Coverage

[/coverage](http://127.0.0.1:5173/coverage) shows every source as one lane on a shared time axis, so you can see where each archive starts, where it has holes and when it last got anything new. Brighter cells hold more records. Red marks a gap of at least the chosen length (a week, a month, three months or a year) between two records, and a dashed amber line marks a source that has had nothing since its last record. Drag across the lanes or the axis to zoom, or pick a range. Select a source's name to list its longest gaps; selecting one zooms to it, and **Browse in search** opens search filtered to that source. Records without a timestamp can't be placed and are counted separately.

**by category** (on by default) groups sources the way the search page's category chips do, so all browsers or all music sources share one lane. That lane only shows a gap when none of its sources had anything, and selecting it lists the sources under it. Categories with a single source stay as a plain lane.

Sources you no longer use can be archived from a source's details (or with `otso archive <source>`). They move to an Archived group at the bottom, drawn dimmed and never flagged as quiet, and syncing skips them. The list lives in `<sources-dir>/archived.json`, which the page finds through `OTSO_SOURCES_DIR`, the CLI's `~/.otso/config/settings.json`, or `OTSO_DATA_DIR`.

The page reads `search_entry_map` once and keeps the result until the index changes on disk, so the first load after a rebuild takes a moment on a large archive.

## Running without real data

To work on the UI without a personal archive, generate a synthetic index and point the app at it. Nothing in it comes from real sources. A few sources have made-up gaps, and two stop early, so the coverage page has something to show.

```sh
node scripts/seed-synthetic.cjs /tmp/otso-demo
OTSO_DATA_DIR=/tmp/otso-demo MEILISEARCH_URL=http://127.0.0.1:1 npm run dev
```

The Playwright suite has a `mobile` project that checks the phone layout at an iPhone viewport: `npx playwright test --project=mobile`.
