/**
 * Source category types matching sources.toml
 */
export type SourceCategory =
  | 'reading'
  | 'music'
  | 'comms'
  | 'productivity'
  | 'browse'
  | 'notes'
  | 'photos'
  | 'location'
  | 'code'
  | 'ai'
  | 'curation'
  | 'social'
  | 'video'
  | 'calendar';

/**
 * Extraction complexity level
 */
export type ExtractionComplexity = 'easy' | 'medium' | 'complex';

/**
 * How data is obtained from this source
 */
export type ExtractionType = 'automated' | 'export' | 'takeout' | 'api';

/**
 * Action type for export instructions
 */
export type InstructionAction =
  | { type: 'open_url'; url: string }
  | { type: 'open_folder'; path: string }
  | { type: 'wait_for_file'; patterns: string[] };

/**
 * Local path configuration for automated sources
 */
export interface LocalPathConfig {
  path: string;
  platform: 'darwin' | 'linux' | 'win32' | 'all';
  description: string;
}

/**
 * Step in an export walkthrough
 */
export interface ExportInstruction {
  step: number;
  title: string;
  description: string;
  action?: InstructionAction;
}

/**
 * Metadata for a data source - used by the import wizard
 */
export interface SourceMeta {
  name: string;
  displayName: string;
  description: string;
  category: SourceCategory;
  complexity: ExtractionComplexity;
  extractionType: ExtractionType;

  // For automated sources
  localPaths?: LocalPathConfig[];

  // For export/takeout sources
  settingsUrl?: string;
  expectedFilePatterns?: string[];
  exportInstructions?: ExportInstruction[];
}

/**
 * Detection result for a source
 */
export interface DetectionResult {
  found: boolean;
  path?: string;
  size?: number;
  modifiedAt?: Date;
  requiresPermission?: boolean;
}

/**
 * Permission check result
 */
export interface PermissionResult {
  granted: boolean;
  permissionType?: 'full-disk-access' | 'photos' | 'contacts';
  instructions?: string;
}

/**
 * Validation result for a source file
 */
export interface ValidationResult {
  valid: boolean;
  errors?: string[];
  warnings?: string[];
  recordCount?: number;
}
