/**
 * Custom hook for DAG node selection and hover state
 */
import { useState, useCallback, useEffect } from 'react';

export function useDagSelection(tool, onNodeClick) {
  const [selectedNode, setSelectedNode] = useState(null);
  const [hoveredNode, setHoveredNode] = useState(null);

  // Node click handler
  const handleNodeClick = useCallback((node, e) => {
    e.stopPropagation();
    if (tool === 'pointer') {
      setSelectedNode(prev => prev?.number === node.number ? null : node);
      onNodeClick?.(node);
    }
  }, [tool, onNodeClick]);

  // Clear selection
  const clearSelection = useCallback(() => {
    setSelectedNode(null);
  }, []);

  // Handle node hover
  const handleNodeHover = useCallback((node) => {
    setHoveredNode(node);
  }, []);

  const handleNodeLeave = useCallback(() => {
    setHoveredNode(null);
  }, []);

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

  return {
    selectedNode,
    hoveredNode,
    handleNodeClick,
    handleNodeHover,
    handleNodeLeave,
    clearSelection,
  };
}
