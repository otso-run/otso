import React, { useState, useMemo } from 'react';
import { useKeyboard, useTerminalDimensions } from '@opentui/react';
import type { SourceMeta, SourceProgress } from '../../../types/index.js';
import { getPlugin } from '../plugins/index.js';
import { PluginFlow } from './flows/plugin-flow.js';
import { LocalExtractionFlow } from './flows/local-extraction.js';
import { ExportFlow } from './flows/export-flow.js';
import { APIFlow } from './flows/api-flow.js';

interface ExtractionScreenProps {
  sources: SourceMeta[];
  sourceProgress: Record<string, SourceProgress>;
  onProgressUpdate: (sourceName: string, progress: Partial<SourceProgress>) => void;
  onComplete: () => void;
  onBack: () => void;
}

export function ExtractionScreen({
  sources,
  sourceProgress,
  onProgressUpdate,
  onComplete,
  onBack,
}: ExtractionScreenProps) {
  const { width, height } = useTerminalDimensions();
  const [currentSourceIndex, setCurrentSourceIndex] = useState(0);

  // Handle global keyboard (Esc to go back)
  useKeyboard((key) => {
    if (key.name === 'escape') {
      onBack();
    }
  });

  // Find sources that still need processing
  const pendingSources = useMemo(() => {
    return sources.filter((s) => {
      const progress = sourceProgress[s.name];
      return !progress || progress.status === 'pending' || progress.status === 'in_progress';
    });
  }, [sources, sourceProgress]);

  const currentSource = pendingSources[currentSourceIndex];

  // Handle moving to next source
  const handleSourceComplete = (sourceName: string, success: boolean) => {
    onProgressUpdate(sourceName, {
      status: success ? 'completed' : 'error',
      completedAt: new Date().toISOString(),
    });

    // Move to next source or complete
    if (currentSourceIndex < pendingSources.length - 1) {
      setCurrentSourceIndex(currentSourceIndex + 1);
    } else {
      onComplete();
    }
  };

  const handleSkip = (sourceName: string) => {
    onProgressUpdate(sourceName, { status: 'skipped' });
    if (currentSourceIndex < pendingSources.length - 1) {
      setCurrentSourceIndex(currentSourceIndex + 1);
    } else {
      onComplete();
    }
  };

  // If no pending sources, we're done
  if (!currentSource) {
    onComplete();
    return null;
  }

  // Count completed/total for progress header
  const completedCount = sources.filter((s) => {
    const p = sourceProgress[s.name];
    return p && (p.status === 'completed' || p.status === 'skipped');
  }).length;

  // Check if source has a plugin
  const plugin = getPlugin(currentSource.name);

  // Render the appropriate flow based on plugin or extraction type
  const renderFlow = () => {
    // Use plugin flow if plugin exists
    if (plugin) {
      return (
        <PluginFlow
          plugin={plugin}
          progress={sourceProgress[currentSource.name]}
          onProgressUpdate={(p) => onProgressUpdate(currentSource.name, p)}
          onComplete={(success) => handleSourceComplete(currentSource.name, success)}
          onSkip={() => handleSkip(currentSource.name)}
        />
      );
    }

    // Fall back to generic flows
    switch (currentSource.extractionType) {
      case 'automated':
        return (
          <LocalExtractionFlow
            source={currentSource}
            progress={sourceProgress[currentSource.name]}
            onProgressUpdate={(p) => onProgressUpdate(currentSource.name, p)}
            onComplete={(success) => handleSourceComplete(currentSource.name, success)}
            onSkip={() => handleSkip(currentSource.name)}
          />
        );

      case 'export':
      case 'takeout':
        return (
          <ExportFlow
            source={currentSource}
            progress={sourceProgress[currentSource.name]}
            onProgressUpdate={(p) => onProgressUpdate(currentSource.name, p)}
            onComplete={(success) => handleSourceComplete(currentSource.name, success)}
            onSkip={() => handleSkip(currentSource.name)}
          />
        );

      case 'api':
        return (
          <APIFlow
            source={currentSource}
            progress={sourceProgress[currentSource.name]}
            onProgressUpdate={(p) => onProgressUpdate(currentSource.name, p)}
            onComplete={(success) => handleSourceComplete(currentSource.name, success)}
            onSkip={() => handleSkip(currentSource.name)}
          />
        );

      default:
        return (
          <box padding={2}>
            <text fg="#FF6B6B">Unknown extraction type: {currentSource.extractionType}</text>
          </box>
        );
    }
  };

  return (
    <box flexDirection="column" width={width} height={height} padding={1}>
      {/* Progress header */}
      <box flexDirection="row" justifyContent="space-between" width={width - 2}>
        <text>
          <strong>{currentSource.displayName.toUpperCase()}</strong>
        </text>
        <text fg="#666666">
          Source {completedCount + 1}/{sources.length}
        </text>
      </box>

      <box height={1} />

      {/* Flow content */}
      {renderFlow()}

      {/* Footer with global controls */}
      <box marginTop={1}>
        <text fg="#666666">
          Esc: back to selection
        </text>
      </box>
    </box>
  );
}
