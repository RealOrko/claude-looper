/**
 * DAG Tooltip Component
 * Shows a tooltip when hovering over a node
 */
import React from 'react';
import { truncateText } from './utils.js';

export default function DAGTooltip({ node, zoom, pan }) {
  if (!node) return null;

  return (
    <div
      className="dag-tooltip"
      style={{
        left: (node.x * zoom + pan.x) + 'px',
        top: (node.y * zoom + pan.y - 40) + 'px',
      }}
    >
      <strong>Step {node.number}</strong>
      <span>{truncateText(node.description, 30)}</span>
    </div>
  );
}
