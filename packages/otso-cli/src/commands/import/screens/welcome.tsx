import { useKeyboard, useTerminalDimensions } from '@opentui/react';

interface WelcomeScreenProps {
  sourceCount: number;
  hasResumeState: boolean;
  onStart: () => void;
  onResume: () => void;
  onQuit: () => void;
}

const LOGO = `
╔═╗╔╦╗╔═╗╔═╗
║ ║ ║ ╚═╗║ ║
╚═╝ ╩ ╚═╝╚═╝
`;

export function WelcomeScreen({
  sourceCount,
  hasResumeState,
  onStart,
  onResume,
  onQuit,
}: WelcomeScreenProps) {
  const { width, height } = useTerminalDimensions();

  useKeyboard((key) => {
    if (key.name === 'return') {
      onStart();
    } else if (key.name === 'r' && hasResumeState) {
      onResume();
    } else if (key.name === 'q') {
      onQuit();
    }
  });

  return (
    <box
      flexDirection="column"
      alignItems="center"
      justifyContent="center"
      width={width}
      height={height}
      padding={2}
    >
      {/* Logo */}
      <text fg="#00D4AA">
        <strong>{LOGO}</strong>
      </text>
      <text fg="#888888">DATA IMPORT WIZARD</text>

      <box height={2} />

      {/* Description */}
      <box flexDirection="column" alignItems="center" width={60}>
        <text>This wizard helps you extract and archive your data from:</text>
        <box height={1} />
        <text fg="#888888">  • Local apps (Safari, Notes, Photos, Messages...)</text>
        <text fg="#888888">  • Cloud services (Spotify, GitHub, Notion...)</text>
        <text fg="#888888">  • Platform archives (Twitter, Google Takeout...)</text>
      </box>

      <box height={2} />

      {/* Stats */}
      <box
        border
        borderStyle="single"
        borderColor="#444444"
        padding={1}
        width={50}
      >
        <box flexDirection="column">
          <text>Found <strong fg="#00D4AA">{sourceCount}</strong> sources in sources.toml</text>
          <text fg="#666666">Data directory: data/sources</text>
        </box>
      </box>

      <box height={2} />

      {/* Action prompt */}
      <box
        backgroundColor="#00D4AA"
        padding={1}
        paddingLeft={3}
        paddingRight={3}
      >
        <text fg="#000000">
          <strong>Press Enter to Begin</strong>
        </text>
      </box>

      <box height={2} />

      {/* Keyboard hints */}
      <text fg="#666666">
        q: quit │ ?: help{hasResumeState ? ' │ r: resume previous session' : ''}
      </text>
    </box>
  );
}
