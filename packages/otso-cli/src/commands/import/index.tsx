import { createCliRenderer } from '@opentui/core';
import { createRoot, useKeyboard, useTerminalDimensions } from '@opentui/react';
import { useState, useEffect } from 'react';
import type { ImportScreen, SourceProgress, SourceMeta } from '../../types/index.js';
import { SOURCE_METADATA } from './source-metadata.js';
import { WelcomeScreen } from './screens/welcome.js';
import { SourceSelectionScreen } from './screens/source-selection.js';
import { ExtractionScreen } from './screens/extraction.js';
import { SummaryScreen } from './screens/summary.js';

interface ImportOptions {
  resume?: boolean;
  source?: string;
  config?: string;
}

interface ImportAppProps {
  options: ImportOptions;
}

function ImportApp({ options }: ImportAppProps) {
  const { width, height } = useTerminalDimensions();
  const [screen, setScreen] = useState<ImportScreen>('welcome');
  const [currentSource, setCurrentSource] = useState<SourceMeta | null>(null);
  const [sourceProgress, setSourceProgress] = useState<Record<string, SourceProgress>>({});

  // Handle global keyboard shortcuts
  useKeyboard((key) => {
    if (key.name === 'q' && key.ctrl) {
      process.exit(0);
    }
  });

  // Load previous state if resuming
  useEffect(() => {
    if (options.resume) {
      // TODO: Load state from ~/.otso/import-state.json
      console.log('Resume mode - loading previous state...');
    }
  }, [options.resume]);

  const sourceCount = Object.keys(SOURCE_METADATA).length;

  const handleStartSetup = () => {
    setScreen('source-selection');
  };

  const handleSourceSelect = (source: SourceMeta) => {
    setCurrentSource(source);
    // Initialize progress for this source if not already set
    if (!sourceProgress[source.name]) {
      setSourceProgress((prev) => ({
        ...prev,
        [source.name]: { status: 'pending' },
      }));
    }
    setScreen('extraction');
  };

  const handleProgressUpdate = (sourceName: string, update: Partial<SourceProgress>) => {
    setSourceProgress((prev) => ({
      ...prev,
      [sourceName]: { ...prev[sourceName], ...update },
    }));
  };

  const handleExtractionComplete = () => {
    // Go back to source selection to pick another
    setCurrentSource(null);
    setScreen('source-selection');
  };

  const handleViewSummary = () => {
    setScreen('summary');
  };

  const handleQuit = () => {
    process.exit(0);
  };

  // Render current screen
  switch (screen) {
    case 'welcome':
      return (
        <WelcomeScreen
          sourceCount={sourceCount}
          hasResumeState={false}
          onStart={handleStartSetup}
          onResume={() => {}}
          onQuit={handleQuit}
        />
      );

    case 'source-selection':
      return (
        <SourceSelectionScreen
          sources={SOURCE_METADATA}
          onSelect={handleSourceSelect}
          onBack={() => setScreen('welcome')}
        />
      );

    case 'extraction':
      if (!currentSource) {
        setScreen('source-selection');
        return null;
      }
      return (
        <ExtractionScreen
          sources={[currentSource]}
          sourceProgress={sourceProgress}
          onProgressUpdate={handleProgressUpdate}
          onComplete={handleExtractionComplete}
          onBack={() => {
            setCurrentSource(null);
            setScreen('source-selection');
          }}
        />
      );

    case 'summary':
      return (
        <SummaryScreen
          sourceProgress={sourceProgress}
          onRunIndexer={() => {}}
          onRestart={() => setScreen('source-selection')}
          onQuit={handleQuit}
        />
      );

    default:
      return (
        <box flexDirection="column" padding={2}>
          <text>Screen not implemented: {screen}</text>
        </box>
      );
  }
}

export async function runImport(options: ImportOptions): Promise<void> {
  const renderer = await createCliRenderer({
    exitOnCtrlC: true,
  });
  createRoot(renderer).render(<ImportApp options={options} />);

  // Keep the process alive until explicitly exited
  await new Promise(() => {});
}
