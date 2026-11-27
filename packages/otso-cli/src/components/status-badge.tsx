import type { SourceStatus } from '../types/index.js';

interface StatusBadgeProps {
  status: SourceStatus | 'found' | 'not_found' | 'permissions';
}

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: string }> = {
  // Detection statuses
  found: { label: 'Found', color: '#00D4AA', icon: '✓' },
  not_found: { label: 'Not found', color: '#666666', icon: '✗' },
  permissions: { label: 'Permissions', color: '#FFB800', icon: '⚠' },

  // Import statuses
  pending: { label: 'Pending', color: '#666666', icon: '·' },
  in_progress: { label: 'In progress', color: '#00D4AA', icon: '●' },
  waiting_export: { label: 'Awaiting export', color: '#FFB800', icon: '⏳' },
  waiting_file: { label: 'Awaiting file', color: '#FFB800', icon: '⏳' },
  validating: { label: 'Validating', color: '#00D4AA', icon: '⟳' },
  completed: { label: 'Complete', color: '#00D4AA', icon: '✓' },
  skipped: { label: 'Skipped', color: '#888888', icon: '○' },
  error: { label: 'Error', color: '#FF6B6B', icon: '✗' },
};

/**
 * A colored status pill/badge.
 * Shows the current state of a source with appropriate icon and color.
 */
export function StatusBadge({ status }: StatusBadgeProps) {
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.pending;

  return (
    <text fg={config.color}>
      {config.icon} {config.label}
    </text>
  );
}
