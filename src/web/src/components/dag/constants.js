/**
 * DAG Visualization Constants
 */

export const statusColorValues = {
  completed: '#22c55e',
  failed: '#ef4444',
  blocked: '#f59e0b',
  in_progress: '#3b82f6',
  pending: '#6b7280',
};

export const complexityColors = {
  low: '#22c55e',
  medium: '#f59e0b',
  high: '#ef4444',
};

export const DEFAULT_VIEWPORT = {
  width: 600,
  height: 400,
};

export const ZOOM_LIMITS = {
  min: 0.25,
  max: 3,
  step: 0.25,
};

export const NODE_DEFAULTS = {
  width: 180,
  height: 60,
};
