import React, { useState, useEffect, useCallback } from 'react';
import { useKeyboard, useTerminalDimensions, useAppContext } from '@opentui/react';
import { writeFile, mkdir, copyFile } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';
import { execa } from 'execa';
import type { SourceProgress } from '../../../../types/index.js';
import type { SourcePlugin, PluginStep, FormField } from '../../plugins/types.js';
import { detectSource, checkPermissions } from '../../services/source-detector.js';

interface PluginFlowProps {
  plugin: SourcePlugin;
  progress?: SourceProgress;
  onProgressUpdate: (progress: Partial<SourceProgress>) => void;
  onComplete: (success: boolean) => void;
  onSkip: () => void;
}

type FlowState =
  | 'step'           // Showing a step
  | 'form_input'     // Collecting form input
  | 'detecting'      // Detecting local source
  | 'need_permission'// Need Full Disk Access
  | 'copying'        // Copying files
  | 'watching'       // Watching for file
  | 'saving'         // Saving credentials
  | 'testing'        // Testing connection
  | 'done'           // Complete
  | 'error';         // Error state

export function PluginFlow({
  plugin,
  progress,
  onProgressUpdate,
  onComplete,
  onSkip,
}: PluginFlowProps) {
  const { width } = useTerminalDimensions();
  const [state, setState] = useState<FlowState>('step');
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [formData, setFormData] = useState<Record<string, string>>({});
  const [currentFieldIndex, setCurrentFieldIndex] = useState(0);
  const [inputValue, setInputValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [detectedPath, setDetectedPath] = useState<string | null>(null);

  const currentStep = plugin.steps[currentStepIndex];
  const isLastStep = currentStepIndex === plugin.steps.length - 1;

  // Get keyHandler from app context for paste events
  const { keyHandler } = useAppContext();

  // Handle paste events from terminal (bracketed paste mode)
  // OpenTUI's keyHandler paste event
  useEffect(() => {
    if (!keyHandler) return;

    const handlePaste = (event: { text: string }) => {
      // Only handle paste when in form input mode
      if (state === 'form_input') {
        const pastedText = event.text || '';
        const printableChars = pastedText.split('').filter(c => /[\x20-\x7E]/.test(c)).join('');
        if (printableChars.length > 0) {
          setInputValue((prev) => prev + printableChars);
        }
      }
    };

    keyHandler.on('paste', handlePaste);
    return () => {
      keyHandler.off('paste', handlePaste);
    };
  }, [keyHandler, state]);

  // Direct stdin listener for bracketed paste (fallback for terminals like Ghostty)
  useEffect(() => {
    if (state !== 'form_input') return;

    let pasteBuffer = '';
    let inPaste = false;
    const PASTE_START = '\x1b[200~';
    const PASTE_END = '\x1b[201~';

    const handleData = (data: Buffer) => {
      const str = data.toString();

      // Check for paste start
      if (str.includes(PASTE_START)) {
        inPaste = true;
        const startIdx = str.indexOf(PASTE_START) + PASTE_START.length;
        pasteBuffer = str.slice(startIdx);

        // Check if paste end is also in this chunk
        if (pasteBuffer.includes(PASTE_END)) {
          const endIdx = pasteBuffer.indexOf(PASTE_END);
          const content = pasteBuffer.slice(0, endIdx);
          const printableChars = content.split('').filter(c => /[\x20-\x7E]/.test(c)).join('');
          if (printableChars.length > 0) {
            setInputValue((prev) => prev + printableChars);
          }
          pasteBuffer = '';
          inPaste = false;
        }
      } else if (inPaste) {
        pasteBuffer += str;

        // Check for paste end
        if (pasteBuffer.includes(PASTE_END)) {
          const endIdx = pasteBuffer.indexOf(PASTE_END);
          const content = pasteBuffer.slice(0, endIdx);
          const printableChars = content.split('').filter(c => /[\x20-\x7E]/.test(c)).join('');
          if (printableChars.length > 0) {
            setInputValue((prev) => prev + printableChars);
          }
          pasteBuffer = '';
          inPaste = false;
        }
      }
    };

    process.stdin.on('data', handleData);
    return () => {
      process.stdin.off('data', handleData);
    };
  }, [state]);

  // Handle automated detection for 'copy' steps
  useEffect(() => {
    if (currentStep?.type === 'copy') {
      runDetection();
    }
  }, [currentStepIndex]);

  async function runDetection() {
    setState('detecting');
    try {
      // Build a minimal source object for detection
      const sourceForDetection = {
        name: plugin.id,
        localPaths: plugin.localPaths,
      };

      const result = await detectSource(sourceForDetection as any);

      if (!result.found) {
        setError('Database not found at expected location');
        setState('error');
        return;
      }

      setDetectedPath(result.path || null);

      // Check permissions
      if (result.path) {
        const permResult = await checkPermissions(sourceForDetection as any, result.path);
        if (!permResult.readable) {
          setState('need_permission');
          return;
        }
      }

      setState('step');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Detection failed');
      setState('error');
    }
  }

  async function performCopy() {
    if (!detectedPath) return;

    setState('copying');
    onProgressUpdate({ status: 'in_progress', startedAt: new Date().toISOString() });

    try {
      const dataDir = join(process.cwd(), 'data', 'sources', plugin.id);
      await mkdir(dataDir, { recursive: true });

      const destPath = join(dataDir, basename(detectedPath));
      await copyFile(detectedPath, destPath);

      onProgressUpdate({
        status: 'completed',
        filePath: destPath,
        completedAt: new Date().toISOString(),
      });
      setState('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Copy failed');
      onProgressUpdate({ status: 'error', error: error || 'Copy failed' });
      setState('error');
    }
  }

  async function saveCredentials() {
    setState('saving');
    onProgressUpdate({ status: 'in_progress', startedAt: new Date().toISOString() });

    try {
      // Validate if plugin has validation
      if (plugin.validateCredentials) {
        const validation = plugin.validateCredentials(formData);
        if (!validation.valid) {
          setError(validation.error || 'Invalid credentials');
          setState('form_input');
          return;
        }
      }

      // Save to config
      const configDir = join(process.cwd(), 'data', 'config');
      await mkdir(configDir, { recursive: true });

      const credPath = join(configDir, plugin.credentialsFile || `${plugin.id}-credentials.json`);
      await writeFile(
        credPath,
        JSON.stringify(
          {
            source: plugin.id,
            ...formData,
            createdAt: new Date().toISOString(),
          },
          null,
          2
        )
      );

      onProgressUpdate({
        status: 'completed',
        filePath: credPath,
        completedAt: new Date().toISOString(),
      });
      setState('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save credentials');
      onProgressUpdate({ status: 'error', error: error || 'Save failed' });
      setState('error');
    }
  }

  async function openUrl(url: string) {
    try {
      await execa('open', [url]);
    } catch {
      try {
        await execa('xdg-open', [url]);
      } catch {
        setError('Could not open URL. Please open manually: ' + url);
      }
    }
  }

  // Handle keyboard
  useKeyboard((key) => {
    // Form input mode
    if (state === 'form_input') {
      const formStep = currentStep as { fields: FormField[] };
      const currentField = formStep.fields[currentFieldIndex];

      // Handle special keys first before character input
      switch (key.name) {
        case 'backspace':
          setInputValue((prev) => prev.slice(0, -1));
          return;

        case 'p':
          // Paste from clipboard using pbpaste (macOS) or xclip (Linux)
          (async () => {
            try {
              const { stdout } = await execa('pbpaste');
              if (stdout) {
                const printableChars = stdout.split('').filter(c => /[\x20-\x7E]/.test(c)).join('');
                setInputValue((prev) => prev + printableChars);
              }
            } catch {
              try {
                const { stdout } = await execa('xclip', ['-selection', 'clipboard', '-o']);
                if (stdout) {
                  const printableChars = stdout.split('').filter(c => /[\x20-\x7E]/.test(c)).join('');
                  setInputValue((prev) => prev + printableChars);
                }
              } catch {
                // Clipboard access failed, ignore
              }
            }
          })();
          return;

        case 'return':
          if (inputValue || !currentField.required) {
            // Save field value
            setFormData((prev) => ({ ...prev, [currentField.name]: inputValue }));

            // Move to next field or submit
            if (currentFieldIndex < formStep.fields.length - 1) {
              setCurrentFieldIndex(currentFieldIndex + 1);
              setInputValue('');
            } else {
              // All fields done, save credentials
              const finalData = { ...formData, [currentField.name]: inputValue };
              setFormData(finalData);
              saveCredentials();
            }
          }
          return;

        case 'escape':
          setState('step');
          setInputValue('');
          setCurrentFieldIndex(0);
          return;
      }

      // Character input - accept any printable characters (including pasted text)
      if (key.sequence && key.sequence.length > 0) {
        let content = key.sequence;

        // Handle bracketed paste mode (used by Ghostty, iTerm2, etc.)
        // Bracketed paste wraps content in: \x1b[200~ ... \x1b[201~
        const bracketedPasteStart = '\x1b[200~';
        const bracketedPasteEnd = '\x1b[201~';
        if (content.includes(bracketedPasteStart)) {
          const startIdx = content.indexOf(bracketedPasteStart) + bracketedPasteStart.length;
          const endIdx = content.indexOf(bracketedPasteEnd);
          if (endIdx > startIdx) {
            content = content.slice(startIdx, endIdx);
          } else {
            content = content.slice(startIdx);
          }
        }

        // Filter to only printable ASCII characters
        const printableChars = content.split('').filter(c => /[\x20-\x7E]/.test(c)).join('');
        if (printableChars.length > 0) {
          setInputValue((prev) => prev + printableChars);
        }
      }
      return;
    }

    // Normal step navigation
    switch (key.name) {
      case 'return':
        handleStepAction();
        break;

      case 'right':
      case 'l':
        if (state === 'step' && !isLastStep) {
          setCurrentStepIndex(currentStepIndex + 1);
        }
        break;

      case 'left':
      case 'h':
        if (state === 'step' && currentStepIndex > 0) {
          setCurrentStepIndex(currentStepIndex - 1);
        }
        break;

      case 's':
        onSkip();
        break;

      case 'r':
        if (state === 'need_permission' || state === 'error') {
          setError(null);
          runDetection();
        }
        break;
    }
  });

  function handleStepAction() {
    if (state === 'done') {
      onComplete(true);
      return;
    }

    if (state === 'error') {
      onSkip();
      return;
    }

    if (!currentStep) return;

    switch (currentStep.type) {
      case 'open_url':
        openUrl(currentStep.url);
        // Move to next step after opening
        if (!isLastStep) {
          setCurrentStepIndex(currentStepIndex + 1);
        }
        break;

      case 'instruction':
        if (!isLastStep) {
          setCurrentStepIndex(currentStepIndex + 1);
        }
        break;

      case 'form':
        setState('form_input');
        setCurrentFieldIndex(0);
        setInputValue('');
        break;

      case 'copy':
        if (state === 'step' && detectedPath) {
          performCopy();
        }
        break;

      case 'watch':
        // Start file watcher
        setState('watching');
        break;
    }
  }

  // Render helpers
  const renderStepIndicator = () => (
    <box flexDirection="row" marginBottom={1}>
      <text fg="#8B5CF6">
        Step {currentStepIndex + 1} of {plugin.steps.length}
      </text>
      <text fg="#666666"> • {currentStep?.title}</text>
    </box>
  );

  const renderProgressDots = () => (
    <box flexDirection="row" marginBottom={1}>
      {plugin.steps.map((_, idx) => (
        <text
          key={idx}
          fg={idx === currentStepIndex ? '#8B5CF6' : idx < currentStepIndex ? '#00D4AA' : '#444444'}
        >
          {idx === currentStepIndex ? '●' : idx < currentStepIndex ? '✓' : '○'}{' '}
        </text>
      ))}
    </box>
  );

  // Pad a line with spaces to ensure it overwrites old terminal content
  const padLine = (text: string, targetWidth: number) => {
    const padLength = Math.max(0, targetWidth - text.length);
    return text + ' '.repeat(padLength);
  };

  const contentWidth = Math.max(40, width - 10); // Account for borders/padding

  const renderInstructionStep = (step: PluginStep & { type: 'instruction' }) => (
    <box flexDirection="column">
      <box border borderStyle="single" borderColor="#333333" padding={1} flexDirection="column">
        {step.content.map((line, idx) => (
          <text key={idx} fg="#FFFFFF">
            {padLine(line, contentWidth)}
          </text>
        ))}
      </box>

      {step.note && (
        <box marginTop={1}>
          <text fg="#FFB800">{padLine(`⚠ ${step.note}`, contentWidth)}</text>
        </box>
      )}

      {step.tip && (
        <box marginTop={1}>
          <text fg="#666666">{padLine(`💡 ${step.tip}`, contentWidth)}</text>
        </box>
      )}
    </box>
  );

  const renderOpenUrlStep = (step: PluginStep & { type: 'open_url' }) => (
    <box flexDirection="column">
      <box border borderStyle="single" borderColor="#333333" padding={1} flexDirection="column">
        <text fg="#FFFFFF">{padLine(step.description, contentWidth)}</text>
      </box>

      <box height={1} />

      <text fg="#00D4AA">{padLine(`Press Enter to open: ${step.url}`, contentWidth)}</text>
    </box>
  );

  const renderFormStep = (step: PluginStep & { type: 'form'; fields: FormField[] }) => {
    if (state !== 'form_input') {
      return (
        <box flexDirection="column">
          <box border borderStyle="single" borderColor="#333333" padding={1} flexDirection="column">
            <text fg="#FFFFFF">{padLine(step.description, contentWidth)}</text>
          </box>
          <box height={1} />
          <text fg="#888888">{padLine('Press Enter to fill in your credentials', contentWidth)}</text>
        </box>
      );
    }

    const currentField = step.fields[currentFieldIndex];
    const isSecret = currentField.type === 'secret';
    const displayValue = isSecret && inputValue.length > 8
      ? inputValue.slice(0, 4) + '•'.repeat(inputValue.length - 8) + inputValue.slice(-4)
      : isSecret
      ? '•'.repeat(inputValue.length)
      : inputValue;

    return (
      <box flexDirection="column">
        <text fg="#8B5CF6">{padLine(currentField.label, contentWidth)}</text>
        {currentField.helpText && (
          <text fg="#666666">{padLine(currentField.helpText, contentWidth)}</text>
        )}
        <box height={1} />

        <box border borderStyle="single" borderColor={inputValue ? '#8B5CF6' : '#444444'} padding={1} flexDirection="row">
          <text fg="#FFFFFF">{displayValue || currentField.placeholder || '(type here)'}</text>
          <text fg="#8B5CF6">▌</text>
        </box>

        {error && (
          <box marginTop={1}>
            <text fg="#FF6B6B">{padLine(error, contentWidth)}</text>
          </box>
        )}

        <box height={1} />
        <text fg="#666666">{padLine(`${inputValue.length} characters`, contentWidth)}</text>
        <box height={1} />
        <text fg="#888888">{padLine(`Cmd+V or p: paste | Enter: ${currentFieldIndex < step.fields.length - 1 ? 'next field' : step.submitText || 'save'} | Esc: back`, contentWidth)}</text>
      </box>
    );
  };

  const renderCopyStep = () => {
    if (state === 'detecting') {
      return (
        <box flexDirection="column">
          <text fg="#FFB800">{padLine('Detecting local database...', contentWidth)}</text>
        </box>
      );
    }

    if (state === 'need_permission') {
      return (
        <box flexDirection="column">
          <text fg="#FFB800">{padLine('Permission Required', contentWidth)}</text>
          <box height={1} />
          <text fg="#FFFFFF">{padLine('macOS requires Full Disk Access to read this database.', contentWidth)}</text>
          <box height={1} />
          <text fg="#666666">{padLine('To grant access:', contentWidth)}</text>
          <text fg="#666666">{padLine('  1. Open System Settings → Privacy & Security', contentWidth)}</text>
          <text fg="#666666">{padLine('  2. Click "Full Disk Access"', contentWidth)}</text>
          <text fg="#666666">{padLine('  3. Add your terminal app', contentWidth)}</text>
          <text fg="#666666">{padLine('  4. Restart your terminal', contentWidth)}</text>
          <box height={2} />
          <text fg="#888888">{padLine('Press R to retry, S to skip', contentWidth)}</text>
        </box>
      );
    }

    if (state === 'copying') {
      return (
        <box flexDirection="column">
          <text fg="#FFB800">{padLine('Copying database...', contentWidth)}</text>
        </box>
      );
    }

    if (detectedPath) {
      const displayPath = detectedPath.replace(homedir(), '~');
      return (
        <box flexDirection="column">
          <text fg="#00D4AA">{padLine('Database found!', contentWidth)}</text>
          <box height={1} />
          <text fg="#FFFFFF">{padLine(`Path: ${displayPath}`, contentWidth)}</text>
          <box height={1} />
          <text fg="#666666">{padLine(`This will copy the database to data/sources/${plugin.id}/`, contentWidth)}</text>
          <box height={2} />
          <text fg="#888888">{padLine('Press Enter to extract, S to skip', contentWidth)}</text>
        </box>
      );
    }

    return null;
  };

  // Main render
  return (
    <box flexDirection="column" flexGrow={1}>
      {/* Header */}
      <box marginBottom={1}>
        <text fg="#FFFFFF">
          <strong>{plugin.displayName}</strong>
        </text>
        <text fg="#666666"> — {plugin.description}</text>
      </box>

      {/* Content box */}
      <box
        flexDirection="column"
        border
        borderStyle="single"
        borderColor="#444444"
        padding={1}
        flexGrow={1}
      >
        {/* Done state */}
        {state === 'done' && (
          <box flexDirection="column">
            <text fg="#00D4AA">Setup complete!</text>
            <box height={1} />
            <text fg="#FFFFFF">
              {plugin.extractionType === 'api'
                ? `Credentials saved to: data/config/${plugin.credentialsFile || plugin.id + '-credentials.json'}`
                : `Data copied to: data/sources/${plugin.id}/`}
            </text>
            <box height={2} />
            <text fg="#888888">Press Enter to continue</text>
          </box>
        )}

        {/* Error state */}
        {state === 'error' && (
          <box flexDirection="column">
            <text fg="#FF6B6B">Setup failed</text>
            <box height={1} />
            <text fg="#FFFFFF">{error}</text>
            <box height={2} />
            <text fg="#888888">Press Enter to skip, R to retry</text>
          </box>
        )}

        {/* Step content */}
        {state !== 'done' && state !== 'error' && currentStep && (
          <box key={`step-${currentStepIndex}-${state}`} flexDirection="column">
            {renderStepIndicator()}
            {renderProgressDots()}
            <box height={1} />

            {currentStep.type === 'instruction' && renderInstructionStep(currentStep)}
            {currentStep.type === 'open_url' && renderOpenUrlStep(currentStep)}
            {currentStep.type === 'form' && renderFormStep(currentStep as any)}
            {currentStep.type === 'copy' && renderCopyStep()}
          </box>
        )}
      </box>

      {/* Footer */}
      <box marginTop={1}>
        <text fg="#666666">
          {state === 'form_input'
            ? 'Type to enter | Cmd+V or p: paste | Enter: submit | Esc: back'
            : state === 'done'
            ? 'Enter: continue'
            : '←/→: navigate | Enter: action | S: skip'}
        </text>
      </box>
    </box>
  );
}
