import React, { useState, useEffect, useRef } from 'react';
import { useKeyboard, useTerminalDimensions } from '@opentui/react';
import { copyFile, mkdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { execa } from 'execa';
import type { SourceMeta, SourceProgress, ExportInstruction } from '../../../../types/index.js';
import { watchForFiles, findExistingFiles, getDownloadsDir, type WatchedFile, type WatchHandle } from '../../services/file-watcher.js';

interface ExportFlowProps {
  source: SourceMeta;
  progress?: SourceProgress;
  onProgressUpdate: (progress: Partial<SourceProgress>) => void;
  onComplete: (success: boolean) => void;
  onSkip: () => void;
}

type FlowState = 'instructions' | 'watching' | 'found' | 'copying' | 'done' | 'error';

export function ExportFlow({
  source,
  progress,
  onProgressUpdate,
  onComplete,
  onSkip,
}: ExportFlowProps) {
  const { width, height } = useTerminalDimensions();
  const [state, setState] = useState<FlowState>('instructions');
  const [currentStep, setCurrentStep] = useState(0);
  const [foundFile, setFoundFile] = useState<WatchedFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isWatching, setIsWatching] = useState(false);
  const watchHandleRef = useRef<WatchHandle | null>(null);

  const instructions = source.exportInstructions || [];
  const patterns = source.expectedFilePatterns || [];
  const currentInstruction = instructions[currentStep];

  // Check for existing files on mount
  useEffect(() => {
    async function checkExisting() {
      if (patterns.length === 0) return;

      const existing = await findExistingFiles(getDownloadsDir(), patterns);
      if (existing.length > 0) {
        // Sort by date, newest first
        existing.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        setFoundFile(existing[0]);
        setState('found');
      }
    }

    checkExisting();
  }, [patterns]);

  // Start file watcher when entering watching state
  useEffect(() => {
    if (state !== 'watching' || patterns.length === 0) return;

    setIsWatching(true);
    watchHandleRef.current = watchForFiles(getDownloadsDir(), patterns, (file) => {
      setFoundFile(file);
      setState('found');
    });

    return () => {
      if (watchHandleRef.current) {
        watchHandleRef.current.stop();
        watchHandleRef.current = null;
      }
      setIsWatching(false);
    };
  }, [state, patterns]);

  // Handle keyboard
  useKeyboard((key) => {
    switch (key.name) {
      case 'return':
        if (state === 'instructions') {
          handleStepAction();
        } else if (state === 'found' && foundFile) {
          performCopy();
        } else if (state === 'done') {
          onComplete(true);
        } else if (state === 'error') {
          onSkip();
        }
        break;

      case 'right':
      case 'l':
        if (state === 'instructions' && currentStep < instructions.length - 1) {
          setCurrentStep(currentStep + 1);
        }
        break;

      case 'left':
      case 'h':
        if (state === 'instructions' && currentStep > 0) {
          setCurrentStep(currentStep - 1);
        }
        break;

      case 'w':
        if (state === 'instructions' && patterns.length > 0) {
          setState('watching');
        }
        break;

      case 's':
        onSkip();
        break;

      case 'b':
        if (state === 'watching') {
          if (watchHandleRef.current) {
            watchHandleRef.current.stop();
          }
          setState('instructions');
        }
        break;
    }
  });

  async function handleStepAction() {
    if (!currentInstruction?.action) {
      // No action, just move to next step
      if (currentStep < instructions.length - 1) {
        setCurrentStep(currentStep + 1);
      } else if (patterns.length > 0) {
        setState('watching');
      }
      return;
    }

    const action = currentInstruction.action;

    switch (action.type) {
      case 'open_url':
        try {
          // Open URL in default browser
          await execa('open', [action.url]);
        } catch {
          // Fallback for Linux
          try {
            await execa('xdg-open', [action.url]);
          } catch {
            setError('Could not open URL. Please open manually: ' + action.url);
          }
        }
        // Move to next step after opening
        if (currentStep < instructions.length - 1) {
          setCurrentStep(currentStep + 1);
        }
        break;

      case 'open_folder':
        try {
          const folderPath = action.path.startsWith('~/')
            ? action.path.replace('~', process.env.HOME || '')
            : action.path;
          await execa('open', [folderPath]);
        } catch {
          setError('Could not open folder');
        }
        break;

      case 'wait_for_file':
        setState('watching');
        break;
    }
  }

  async function performCopy() {
    if (!foundFile) return;

    setState('copying');
    onProgressUpdate({ status: 'in_progress', startedAt: new Date().toISOString() });

    try {
      // Create destination directory
      const dataDir = join(process.cwd(), 'data', 'sources', source.name);
      await mkdir(dataDir, { recursive: true });

      // Copy the file
      const destPath = join(dataDir, foundFile.name);
      await copyFile(foundFile.path, destPath);

      onProgressUpdate({
        status: 'completed',
        filePath: destPath,
        completedAt: new Date().toISOString()
      });
      setState('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Copy failed');
      onProgressUpdate({ status: 'error', error: error || 'Copy failed' });
      setState('error');
    }
  }

  // Format file size for display
  function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  return (
    <box flexDirection="column" flexGrow={1}>
      {/* Source info */}
      <box marginBottom={1}>
        <text fg="#666666">{source.description}</text>
        {source.extractionType === 'takeout' && (
          <text fg="#FF6B6B"> (Archive request - may take days)</text>
        )}
      </box>

      {/* Main content box */}
      <box
        flexDirection="column"
        border
        borderStyle="single"
        borderColor="#444444"
        padding={1}
        flexGrow={1}
      >
        {/* Instructions state */}
        {state === 'instructions' && currentInstruction && (
          <box flexDirection="column">
            {/* Step indicator */}
            <box flexDirection="row" marginBottom={1}>
              <text fg="#00D4AA">
                Step {currentStep + 1} of {instructions.length}
              </text>
              <text fg="#666666">
                {' '}• {currentInstruction.title}
              </text>
            </box>

            {/* Progress dots */}
            <box flexDirection="row" marginBottom={1}>
              {instructions.map((_, idx) => (
                <text key={idx} fg={idx === currentStep ? '#00D4AA' : idx < currentStep ? '#666666' : '#444444'}>
                  {idx === currentStep ? '●' : idx < currentStep ? '○' : '○'}{' '}
                </text>
              ))}
            </box>

            <box height={1} />

            {/* Instruction content */}
            <box
              border
              borderStyle="single"
              borderColor="#333333"
              padding={1}
            >
              <text fg="#FFFFFF">{currentInstruction.description}</text>
            </box>

            <box height={1} />

            {/* Action hint */}
            {currentInstruction.action?.type === 'open_url' && (
              <text fg="#FFB800">
                Press Enter to open: {currentInstruction.action.url}
              </text>
            )}
            {currentInstruction.action?.type === 'wait_for_file' && (
              <text fg="#FFB800">
                Press Enter to start watching for downloads
              </text>
            )}
            {!currentInstruction.action && currentStep < instructions.length - 1 && (
              <text fg="#888888">
                Press Enter or → to continue
              </text>
            )}
          </box>
        )}

        {/* Watching state */}
        {state === 'watching' && (
          <box flexDirection="column">
            <box flexDirection="row">
              <text fg="#FFB800">Watching for files...</text>
              <text fg="#666666"> (press B to go back)</text>
            </box>
            <box height={1} />
            <text fg="#666666">Looking in: ~/Downloads</text>
            <text fg="#666666">
              Patterns: {patterns.join(', ')}
            </text>
            <box height={2} />
            <box flexDirection="row">
              <text fg="#00D4AA">{isWatching ? '●' : '○'}</text>
              <text fg="#666666"> Waiting for file to appear...</text>
            </box>
            <box height={1} />
            <text fg="#888888">
              Download your export file and it will be detected automatically.
            </text>
          </box>
        )}

        {/* Found state */}
        {state === 'found' && foundFile && (
          <box flexDirection="column">
            <text fg="#00D4AA">File detected!</text>
            <box height={1} />
            <text fg="#FFFFFF">Name: {foundFile.name}</text>
            <text fg="#666666">Size: {formatSize(foundFile.size)}</text>
            <text fg="#666666">
              Created: {foundFile.createdAt.toLocaleString()}
            </text>
            <box height={2} />
            <text fg="#888888">Press Enter to import, S to skip</text>
          </box>
        )}

        {/* Copying state */}
        {state === 'copying' && (
          <box flexDirection="column">
            <text fg="#FFB800">Copying file...</text>
            <box height={1} />
            <text fg="#666666">
              Importing to data/sources/{source.name}/
            </text>
          </box>
        )}

        {/* Done state */}
        {state === 'done' && (
          <box flexDirection="column">
            <text fg="#00D4AA">Import complete!</text>
            <box height={1} />
            <text fg="#FFFFFF">
              Saved to: data/sources/{source.name}/{foundFile?.name}
            </text>
            <box height={2} />
            <text fg="#888888">Press Enter to continue</text>
          </box>
        )}

        {/* Error state */}
        {state === 'error' && (
          <box flexDirection="column">
            <text fg="#FF6B6B">Import failed</text>
            <box height={1} />
            <text fg="#FFFFFF">{error}</text>
            <box height={2} />
            <text fg="#888888">Press Enter to skip</text>
          </box>
        )}
      </box>

      {/* Footer */}
      <box marginTop={1}>
        <text fg="#666666">
          {state === 'instructions'
            ? '←/→: navigate steps | Enter: action | W: watch | S: skip'
            : state === 'watching'
            ? 'B: back | S: skip'
            : state === 'found'
            ? 'Enter: import | S: skip'
            : 'S: skip'}
        </text>
      </box>
    </box>
  );
}
