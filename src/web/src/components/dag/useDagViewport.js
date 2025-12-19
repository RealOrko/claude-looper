/**
 * Custom hook for DAG viewport state management (pan, zoom, tool selection)
 */
import { useState, useCallback, useEffect, useMemo } from 'react';
import { ZOOM_LIMITS, DEFAULT_VIEWPORT } from './constants.js';

export function useDagViewport(containerRef, { width, height }) {
  // Viewport state
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [tool, setTool] = useState('pointer');

  // Calculate viewport dimensions
  const viewportWidth = useMemo(
    () => Math.max(width || DEFAULT_VIEWPORT.width, DEFAULT_VIEWPORT.width),
    [width]
  );
  const viewportHeight = useMemo(
    () => Math.max(height || DEFAULT_VIEWPORT.height, DEFAULT_VIEWPORT.height),
    [height]
  );

  // Handle zoom with mouse wheel
  const handleWheel = useCallback((e) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.1 : 0.1;
      setZoom(z => Math.min(Math.max(z + delta, ZOOM_LIMITS.min), ZOOM_LIMITS.max));
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

  // Reset view
  const resetView = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  // Fit to view
  const fitToView = useCallback(() => {
    if (!containerRef.current) return;
    const containerWidth = containerRef.current.clientWidth;
    const containerHeight = containerRef.current.clientHeight - 50;

    const scaleX = containerWidth / viewportWidth;
    const scaleY = containerHeight / viewportHeight;
    const newZoom = Math.min(scaleX, scaleY, 1) * 0.9;

    setZoom(newZoom);
    setPan({ x: 0, y: 0 });
  }, [containerRef, viewportWidth, viewportHeight]);

  // Zoom in/out functions
  const zoomIn = useCallback(() => {
    setZoom(z => Math.min(z + ZOOM_LIMITS.step, ZOOM_LIMITS.max));
  }, []);

  const zoomOut = useCallback(() => {
    setZoom(z => Math.max(z - ZOOM_LIMITS.step, ZOOM_LIMITS.min));
  }, []);

  // Add wheel event listener
  useEffect(() => {
    const container = containerRef.current;
    if (container) {
      container.addEventListener('wheel', handleWheel, { passive: false });
      return () => container.removeEventListener('wheel', handleWheel);
    }
  }, [containerRef, handleWheel]);

  return {
    zoom,
    pan,
    isPanning,
    tool,
    setTool,
    viewportWidth,
    viewportHeight,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    resetView,
    fitToView,
    zoomIn,
    zoomOut,
  };
}
