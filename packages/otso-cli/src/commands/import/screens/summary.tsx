import { useKeyboard, useTerminalDimensions } from '@opentui/react';
import type { SourceProgress } from '../../../types/index.js';

interface SummaryScreenProps {
  sourceProgress: Record<string, SourceProgress>;
  onRunIndexer: () => void;
  onRestart: () => void;
  onQuit: () => void;
}

const STATUS_ICONS: Record<string, { icon: string; color: string }> = {
  completed: { icon: '✓', color: '#00D4AA' },
  skipped: { icon: '○', color: '#888888' },
  error: { icon: '✗', color: '#FF6B6B' },
  pending: { icon: '·', color: '#666666' },
  in_progress: { icon: '●', color: '#FFB800' },
  waiting_export: { icon: '⏳', color: '#FFB800' },
  waiting_file: { icon: '⏳', color: '#FFB800' },
  validating: { icon: '⟳', color: '#00D4AA' },
};

export function SummaryScreen({
  sourceProgress,
  onRunIndexer,
  onRestart,
  onQuit,
}: SummaryScreenProps) {
  const { width, height } = useTerminalDimensions();

  useKeyboard((key) => {
    switch (key.name) {
      case 'i':
        onRunIndexer();
        break;
      case 'r':
        onRestart();
        break;
      case 'q':
        onQuit();
        break;
    }
  });

  // Calculate statistics
  const entries = Object.entries(sourceProgress);
  const completed = entries.filter(([, p]) => p.status === 'completed').length;
  const skipped = entries.filter(([, p]) => p.status === 'skipped').length;
  const errors = entries.filter(([, p]) => p.status === 'error').length;
  const waiting = entries.filter(
    ([, p]) => p.status === 'waiting_export' || p.status === 'waiting_file'
  ).length;

  const totalEvents = entries.reduce((sum, [, p]) => sum + (p.eventCount || 0), 0);

  return (
    <box
      flexDirection="column"
      alignItems="center"
      justifyContent="center"
      width={width}
      height={height}
      padding={2}
    >
      {/* Header */}
      <text fg="#00D4AA">
        <strong>IMPORT COMPLETE</strong>
      </text>

      <box height={2} />

      {/* Stats summary */}
      <box
        border
        borderStyle="single"
        borderColor="#444444"
        padding={1}
        width={60}
      >
        <box flexDirection="column">
          <box flexDirection="row" justifyContent="space-between">
            <text>Sources processed:</text>
            <text fg="#00D4AA">
              <strong>{completed}</strong>
            </text>
          </box>
          {skipped > 0 && (
            <box flexDirection="row" justifyContent="space-between">
              <text>Skipped:</text>
              <text fg="#888888">{skipped}</text>
            </box>
          )}
          {errors > 0 && (
            <box flexDirection="row" justifyContent="space-between">
              <text>Errors:</text>
              <text fg="#FF6B6B">{errors}</text>
            </box>
          )}
          {waiting > 0 && (
            <box flexDirection="row" justifyContent="space-between">
              <text>Awaiting export:</text>
              <text fg="#FFB800">{waiting}</text>
            </box>
          )}
          <box height={1} />
          <box flexDirection="row" justifyContent="space-between">
            <text>Total events extracted:</text>
            <text fg="#00D4AA">
              <strong>{totalEvents.toLocaleString()}</strong>
            </text>
          </box>
        </box>
      </box>

      <box height={1} />

      {/* Source details */}
      <box
        border
        borderStyle="single"
        borderColor="#444444"
        padding={1}
        width={60}
        maxHeight={Math.max(height - 20, 5)}
      >
        <box flexDirection="column">
          <text fg="#888888">Source Details:</text>
          <box height={1} />
          {entries.map(([name, progress]) => {
            const status = STATUS_ICONS[progress.status] || STATUS_ICONS.pending;
            return (
              <box key={name} flexDirection="row">
                <text fg={status.color}>{status.icon}</text>
                <text> {name}</text>
                {progress.eventCount !== undefined && (
                  <text fg="#666666"> ({progress.eventCount} events)</text>
                )}
                {progress.error && (
                  <text fg="#FF6B6B"> - {progress.error}</text>
                )}
              </box>
            );
          })}
          {entries.length === 0 && (
            <text fg="#666666">No sources processed yet.</text>
          )}
        </box>
      </box>

      <box height={2} />

      {/* Next steps */}
      <box flexDirection="column" alignItems="center" width={60}>
        <text fg="#888888">Next Steps:</text>
        <box height={1} />
        <text>Run the indexer to process extracted data:</text>
        <box height={1} />
        <box
          backgroundColor="#333333"
          padding={1}
          paddingLeft={2}
          paddingRight={2}
        >
          <text fg="#00D4AA">
            <strong>cargo run -p otso-indexer -- build</strong>
          </text>
        </box>
      </box>

      <box height={2} />

      {/* Action buttons */}
      <box flexDirection="row">
        <box
          backgroundColor="#00D4AA"
          padding={1}
          paddingLeft={2}
          paddingRight={2}
          marginRight={2}
        >
          <text fg="#000000">
            <strong>i: Run Indexer</strong>
          </text>
        </box>
        <box
          border
          borderStyle="single"
          borderColor="#666666"
          padding={1}
          paddingLeft={2}
          paddingRight={2}
          marginRight={2}
        >
          <text fg="#888888">r: Restart</text>
        </box>
        <box
          border
          borderStyle="single"
          borderColor="#666666"
          padding={1}
          paddingLeft={2}
          paddingRight={2}
        >
          <text fg="#888888">q: Quit</text>
        </box>
      </box>
    </box>
  );
}
