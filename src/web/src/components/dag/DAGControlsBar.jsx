/**
 * DAG Controls Bar Component
 * Toolbar with zoom, pan, and view controls
 */
import React from 'react';
import { ZoomIn, ZoomOut, Maximize2, Move, MousePointer } from 'lucide-react';

export default function DAGControlsBar({
  tool,
  setTool,
  zoom,
  zoomIn,
  zoomOut,
  fitToView,
  resetView,
}) {
  return (
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
        <button className="control-btn" onClick={zoomIn} title="Zoom In (+)">
          <ZoomIn size={16} />
        </button>
        <span className="zoom-display">{Math.round(zoom * 100)}%</span>
        <button className="control-btn" onClick={zoomOut} title="Zoom Out (-)">
          <ZoomOut size={16} />
        </button>
      </div>

      <div className="control-group">
        <button className="control-btn" onClick={fitToView} title="Fit to View">
          <Maximize2 size={16} />
        </button>
        <button className="control-btn" onClick={resetView} title="Reset View">
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
  );
}
