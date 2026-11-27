interface ProgressBarProps {
  current: number;
  total: number;
  width?: number;
  showPercentage?: boolean;
  filledChar?: string;
  emptyChar?: string;
  filledColor?: string;
  emptyColor?: string;
}

/**
 * A horizontal progress bar indicator.
 * Shows completion as a filled bar with optional percentage.
 */
export function ProgressBar({
  current,
  total,
  width = 30,
  showPercentage = true,
  filledChar = '━',
  emptyChar = '─',
  filledColor = '#00D4AA',
  emptyColor = '#444444',
}: ProgressBarProps) {
  const percentage = total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0;
  const filledWidth = Math.round((percentage / 100) * width);
  const emptyWidth = width - filledWidth;

  const filledBar = filledChar.repeat(filledWidth);
  const emptyBar = emptyChar.repeat(emptyWidth);

  return (
    <box flexDirection="row">
      <text fg={filledColor}>{filledBar}</text>
      <text fg={emptyColor}>{emptyBar}</text>
      {showPercentage && (
        <text fg="#888888"> {percentage}%</text>
      )}
    </box>
  );
}
