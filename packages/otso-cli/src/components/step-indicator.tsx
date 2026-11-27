interface StepIndicatorProps {
  current: number;
  total: number;
  title?: string;
  showProgress?: boolean;
}

/**
 * Shows "Step X of Y" with optional title and progress bar.
 * Used in multi-step wizards like the guided walkthrough.
 */
export function StepIndicator({
  current,
  total,
  title,
  showProgress = true,
}: StepIndicatorProps) {
  const progressWidth = 40;
  const filledWidth = Math.round((current / total) * progressWidth);
  const emptyWidth = progressWidth - filledWidth;

  return (
    <box flexDirection="column">
      <box flexDirection="row">
        <text fg="#888888">Step </text>
        <text fg="#00D4AA">
          <strong>{current}</strong>
        </text>
        <text fg="#888888"> of {total}</text>
        {title && (
          <>
            <text fg="#888888">: </text>
            <text>{title}</text>
          </>
        )}
      </box>
      {showProgress && (
        <box marginTop={1}>
          <text fg="#00D4AA">{'━'.repeat(filledWidth)}</text>
          <text fg="#444444">{'─'.repeat(emptyWidth)}</text>
        </box>
      )}
    </box>
  );
}
