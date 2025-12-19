/**
 * Goal Progress Constants
 * Pure data constants without React dependencies for testability
 */

/** Confidence level configurations (colors, labels, values) */
export const confidenceLevelData = {
  HIGH: { color: '#22c55e', label: 'High', value: 100, iconName: 'CheckCircle2' },
  MEDIUM: { color: '#f59e0b', label: 'Medium', value: 60, iconName: 'AlertTriangle' },
  LOW: { color: '#ef4444', label: 'Low', value: 30, iconName: 'XCircle' },
  UNKNOWN: { color: '#6b7280', label: 'Unknown', value: 10, iconName: 'Activity' },
};

/** Status configurations (colors, labels) */
export const statusConfigData = {
  idle: { color: '#6b7280', label: 'Idle', iconName: 'Pause' },
  initializing: { color: '#3b82f6', label: 'Initializing', iconName: 'Play' },
  planning: { color: '#8b5cf6', label: 'Planning', iconName: 'GitBranch' },
  executing: { color: '#22c55e', label: 'Executing', iconName: 'FastForward' },
  verifying: { color: '#f59e0b', label: 'Verifying', iconName: 'CheckCircle2' },
  completed: { color: '#22c55e', label: 'Completed', iconName: 'Award' },
  failed: { color: '#ef4444', label: 'Failed', iconName: 'XCircle' },
};
