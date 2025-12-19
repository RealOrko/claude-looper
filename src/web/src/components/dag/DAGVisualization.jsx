/**
 * Interactive DAG Visualization Component
 * Features: Pan, Zoom, Node selection, Minimap, Tooltips, Real-time updates
 */
import React, { useRef } from 'react';
import { Info } from 'lucide-react';
import DAGControlsBar from './DAGControlsBar.jsx';
import DAGSvgDefs from './DAGSvgDefs.jsx';
import DAGEdge from './DAGEdge.jsx';
import DAGNode from './DAGNode.jsx';
import DAGDetailsPanel from './DAGDetailsPanel.jsx';
import DAGMinimap from './DAGMinimap.jsx';
import DAGTooltip from './DAGTooltip.jsx';
import DAGStatusFeed from './DAGStatusFeed.jsx';
import { useDagViewport } from './useDagViewport.js';
import { useDagSelection } from './useDagSelection.js';

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
  const containerRef = useRef(null);
  const svgRef = useRef(null);

  const {
    zoom, pan, isPanning, tool, setTool,
    viewportWidth, viewportHeight,
    handleMouseDown, handleMouseMove, handleMouseUp,
    resetView, fitToView, zoomIn, zoomOut,
  } = useDagViewport(containerRef, { width, height });

  const {
    selectedNode, hoveredNode,
    handleNodeClick, handleNodeHover, handleNodeLeave, clearSelection,
  } = useDagSelection(tool, onNodeClick);

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
      <DAGControlsBar
        tool={tool}
        setTool={setTool}
        zoom={zoom}
        zoomIn={zoomIn}
        zoomOut={zoomOut}
        fitToView={fitToView}
        resetView={resetView}
      />

      <div className={`dag-canvas ${isPanning ? 'panning' : ''} ${tool === 'pan' ? 'pan-tool' : ''}`}>
        <svg
          ref={svgRef}
          className="dag-svg"
          viewBox={`0 0 ${viewportWidth} ${viewportHeight}`}
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: 'center center',
          }}
        >
          <DAGSvgDefs />
          <rect width="100%" height="100%" fill="url(#grid)" />

          <g className="dag-edges">
            {edges.map((edge, i) => (
              <DAGEdge key={i} edge={edge} selectedNode={selectedNode} />
            ))}
          </g>

          <g className="dag-nodes">
            {nodes.map((node) => (
              <DAGNode
                key={node.number}
                node={node}
                currentStep={currentStep}
                selectedNode={selectedNode}
                hoveredNode={hoveredNode}
                recentlyChanged={recentlyChanged}
                tool={tool}
                onNodeClick={handleNodeClick}
                onMouseEnter={handleNodeHover}
                onMouseLeave={handleNodeLeave}
              />
            ))}
          </g>
        </svg>
      </div>

      <DAGMinimap
        nodes={nodes}
        pan={pan}
        zoom={zoom}
        viewportWidth={viewportWidth}
        viewportHeight={viewportHeight}
      />

      <DAGDetailsPanel node={selectedNode} onClose={clearSelection} />

      {hoveredNode && !selectedNode && (
        <DAGTooltip node={hoveredNode} zoom={zoom} pan={pan} />
      )}

      <DAGStatusFeed transitions={statusTransitions} />
    </div>
  );
}
