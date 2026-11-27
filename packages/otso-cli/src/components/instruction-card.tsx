interface InstructionCardProps {
  title: string;
  instructions: string[];
  note?: string;
  actionLabel?: string;
  width?: number;
}

/**
 * A bordered card displaying step-by-step instructions.
 * Used in the guided walkthrough for export/takeout sources.
 */
export function InstructionCard({
  title,
  instructions,
  note,
  actionLabel,
  width = 60,
}: InstructionCardProps) {
  return (
    <box
      flexDirection="column"
      border
      borderStyle="single"
      borderColor="#444444"
      padding={1}
      width={width}
    >
      <text fg="#00D4AA">
        <strong>{title}</strong>
      </text>
      <box height={1} />

      {instructions.map((instruction, idx) => (
        <box key={idx} flexDirection="row" marginBottom={1}>
          <text fg="#888888">{idx + 1}. </text>
          <text>{instruction}</text>
        </box>
      ))}

      {note && (
        <box marginTop={1}>
          <text fg="#FFB800">⚠ {note}</text>
        </box>
      )}

      {actionLabel && (
        <box marginTop={1} alignItems="center">
          <box
            backgroundColor="#00D4AA"
            padding={1}
            paddingLeft={2}
            paddingRight={2}
          >
            <text fg="#000000">
              <strong>{actionLabel}</strong>
            </text>
          </box>
        </box>
      )}
    </box>
  );
}
