/**
 * DAG Visualization Utility Functions
 */

// Re-export from shared formatters
export { formatDuration, truncateText } from '../../utils/formatters.js';

/**
 * Calculates bezier path for edge between two nodes
 * @param {Object} from - Source node
 * @param {Object} to - Target node
 * @returns {string} SVG path string
 */
export function calculateEdgePath(from, to) {
  const fromY = from.y + (from.height || 60) / 2;
  const toY = to.y - (to.height || 60) / 2;
  const midY = (fromY + toY) / 2;
  return `M ${from.x} ${fromY} C ${from.x} ${midY}, ${to.x} ${midY}, ${to.x} ${toY}`;
}

/**
 * Determines the glow filter for a node based on its state
 * @param {Object} options - Node state options
 * @returns {string} Filter URL or empty string
 */
export function getNodeFilter({ isSelected, hasChanged, isActive }) {
  if (isSelected) return 'url(#glow-selected)';
  if (hasChanged) return 'url(#glow-changed)';
  if (isActive) return 'url(#glow-active)';
  return '';
}
