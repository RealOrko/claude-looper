/**
 * DAG Node Component
 * Renders a single step node in the DAG visualization
 */
import React from 'react';
import { statusColorValues, complexityColors, NODE_DEFAULTS } from './constants.js';
import { truncateText, formatDuration, getNodeFilter } from './utils.js';

export default function DAGNode({
  node,
  currentStep,
  selectedNode,
  hoveredNode,
  recentlyChanged,
  tool,
  onNodeClick,
  onMouseEnter,
  onMouseLeave,
}) {
  const status = node.status || 'pending';
  const isActive = status === 'in_progress';
  const isCurrent = currentStep?.number === node.number;
  const isSelected = selectedNode?.number === node.number;
  const isHovered = hoveredNode?.number === node.number;
  const hasChanged = recentlyChanged?.has(node.number);
  const nodeWidth = node.width || NODE_DEFAULTS.width;
  const nodeHeight = node.height || NODE_DEFAULTS.height;

  const filter = getNodeFilter({ isSelected, hasChanged, isActive });

  return (
    <g
      className={`dag-node ${status} ${isActive ? 'active' : ''} ${isSelected ? 'selected' : ''} ${hasChanged ? 'changed' : ''}`}
      transform={`translate(${node.x - nodeWidth / 2}, ${node.y - nodeHeight / 2})`}
      filter={filter}
      onClick={(e) => onNodeClick(node, e)}
      onMouseEnter={() => onMouseEnter(node)}
      onMouseLeave={onMouseLeave}
      style={{ cursor: tool === 'pointer' ? 'pointer' : 'grab' }}
    >
      {/* Node shadow */}
      <rect x="2" y="3" width={nodeWidth} height={nodeHeight} rx="10" fill="rgba(0,0,0,0.3)" />

      {/* Node background */}
      <rect width={nodeWidth} height={nodeHeight} rx="10" className={`node-bg ${status}`} />

      {/* Selected/Current indicator */}
      {(isSelected || isCurrent) && (
        <rect
          x="-3" y="-3"
          width={nodeWidth + 6} height={nodeHeight + 6}
          rx="13" fill="none"
          stroke={isSelected ? "#8b5cf6" : "#3b82f6"}
          strokeWidth="2"
          strokeDasharray={isCurrent ? "6 3" : "none"}
        >
          {isCurrent && (
            <animate attributeName="stroke-dashoffset" from="0" to="-18" dur="1s" repeatCount="indefinite" />
          )}
        </rect>
      )}

      {/* Step number badge */}
      <circle cx="22" cy="22" r="15" className={`node-badge ${status}`} />
      <text x="22" y="27" textAnchor="middle" className="node-number" fontSize="12" fontWeight="bold" fill="white">
        {node.number}
      </text>

      {/* Status icon */}
      <NodeStatusIcon status={status} nodeWidth={nodeWidth} />

      {/* Description */}
      <text x="44" y="28" className="node-description" fontSize="11" fill="#e4e4e7">
        {truncateText(node.description, 16)}
      </text>

      {/* Complexity badge */}
      {node.complexity && (
        <g transform="translate(44, 38)">
          <rect width="45" height="16" rx="4" fill={complexityColors[node.complexity]} opacity="0.2" />
          <text x="22.5" y="11" textAnchor="middle" fontSize="9" fill={complexityColors[node.complexity]} fontWeight="500">
            {node.complexity}
          </text>
        </g>
      )}

      {/* Duration */}
      {node.duration && (
        <text x={nodeWidth - 8} y={nodeHeight - 8} textAnchor="end" fontSize="9" fill="#a1a1aa">
          {formatDuration(node.duration)}
        </text>
      )}

      {/* Hover highlight */}
      {isHovered && !isSelected && (
        <rect x="-2" y="-2" width={nodeWidth + 4} height={nodeHeight + 4} rx="12" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="1" />
      )}
    </g>
  );
}

function NodeStatusIcon({ status, nodeWidth }) {
  const color = statusColorValues[status];

  return (
    <g transform={`translate(${nodeWidth - 30}, 14)`}>
      <circle cx="8" cy="8" r="11" fill={color} opacity="0.15" />
      {status === 'completed' && (
        <path d="M4 8 L7 11 L12 5" stroke={color} strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      )}
      {status === 'failed' && (
        <>
          <line x1="4" y1="4" x2="12" y2="12" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
          <line x1="12" y1="4" x2="4" y2="12" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
        </>
      )}
      {status === 'in_progress' && (
        <circle cx="8" cy="8" r="5" fill={color}>
          <animate attributeName="r" values="4;6;4" dur="1s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="1;0.5;1" dur="1s" repeatCount="indefinite" />
        </circle>
      )}
      {status === 'pending' && (
        <circle cx="8" cy="8" r="5" stroke={color} strokeWidth="2" fill="none" />
      )}
      {status === 'blocked' && (
        <>
          <path d="M8 4 L8 9" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
          <circle cx="8" cy="12" r="1.5" fill={color} />
        </>
      )}
    </g>
  );
}
