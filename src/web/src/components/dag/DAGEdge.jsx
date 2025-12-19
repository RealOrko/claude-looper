/**
 * DAG Edge Component
 * Renders a single edge (connection) between two nodes
 */
import React from 'react';
import { statusColorValues } from './constants.js';
import { calculateEdgePath } from './utils.js';

export default function DAGEdge({ edge, selectedNode }) {
  const status = edge.from.status || 'pending';
  const strokeColor = statusColorValues[status];
  const isHighlighted = selectedNode &&
    (selectedNode.number === edge.from.number || selectedNode.number === edge.to.number);

  const pathD = calculateEdgePath(edge.from, edge.to);

  return (
    <g className={`dag-edge ${status} ${isHighlighted ? 'highlighted' : ''}`}>
      {/* Shadow path */}
      <path
        d={pathD}
        fill="none"
        stroke="rgba(0,0,0,0.2)"
        strokeWidth="4"
        style={{ transform: 'translate(1px, 2px)' }}
      />
      {/* Main path */}
      <path
        d={pathD}
        fill="none"
        stroke={strokeColor}
        strokeWidth={isHighlighted ? "3" : "2"}
        strokeOpacity={isHighlighted ? 1 : 0.7}
        markerEnd={`url(#arrow-${status})`}
        className={status === 'in_progress' ? 'animated-edge' : ''}
      />
      {/* Animated dot for in_progress */}
      {status === 'in_progress' && (
        <circle r="4" fill={strokeColor} className="edge-dot">
          <animateMotion dur="1.5s" repeatCount="indefinite" path={pathD} />
        </circle>
      )}
    </g>
  );
}
