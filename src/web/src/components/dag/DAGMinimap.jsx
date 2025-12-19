/**
 * DAG Minimap Component
 * Shows a small overview of the entire DAG with viewport indicator
 */
import React from 'react';
import { statusColorValues } from './constants.js';

export default function DAGMinimap({ nodes, pan, zoom, viewportWidth, viewportHeight }) {
  return (
    <div className="dag-minimap">
      <svg viewBox={`0 0 ${viewportWidth} ${viewportHeight}`}>
        {nodes.map((node) => (
          <rect
            key={node.number}
            x={node.x - 8}
            y={node.y - 5}
            width="16"
            height="10"
            rx="2"
            fill={statusColorValues[node.status || 'pending']}
            opacity="0.8"
          />
        ))}
        {/* Viewport indicator */}
        <rect
          x={-pan.x / zoom}
          y={-pan.y / zoom}
          width={viewportWidth / zoom}
          height={viewportHeight / zoom}
          fill="none"
          stroke="rgba(255,255,255,0.5)"
          strokeWidth="2"
        />
      </svg>
    </div>
  );
}
