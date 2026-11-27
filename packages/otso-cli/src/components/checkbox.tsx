interface CheckboxProps {
  checked: boolean;
  label: string;
  focused?: boolean;
  disabled?: boolean;
  onChange?: (checked: boolean) => void;
}

/**
 * A toggleable checkbox with label.
 * Use Space or Enter to toggle when focused.
 */
export function Checkbox({
  checked,
  label,
  focused = false,
  disabled = false,
}: CheckboxProps) {
  const checkIcon = checked ? '✓' : ' ';
  const focusColor = focused ? '#00D4AA' : disabled ? '#444444' : '#FFFFFF';
  const checkColor = checked ? '#00D4AA' : '#666666';

  return (
    <box flexDirection="row">
      <text fg={checkColor}>[{checkIcon}]</text>
      <text fg={focusColor}> {label}</text>
    </box>
  );
}
