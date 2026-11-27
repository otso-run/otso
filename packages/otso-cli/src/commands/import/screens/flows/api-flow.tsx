import React, { useState } from 'react';
import { useKeyboard, useTerminalDimensions } from '@opentui/react';
import { execa } from 'execa';
import type { SourceMeta, SourceProgress } from '../../../../types/index.js';
import { saveCredentials, displayCredentialsPath } from '../../services/credentials.js';

interface APIFlowProps {
  source: SourceMeta;
  progress?: SourceProgress;
  onProgressUpdate: (progress: Partial<SourceProgress>) => void;
  onComplete: (success: boolean) => void;
  onSkip: () => void;
}

type FlowState = 'instructions' | 'input' | 'saving' | 'done' | 'error';

export function APIFlow({
  source,
  progress,
  onProgressUpdate,
  onComplete,
  onSkip,
}: APIFlowProps) {
  const { width, height } = useTerminalDimensions();
  const [state, setState] = useState<FlowState>('instructions');
  const [tokenInput, setTokenInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [currentStep, setCurrentStep] = useState(0);

  const instructions = source.exportInstructions || [];
  const currentInstruction = instructions[currentStep];

  // Handle keyboard
  useKeyboard((key) => {
    if (state === 'input') {
      // Handle token input
      if (key.sequence && key.sequence.length === 1 && /[a-zA-Z0-9_\-.]/.test(key.sequence)) {
        setTokenInput((prev) => prev + key.sequence);
        return;
      }

      switch (key.name) {
        case 'backspace':
          setTokenInput((prev) => prev.slice(0, -1));
          break;
        case 'return':
          if (tokenInput.length > 0) {
            saveToken();
          }
          break;
        case 'escape':
          setState('instructions');
          setTokenInput('');
          break;
      }
      return;
    }

    switch (key.name) {
      case 'return':
        if (state === 'instructions') {
          handleStepAction();
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

      case 't':
        if (state === 'instructions') {
          setState('input');
        }
        break;

      case 's':
        onSkip();
        break;
    }
  });

  async function handleStepAction() {
    if (!currentInstruction?.action) {
      // No action, move to next step or input
      if (currentStep < instructions.length - 1) {
        setCurrentStep(currentStep + 1);
      } else {
        setState('input');
      }
      return;
    }

    const action = currentInstruction.action;

    if (action.type === 'open_url') {
      try {
        await execa('open', [action.url]);
      } catch {
        try {
          await execa('xdg-open', [action.url]);
        } catch {
          setError('Could not open URL. Please open manually: ' + action.url);
        }
      }
      // Move to next step after opening
      if (currentStep < instructions.length - 1) {
        setCurrentStep(currentStep + 1);
      } else {
        setState('input');
      }
    }
  }

  async function saveToken() {
    setState('saving');
    onProgressUpdate({ status: 'in_progress', startedAt: new Date().toISOString() });

    try {
      const credPath = await saveCredentials(`${source.name}-credentials.json`, {
        source: source.name,
        token: tokenInput,
        createdAt: new Date().toISOString(),
      });

      onProgressUpdate({
        status: 'completed',
        filePath: credPath,
        completedAt: new Date().toISOString()
      });
      setState('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save credentials');
      onProgressUpdate({ status: 'error', error: error || 'Save failed' });
      setState('error');
    }
  }

  // Mask token for display
  const maskedToken = tokenInput.length > 8
    ? tokenInput.slice(0, 4) + '•'.repeat(tokenInput.length - 8) + tokenInput.slice(-4)
    : '•'.repeat(tokenInput.length);

  return (
    <box flexDirection="column" flexGrow={1}>
      {/* Source info */}
      <box marginBottom={1}>
        <text fg="#666666">{source.description}</text>
        <text fg="#8B5CF6"> (API access required)</text>
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
              <text fg="#8B5CF6">
                Step {currentStep + 1} of {instructions.length}
              </text>
              <text fg="#666666">
                {' '}• {currentInstruction.title}
              </text>
            </box>

            {/* Progress dots */}
            <box flexDirection="row" marginBottom={1}>
              {instructions.map((_, idx) => (
                <text key={idx} fg={idx === currentStep ? '#8B5CF6' : idx < currentStep ? '#666666' : '#444444'}>
                  {idx === currentStep ? '●' : '○'}{' '}
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
            {!currentInstruction.action && (
              <text fg="#888888">
                Press Enter to continue, or T to enter token
              </text>
            )}
          </box>
        )}

        {/* Token input state */}
        {state === 'input' && (
          <box flexDirection="column">
            <text fg="#8B5CF6">Enter API Token</text>
            <box height={1} />
            <text fg="#666666">
              Paste your {source.displayName} API token below:
            </text>
            <box height={1} />

            {/* Token input field */}
            <box
              border
              borderStyle="single"
              borderColor={tokenInput ? '#8B5CF6' : '#444444'}
              padding={1}
            >
              <text fg="#FFFFFF">
                {tokenInput ? maskedToken : '(start typing your token)'}
                <text fg="#8B5CF6">▌</text>
              </text>
            </box>

            <box height={1} />
            <text fg="#666666">
              {tokenInput.length} characters entered
            </text>
            <box height={1} />
            <text fg="#888888">
              Enter: save | Esc: back | Backspace: delete
            </text>
          </box>
        )}

        {/* Saving state */}
        {state === 'saving' && (
          <box flexDirection="column">
            <text fg="#FFB800">Saving credentials...</text>
          </box>
        )}

        {/* Done state */}
        {state === 'done' && (
          <box flexDirection="column">
            <text fg="#00D4AA">Credentials saved!</text>
            <box height={1} />
            <text fg="#FFFFFF">
              Token saved to: {displayCredentialsPath(`${source.name}-credentials.json`)}
            </text>
            <box height={1} />
            <text fg="#666666">
              The indexer will use this token to fetch your data.
            </text>
            <box height={2} />
            <text fg="#888888">Press Enter to continue</text>
          </box>
        )}

        {/* Error state */}
        {state === 'error' && (
          <box flexDirection="column">
            <text fg="#FF6B6B">Failed to save credentials</text>
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
            ? '←/→: navigate | Enter: action | T: enter token | S: skip'
            : state === 'input'
            ? 'Enter: save | Esc: back'
            : 'S: skip'}
        </text>
      </box>
    </box>
  );
}
