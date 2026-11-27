/**
 * Status of a source in the import flow
 */
export type SourceStatus =
  | 'pending'
  | 'in_progress'
  | 'waiting_export'
  | 'waiting_file'
  | 'validating'
  | 'completed'
  | 'skipped'
  | 'error';

/**
 * Progress state for a single source
 */
export interface SourceProgress {
  status: SourceStatus;
  startedAt?: string;
  completedAt?: string;
  currentStep?: number;
  totalSteps?: number;
  error?: string;
  filePath?: string;
  validated?: boolean;
  eventCount?: number;
}

/**
 * Persisted import state - stored in ~/.otso/import-state.json
 */
export interface ImportState {
  version: string;
  startedAt: string;
  lastUpdatedAt: string;

  selectedSources: string[];
  sourceProgress: Record<string, SourceProgress>;

  settings: ImportSettings;
}

/**
 * Import settings
 */
export interface ImportSettings {
  dataDir: string;
  watchDownloads: boolean;
  autoValidate: boolean;
}

/**
 * Current screen in the import wizard
 */
export type ImportScreen =
  | 'welcome'
  | 'source-selection'
  | 'extraction'
  | 'file-browser'
  | 'summary'
  | 'help';
