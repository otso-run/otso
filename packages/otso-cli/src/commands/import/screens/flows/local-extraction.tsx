import React, { useState, useEffect } from 'react';
import { useKeyboard, useTerminalDimensions } from '@opentui/react';
import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, basename, join } from 'node:path';
import { homedir } from 'node:os';
import type { SourceMeta, SourceProgress } from '../../../../types/index.js';
import { detectSource, checkPermissions } from '../../services/source-detector.js';
import { syncLocal } from '../../services/engine.js';

interface LocalExtractionFlowProps {
  source: SourceMeta;
  progress?: SourceProgress;
  onProgressUpdate: (progress: Partial<SourceProgress>) => void;
  onComplete: (success: boolean) => void;
  onSkip: () => void;
}

type FlowState = 'detecting' | 'need_permission' | 'ready' | 'copying' | 'done' | 'error' | 'not_found';

export function LocalExtractionFlow({
  source,
  progress,
  onProgressUpdate,
  onComplete,
  onSkip,
}: LocalExtractionFlowProps) {
  const { width } = useTerminalDimensions();
  const [state, setState] = useState<FlowState>('detecting');
  const [detectedPath, setDetectedPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copyProgress, setCopyProgress] = useState(0);
  const [summary, setSummary] = useState<string | null>(null);

  // Run detection on mount
  useEffect(() => {
    async function detect() {
      try {
        const result = await detectSource(source);

        if (!result.found) {
          setState('not_found');
          return;
        }

        setDetectedPath(result.path || null);

        // Check permissions
        if (result.path) {
          const permResult = await checkPermissions(source, result.path);
          if (!permResult.readable) {
            setState('need_permission');
            return;
          }
        }

        setState('ready');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Detection failed');
        setState('error');
      }
    }

    detect();
  }, [source]);

  // Handle keyboard
  useKeyboard((key) => {
    switch (key.name) {
      case 'return':
        if (state === 'ready' && detectedPath) {
          performCopy();
        } else if (state === 'done') {
          onComplete(true);
        } else if (state === 'error' || state === 'not_found') {
          onSkip();
        }
        break;

      case 's':
        onSkip();
        break;

      case 'r':
        if (state === 'need_permission') {
          // Retry permission check
          setState('detecting');
        }
        break;
    }
  });

  async function performCopy() {
    if (!detectedPath) return;

    setState('copying');
    onProgressUpdate({ status: 'in_progress', startedAt: new Date().toISOString() });

    try {
      // Read the app database into chronicle.db; sources without a connector
      // yet (e.g. Timing) are copied as-is.
      let destPath = detectedPath;
      const synced = await syncLocal(source.name);
      if (synced) {
        setSummary(synced);
      } else {
        const dataDir = join(process.cwd(), 'data', 'sources', source.name);
        await mkdir(dataDir, { recursive: true });
        destPath = join(dataDir, basename(detectedPath));
        await copyFile(detectedPath, destPath);
      }

      setCopyProgress(100);
      onProgressUpdate({
        status: 'completed',
        filePath: destPath,
        completedAt: new Date().toISOString()
      });
      setState('done');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Copy failed';
      setError(message);
      onProgressUpdate({ status: 'error', error: message });
      setState('error');
    }
  }

  // Format path for display (shorten home directory)
  const displayPath = detectedPath?.replace(homedir(), '~') || '';

  return (
    <box flexDirection="column" flexGrow={1}>
      {/* Source info */}
      <box marginBottom={1}>
        <text fg="#666666">{source.description}</text>
      </box>

      {/* Status box */}
      <box
        flexDirection="column"
        border
        borderStyle="single"
        borderColor="#444444"
        padding={1}
        flexGrow={1}
      >
        {/* Detecting state */}
        {state === 'detecting' && (
          <box flexDirection="column">
            <text fg="#FFB800">Detecting local database...</text>
            <box height={1} />
            <text fg="#666666">Checking: {source.localPaths?.[0]?.path.replace('~', homedir())}</text>
          </box>
        )}

        {/* Not found state */}
        {state === 'not_found' && (
          <box flexDirection="column">
            <text fg="#FF6B6B">Database not found</text>
            <box height={1} />
            <text fg="#666666">Expected at: {source.localPaths?.[0]?.path}</text>
            <box height={1} />
            <text fg="#666666">
              This source may not be installed or configured on this machine.
            </text>
            <box height={2} />
            <text fg="#888888">Press Enter to skip, or S to skip</text>
          </box>
        )}

        {/* Need permission state */}
        {state === 'need_permission' && (
          <box flexDirection="column">
            <text fg="#FFB800">Permission Required</text>
            <box height={1} />
            <text fg="#FFFFFF">
              macOS requires Full Disk Access to read this database.
            </text>
            <box height={1} />
            <text fg="#666666">To grant access:</text>
            <text fg="#666666">  1. Open System Settings → Privacy & Security</text>
            <text fg="#666666">  2. Click "Full Disk Access"</text>
            <text fg="#666666">  3. Add your terminal app (Terminal, iTerm2, etc.)</text>
            <text fg="#666666">  4. Restart your terminal</text>
            <box height={2} />
            <text fg="#888888">Press R to retry, S to skip</text>
          </box>
        )}

        {/* Ready state */}
        {state === 'ready' && detectedPath && (
          <box flexDirection="column">
            <text fg="#00D4AA">Database found!</text>
            <box height={1} />
            <text fg="#FFFFFF">Path: {displayPath}</text>
            <box height={1} />
            <text fg="#666666">
              This reads a copy into data/sources/{source.name}/chronicle/chronicle.db
            </text>
            <box height={2} />
            <text fg="#888888">Press Enter to extract, S to skip</text>
          </box>
        )}

        {/* Copying state */}
        {state === 'copying' && (
          <box flexDirection="column">
            <text fg="#FFB800">Copying database...</text>
            <box height={1} />
            <box flexDirection="row">
              <text fg="#444444">[</text>
              <text fg="#00D4AA">{'█'.repeat(Math.floor(copyProgress / 5))}</text>
              <text fg="#444444">{'░'.repeat(20 - Math.floor(copyProgress / 5))}</text>
              <text fg="#444444">]</text>
              <text fg="#666666"> {copyProgress}%</text>
            </box>
          </box>
        )}

        {/* Done state */}
        {state === 'done' && (
          <box flexDirection="column">
            <text fg="#00D4AA">Extraction complete!</text>
            <box height={1} />
            <text fg="#FFFFFF">{summary ?? `Copied to: data/sources/${source.name}/`}</text>
            <box height={2} />
            <text fg="#888888">Press Enter to continue</text>
          </box>
        )}

        {/* Error state */}
        {state === 'error' && (
          <box flexDirection="column">
            <text fg="#FF6B6B">Extraction failed</text>
            <box height={1} />
            <text fg="#FFFFFF">{error}</text>
            <box height={2} />
            <text fg="#888888">Press Enter to skip, S to skip</text>
          </box>
        )}
      </box>

      {/* Footer */}
      <box marginTop={1}>
        <text fg="#666666">
          {state === 'ready' ? 'Enter: extract | S: skip' :
           state === 'done' ? 'Enter: continue' :
           state === 'need_permission' ? 'R: retry | S: skip' :
           'S: skip'}
        </text>
      </box>
    </box>
  );
}
