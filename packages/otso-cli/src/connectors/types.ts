import type { Archive } from '../core/archive.js';
import type { ChronicleStore, TableDef, UpsertStats } from '../core/chronicle.js';
import type { Credentials } from '../core/credentials.js';

/**
 * A connector turns one service into rows in that source's chronicle.db.
 *
 *   api     authenticate once (`otso auth`), then `otso sync` fetches
 *           incrementally and upserts. Safe to run on a schedule.
 *   export  the service only offers a downloadable archive. `otso ingest`
 *           (or the TUI) walks through requesting it, then processes the file.
 *   local   the data is a database already on this Mac. `otso sync` copies
 *           it to a temp file and reads it, never touching the original.
 *
 * Every connector writes rows keyed on a stable id, so any run can be repeated.
 */
export type ConnectorKind = 'api' | 'export' | 'local';

export interface AuthField {
  name: string;
  label: string;
  secret?: boolean;
  placeholder?: string;
  help?: string;
}

export interface AuthSpec {
  setupUrl: string;
  instructions: string[];
  fields: AuthField[];
  /** Resolves to a label for the account (username) or throws. */
  verify(creds: Credentials): Promise<string>;
}

export interface ExportGuide {
  url: string;
  steps: string[];
  /** Typical file names in ~/Downloads, used by the TUI's watcher. */
  filePatterns: string[];
  /** How long the service usually takes to prepare it. */
  wait?: string;
}

export interface RunContext {
  store: ChronicleStore;
  credentials: Credentials;
  /** Ignore saved cursors and re-fetch everything (still idempotent). */
  full: boolean;
  log: (message: string) => void;
  sourceDir: string;
}

export type RunStats = Record<string, UpsertStats>;

export interface Connector {
  /** Matches the source name used by the TUI and the sources folder. */
  id: string;
  displayName: string;
  description: string;
  kind: ConnectorKind;
  /** Relative to data/sources, matching db_path in sources.toml. */
  dbPath: string;
  /** Every table the sources.toml queries for this db expect. */
  tables: TableDef[];
  /** sources.toml entries this db feeds (defaults to [id]). */
  configSources?: string[];

  auth?: AuthSpec;
  exportGuide?: ExportGuide;
  /** Candidate paths for local sources; first readable one wins. Globs allowed in one segment. */
  localPaths?: string[];
  /** macOS privacy permission the terminal needs for local sources. */
  permission?: 'full-disk-access';

  sync?(ctx: RunContext): Promise<RunStats>;
  ingest?(ctx: RunContext, archive: Archive): Promise<RunStats>;

  /**
   * Some exports decide their own destination (e.g. one Twitter account per
   * folder). Return the db path and sources.toml block to use.
   */
  resolveTarget?(archive: Archive): Promise<{ dbPath: string; sourceName: string; tomlBlock?: string }>;
}
