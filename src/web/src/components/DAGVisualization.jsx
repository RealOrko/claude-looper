import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import {
  ZoomIn, ZoomOut, Maximize2, Move, MousePointer, Info, X,
  CheckCircle2, XCircle, AlertTriangle, Clock, ArrowRight
} from 'lucide-react';

const statusColorValues = {
  completed: '#22c55e',
  failed: '#ef4444',
  blocked: '#f59e0b',
  in_progress: '#3b82f6',
  pending: '#6b7280',
};

const complexityColors = {
  low: '#22c55e',
  medium: '#f59e0b',
  high: '#ef4444',
};

/**
 * Interactive DAG Visualization Component
 * Features: Pan, Zoom, Node selection, Minimap, Tooltips, Real-time updates
 */
export default function DAGVisualization({
  nodes,
  edges,
  width,
  height,
  currentStep,
  recentlyChanged,
  statusTransitions = [],
  onNodeClick
}) {
  // Viewport state
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [tool, setTool] = useState('pointer'); // 'pointer' or 'pan'

  // Selection state
  const [selectedNode, setSelectedNode] = useState(null);
  const [hoveredNode, setHoveredNode] = useState(null);

  // Refs
  const containerRef = useRef(null);
  const svgRef = useRef(null);

  // Calculate viewport dimensions
  const viewportWidth = useMemo(() => Math.max(width || 600, 600), [width]);
  const viewportHeight = useMemo(() => Math.max(height || 400, 400), [height]);

  // Handle zoom with mouse wheel
  const handleWheel = useCallback((e) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.1 : 0.1;
      setZoom(z => Math.min(Math.max(z + delta, 0.25), 3));
    }
  }, []);

  // Mouse event handlers for panning
  const handleMouseDown = useCallback((e) => {
    if (tool === 'pan' || e.button === 1 || (e.button === 0 && e.shiftKey)) {
      setIsPanning(true);
      setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
      e.preventDefault();
    }
  }, [tool, pan]);

  const handleMouseMove = useCallback((e) => {
    if (isPanning) {
      setPan({
        x: e.clientX - panStart.x,
        y: e.clientY - panStart.y,
      });
    }
  }, [isPanning, panStart]);

  const handleMouseUp = useCallback(() => {
    setIsPanning(false);
  }, []);

  // Node click handler
  const handleNodeClick = useCallback((node, e) => {
    e.stopPropagation();
    if (tool === 'pointer') {
      setSelectedNode(selectedNode?.number === node.number ? null : node);
      onNodeClick?.(node);
    }
  }, [tool, selectedNode, onNodeClick]);

  // Reset view
  const resetView = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  // Fit to view
  const fitToView = useCallback(() => {
    if (!containerRef.current) return;
    const containerWidth = containerRef.current.clientWidth;
    const containerHeight = containerRef.current.clientHeight - 50; // Account for controls

    const scaleX = containerWidth / viewportWidth;
    const scaleY = containerHeight / viewportHeight;
    const newZoom = Math.min(scaleX, scaleY, 1) * 0.9;

    setZoom(newZoom);
    setPan({ x: 0, y: 0 });
  }, [viewportWidth, viewportHeight]);

  // Add event listeners
  useEffect(() => {
    const container = containerRef.current;
    if (container) {
      container.addEventListener('wheel', handleWheel, { passive: false });
      return () => container.removeEventListener('wheel', handleWheel);
    }
  }, [handleWheel]);

  // Close panel on escape
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        setSelectedNode(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  if (!nodes || nodes.length === 0) {
    return (
      <div className="dag-visualization empty">
        <div className="empty-state">
          <Info size={48} />
          <p>No steps to visualize</p>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="dag-visualization"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      {/* Controls Bar */}
      <div className="dag-controls-bar">
        <div className="control-group">
          <button
            className={`control-btn ${tool === 'pointer' ? 'active' : ''}`}
            onClick={() => setTool('pointer')}
            title="Select (V)"
          >
            <MousePointer size={16} />
          </button>
          <button
            className={`control-btn ${tool === 'pan' ? 'active' : ''}`}
            onClick={() => setTool('pan')}
            title="Pan (H)"
          >
            <Move size={16} />
          </button>
        </div>

        <div className="control-group zoom-controls">
          <button
            className="control-btn"
            onClick={() => setZoom(z => Math.min(z + 0.25, 3))}
            title="Zoom In (+)"
          >
            <ZoomIn size={16} />
          </button>
          <span className="zoom-display">{Math.round(zoom * 100)}%</span>
          <button
            className="control-btn"
            onClick={() => setZoom(z => Math.max(z - 0.25, 0.25))}
            title="Zoom Out (-)"
          >
            <ZoomOut size={16} />
          </button>
        </div>

        <div className="control-group">
          <button
            className="control-btn"
            onClick={fitToView}
            title="Fit to View"
          >
            <Maximize2 size={16} />
          </button>
          <button
            className="control-btn"
            onClick={resetView}
            title="Reset View"
          >
            Reset
          </button>
        </div>

        <div className="dag-legend">
          <span className="legend-item">
            <span className="legend-dot pending"></span>Pending
          </span>
          <span className="legend-item">
            <span className="legend-dot in-progress"></span>Running
          </span>
          <span className="legend-item">
            <span className="legend-dot completed"></span>Done
          </span>
          <span className="legend-item">
            <span className="legend-dot failed"></span>Failed
          </span>
        </div>
      </div>

      {/* Main SVG Canvas */}
      <div
        className={`dag-canvas ${isPanning ? 'panning' : ''} ${tool === 'pan' ? 'pan-tool' : ''}`}
      >
        <svg
          ref={svgRef}
          className="dag-svg"
          viewBox={`0 0 ${viewportWidth} ${viewportHeight}`}
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: 'center center',
          }}
        >
          <defs>
            {/* Arrow markers */}
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

            {/* Glow filters */}
            <filter id="glow-active" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feFlood floodColor="#3b82f6" floodOpacity="0.6" />
              <feComposite in2="blur" operator="in" />
              <feMerge>
                <feMergeNode />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>

            <filter id="glow-selected" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="4" result="blur" />
              <feFlood floodColor="#8b5cf6" floodOpacity="0.7" />
              <feComposite in2="blur" operator="in" />
              <feMerge>
                <feMergeNode />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>

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
          </defs>

          {/* Background grid */}
          <defs>
            <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M 40 0 L 0 0 0 40" fill="none" stroke="rgba(255,255,255,0.03)" strokeWidth="1"/>
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#grid)" />

          {/* Render edges */}
          <g className="dag-edges">
            {edges.map((edge, i) => {
              const fromY = edge.from.y + (edge.from.height || 60) / 2;
              const toY = edge.to.y - (edge.to.height || 60) / 2;
              const midY = (fromY + toY) / 2;
              const status = edge.from.status || 'pending';
              const strokeColor = statusColorValues[status];
              const isHighlighted = selectedNode &&
                (selectedNode.number === edge.from.number || selectedNode.number === edge.to.number);

              const pathD = `M ${edge.from.x} ${fromY} C ${edge.from.x} ${midY}, ${edge.to.x} ${midY}, ${edge.to.x} ${toY}`;

              return (
                <g key={i} className={`dag-edge ${status} ${isHighlighted ? 'highlighted' : ''}`}>
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
            })}
          </g>

          {/* Render nodes */}
          <g className="dag-nodes">
            {nodes.map((node) => {
              const status = node.status || 'pending';
              const isActive = status === 'in_progress';
              const isCurrent = currentStep?.number === node.number;
              const isSelected = selectedNode?.number === node.number;
              const isHovered = hoveredNode?.number === node.number;
              const hasChanged = recentlyChanged?.has(node.number);
              const nodeWidth = node.width || 180;
              const nodeHeight = node.height || 60;

              let filter = '';
              if (isSelected) filter = 'url(#glow-selected)';
              else if (hasChanged) filter = 'url(#glow-changed)';
              else if (isActive) filter = 'url(#glow-active)';

              return (
                <g
                  key={node.number}
                  className={`dag-node ${status} ${isActive ? 'active' : ''} ${isSelected ? 'selected' : ''} ${hasChanged ? 'changed' : ''}`}
                  transform={`translate(${node.x - nodeWidth / 2}, ${node.y - nodeHeight / 2})`}
                  filter={filter}
                  onClick={(e) => handleNodeClick(node, e)}
                  onMouseEnter={() => setHoveredNode(node)}
                  onMouseLeave={() => setHoveredNode(null)}
                  style={{ cursor: tool === 'pointer' ? 'pointer' : 'grab' }}
                >
                  {/* Node shadow */}
                  <rect
                    x="2"
                    y="3"
                    width={nodeWidth}
                    height={nodeHeight}
                    rx="10"
                    fill="rgba(0,0,0,0.3)"
                  />

                  {/* Node background */}
                  <rect
                    width={nodeWidth}
                    height={nodeHeight}
                    rx="10"
                    className={`node-bg ${status}`}
                  />

                  {/* Selected/Current indicator */}
                  {(isSelected || isCurrent) && (
                    <rect
                      x="-3"
                      y="-3"
                      width={nodeWidth + 6}
                      height={nodeHeight + 6}
                      rx="13"
                      fill="none"
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
                  <g transform={`translate(${nodeWidth - 30}, 14)`}>
                    <circle cx="8" cy="8" r="11" fill={statusColorValues[status]} opacity="0.15" />
                    {status === 'completed' && (
                      <path d="M4 8 L7 11 L12 5" stroke={statusColorValues[status]} strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                    )}
                    {status === 'failed' && (
                      <>
                        <line x1="4" y1="4" x2="12" y2="12" stroke={statusColorValues[status]} strokeWidth="2.5" strokeLinecap="round" />
                        <line x1="12" y1="4" x2="4" y2="12" stroke={statusColorValues[status]} strokeWidth="2.5" strokeLinecap="round" />
                      </>
                    )}
                    {status === 'in_progress' && (
                      <circle cx="8" cy="8" r="5" fill={statusColorValues[status]}>
                        <animate attributeName="r" values="4;6;4" dur="1s" repeatCount="indefinite" />
                        <animate attributeName="opacity" values="1;0.5;1" dur="1s" repeatCount="indefinite" />
                      </circle>
                    )}
                    {status === 'pending' && (
                      <circle cx="8" cy="8" r="5" stroke={statusColorValues[status]} strokeWidth="2" fill="none" />
                    )}
                    {status === 'blocked' && (
                      <>
                        <path d="M8 4 L8 9" stroke={statusColorValues[status]} strokeWidth="2.5" strokeLinecap="round" />
                        <circle cx="8" cy="12" r="1.5" fill={statusColorValues[status]} />
                      </>
                    )}
                  </g>

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
                    <rect
                      x="-2"
                      y="-2"
                      width={nodeWidth + 4}
                      height={nodeHeight + 4}
                      rx="12"
                      fill="none"
                      stroke="rgba(255,255,255,0.3)"
                      strokeWidth="1"
                    />
                  )}
                </g>
              );
            })}
          </g>
        </svg>
      </div>

      {/* Minimap */}
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

      {/* Node Details Panel */}
      {selectedNode && (
        <div className="dag-details-panel">
          <div className="details-header">
            <h3>Step {selectedNode.number}</h3>
            <button className="close-btn" onClick={() => setSelectedNode(null)}>
              <X size={16} />
            </button>
          </div>
          <div className="details-content">
            <div className="detail-row">
              <span className="detail-label">Description</span>
              <span className="detail-value">{selectedNode.description}</span>
            </div>
            <div className="detail-row">
              <span className="detail-label">Status</span>
              <span className={`status-badge ${selectedNode.status || 'pending'}`}>
                {selectedNode.status || 'pending'}
              </span>
            </div>
            {selectedNode.complexity && (
              <div className="detail-row">
                <span className="detail-label">Complexity</span>
                <span className="complexity-badge" style={{ color: complexityColors[selectedNode.complexity] }}>
                  {selectedNode.complexity}
                </span>
              </div>
            )}
            {selectedNode.duration && (
              <div className="detail-row">
                <span className="detail-label">Duration</span>
                <span className="detail-value">
                  <Clock size={14} /> {formatDuration(selectedNode.duration)}
                </span>
              </div>
            )}
            {selectedNode.dependencies && selectedNode.dependencies.length > 0 && (
              <div className="detail-row">
                <span className="detail-label">Dependencies</span>
                <div className="dep-list">
                  {selectedNode.dependencies.map((dep) => (
                    <span key={dep} className="dep-chip">Step {dep}</span>
                  ))}
                </div>
              </div>
            )}
            {selectedNode.failReason && (
              <div className="detail-row error">
                <span className="detail-label">
                  <AlertTriangle size={14} /> Failure Reason
                </span>
                <span className="detail-value">{selectedNode.failReason}</span>
              </div>
            )}
            {selectedNode.verification && (
              <div className="detail-row success">
                <span className="detail-label">
                  <CheckCircle2 size={14} /> Verification
                </span>
                <span className="detail-value">{selectedNode.verification}</span>
              </div>
            )}
            {selectedNode.subSteps && selectedNode.subSteps.length > 0 && (
              <div className="detail-row">
                <span className="detail-label">Sub-steps</span>
                <ul className="substep-list">
                  {selectedNode.subSteps.map((sub, i) => (
                    <li key={i} className={sub.status || 'pending'}>
                      <ArrowRight size={12} />
                      <span>{sub.description}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tooltip */}
      {hoveredNode && !selectedNode && (
        <div
          className="dag-tooltip"
          style={{
            left: (hoveredNode.x * zoom + pan.x) + 'px',
            top: (hoveredNode.y * zoom + pan.y - 40) + 'px',
          }}
        >
          <strong>Step {hoveredNode.number}</strong>
          <span>{truncateText(hoveredNode.description, 30)}</span>
        </div>
      )}

      {/* Status Transition Feed - shows recent status changes */}
      {statusTransitions.length > 0 && (
        <div className="dag-transition-feed">
          <div className="feed-header">Recent Updates</div>
          <div className="feed-items">
            {statusTransitions.slice(-5).reverse().map((transition, i) => {
              const node = nodes.find(n => n.number === transition.stepNumber);
              return (
                <div
                  key={`${transition.stepNumber}-${transition.timestamp}-${i}`}
                  className={`feed-item ${transition.to}`}
                >
                  <span className="feed-step">Step {transition.stepNumber}</span>
                  <span className="feed-transition">
                    <span className={`status-dot ${transition.from || 'pending'}`} />
                    <ArrowRight size={12} />
                    <span className={`status-dot ${transition.to}`} />
                  </span>
                  <span className="feed-status">{transition.to}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function truncateText(text, maxLen) {
  if (!text) return '';
  return text.length > maxLen ? text.substring(0, maxLen) + '...' : text;
}

function formatDuration(ms) {
  if (!ms) return '';
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}
