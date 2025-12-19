/**
 * DAG SVG Definitions Component
 * Contains arrow markers, glow filters, shadows, and background patterns
 */
import React from 'react';
import { statusColorValues } from './constants.js';

export default function DAGSvgDefs() {
  return (
    <defs>
      {/* Arrow markers for each status */}
      {Object.entries(statusColorValues).map(([status, color]) => (
        <marker
          key={status}
          id={`arrow-${status}`}
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill={color} />
        </marker>
      ))}

      {/* Glow filter for active nodes */}
      <filter id="glow-active" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="3" result="blur" />
        <feFlood floodColor="#3b82f6" floodOpacity="0.6" />
        <feComposite in2="blur" operator="in" />
        <feMerge>
          <feMergeNode />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>

      {/* Glow filter for selected nodes */}
      <filter id="glow-selected" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="4" result="blur" />
        <feFlood floodColor="#8b5cf6" floodOpacity="0.7" />
        <feComposite in2="blur" operator="in" />
        <feMerge>
          <feMergeNode />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>

      {/* Glow filter for recently changed nodes */}
      <filter id="glow-changed" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="5" result="blur" />
        <feFlood floodColor="#22c55e" floodOpacity="0.8" />
        <feComposite in2="blur" operator="in" />
        <feMerge>
          <feMergeNode />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>

      {/* Drop shadow */}
      <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="0" dy="2" stdDeviation="3" floodOpacity="0.3" />
      </filter>

      {/* Background grid pattern */}
      <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
        <path d="M 40 0 L 0 0 0 40" fill="none" stroke="rgba(255,255,255,0.03)" strokeWidth="1"/>
      </pattern>
    </defs>
  );
}
