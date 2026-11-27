/**
 * Plugin architecture for source-specific extraction flows.
 * Each source can define custom steps, form fields, and actions.
 */

// Base instruction step that all sources share
export interface BaseStep {
  id: string;
  title: string;
  description: string;
}

// Step that opens a URL
export interface OpenUrlStep extends BaseStep {
  type: 'open_url';
  url: string;
  buttonText?: string;
}

// Step with custom instructions (rich text)
export interface InstructionStep extends BaseStep {
  type: 'instruction';
  content: string[];  // Array of instruction lines
  note?: string;      // Optional warning/note (shown in yellow)
  tip?: string;       // Optional tip (shown in dim)
}

// Step that collects form input
export interface FormStep extends BaseStep {
  type: 'form';
  fields: FormField[];
  submitText?: string;
}

// Step that watches for a file download
export interface WatchStep extends BaseStep {
  type: 'watch';
  patterns: string[];
  watchDir?: string;  // Default: ~/Downloads
  timeout?: number;   // Optional timeout in seconds
}

// Step that copies a local database
export interface CopyStep extends BaseStep {
  type: 'copy';
  sourcePath: string;
  description: string;
}

export type PluginStep = OpenUrlStep | InstructionStep | FormStep | WatchStep | CopyStep;

// Form field types
export interface BaseField {
  name: string;
  label: string;
  required?: boolean;
  placeholder?: string;
  helpText?: string;
}

export interface TextField extends BaseField {
  type: 'text';
  validation?: 'url' | 'email' | 'none';
}

export interface SecretField extends BaseField {
  type: 'secret';
  // Masked input for tokens/keys
}

export interface TextAreaField extends BaseField {
  type: 'textarea';
  rows?: number;
}

export interface SelectField extends BaseField {
  type: 'select';
  options: { value: string; label: string }[];
}

export type FormField = TextField | SecretField | TextAreaField | SelectField;

// The main plugin interface
export interface SourcePlugin {
  // Unique identifier (matches source name)
  id: string;

  // Display information
  displayName: string;
  description: string;

  // What type of extraction this is
  extractionType: 'automated' | 'export' | 'api' | 'takeout';

  // Category for grouping
  category: string;

  // The steps to complete extraction
  steps: PluginStep[];

  // For automated sources - where to find local data
  localPaths?: {
    path: string;
    platform: 'darwin' | 'linux' | 'win32' | 'all';
    description: string;
  }[];

  // Expected file patterns for export/takeout
  expectedFiles?: string[];

  // Where credentials are saved
  credentialsFile?: string;

  // Optional validation function for credentials
  validateCredentials?: (data: Record<string, string>) => { valid: boolean; error?: string };

  // URLs for reference
  urls?: {
    settings?: string;
    docs?: string;
    apiDocs?: string;
  };
}

// Registry of all plugins
export type PluginRegistry = Record<string, SourcePlugin>;
