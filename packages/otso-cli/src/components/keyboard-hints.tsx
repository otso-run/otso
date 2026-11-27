interface KeyHint {
  key: string;
  label: string;
}

interface KeyboardHintsProps {
  hints: KeyHint[];
  separator?: string;
}

/**
 * Bottom bar showing available keyboard shortcuts.
 * Displays key bindings in a consistent format.
 */
export function KeyboardHints({
  hints,
  separator = ' │ ',
}: KeyboardHintsProps) {
  return (
    <box flexDirection="row">
      {hints.map((hint, idx) => (
        <box key={hint.key} flexDirection="row">
          {idx > 0 && <text fg="#444444">{separator}</text>}
          <text fg="#888888">{hint.key}</text>
          <text fg="#666666">: {hint.label}</text>
        </box>
      ))}
    </box>
  );
}

// Common hint presets
export const NAVIGATION_HINTS: KeyHint[] = [
  { key: 'j/k', label: 'up/down' },
  { key: 'g/G', label: 'top/bottom' },
];

export const SELECTION_HINTS: KeyHint[] = [
  { key: 'Space', label: 'toggle' },
  { key: 'a', label: 'all' },
  { key: 'n', label: 'none' },
];

export const ACTION_HINTS: KeyHint[] = [
  { key: 'Enter', label: 'confirm' },
  { key: 'Esc', label: 'back' },
  { key: 'q', label: 'quit' },
];
