/**
 * DAG (Directed Acyclic Graph) Layout Utilities
 *
 * Transforms step data into positioned graph nodes with coordinates,
 * handles dependency edge calculations, and manages layout for different graph sizes.
 */

// Node dimensions and spacing constants
export const LAYOUT_CONFIG = {
  nodeWidth: 180,
  nodeHeight: 60,
  horizontalGap: 60,
  verticalGap: 40,
  padding: 40,
  // For compact mode (many nodes)
  compactNodeWidth: 120,
  compactNodeHeight: 40,
  compactHorizontalGap: 30,
  compactVerticalGap: 25,
};

/**
 * Convert steps array to a graph structure with nodes and edges
 * @param {Array} steps - Array of step objects
 * @returns {Object} Graph with nodes and edges
 */
export function stepsToGraph(steps) {
  if (!steps || steps.length === 0) {
    return { nodes: [], edges: [] };
  }

  const nodes = steps.map(step => ({
    id: step.number || step.id,
    label: step.description,
    status: step.status || 'pending',
    complexity: step.complexity || 'medium',
    dependencies: step.dependencies || [],
    duration: step.duration,
    failReason: step.failReason,
    verification: step.verification,
    subSteps: step.subSteps,
    // Position will be calculated by layout algorithm
    x: 0,
    y: 0,
    layer: 0,
    column: 0,
  }));

  // Build edges from dependencies
  const edges = [];
  const nodeMap = new Map(nodes.map(n => [n.id, n]));

  for (const node of nodes) {
    for (const depId of node.dependencies) {
      if (nodeMap.has(depId)) {
        edges.push({
          id: `${depId}-${node.id}`,
          source: depId,
          target: node.id,
          sourceNode: nodeMap.get(depId),
          targetNode: node,
        });
      }
    }
  }

  return { nodes, edges, nodeMap };
}

/**
 * Calculate the layer (vertical level) for each node using topological sort
 * Nodes with no dependencies are at layer 0, others are placed based on their dependencies
 * @param {Array} nodes - Array of node objects
 * @returns {Map} Map of nodeId to layer number
 */
export function calculateLayers(nodes) {
  const nodeMap = new Map(nodes.map(n => [n.id, n]));
  const layers = new Map();
  const visited = new Set();

  // Calculate layer for a node (max layer of dependencies + 1)
  function getLayer(nodeId) {
    if (layers.has(nodeId)) {
      return layers.get(nodeId);
    }

    if (visited.has(nodeId)) {
      // Cycle detected, return 0 to break
      return 0;
    }
    visited.add(nodeId);

    const node = nodeMap.get(nodeId);
    if (!node || !node.dependencies || node.dependencies.length === 0) {
      layers.set(nodeId, 0);
      return 0;
    }

    let maxDepLayer = -1;
    for (const depId of node.dependencies) {
      if (nodeMap.has(depId)) {
        maxDepLayer = Math.max(maxDepLayer, getLayer(depId));
      }
    }

    const layer = maxDepLayer + 1;
    layers.set(nodeId, layer);
    return layer;
  }

  // Calculate layers for all nodes
  for (const node of nodes) {
    getLayer(node.id);
  }

  return layers;
}

/**
 * Group nodes by their layer
 * @param {Array} nodes - Array of nodes with layer property set
 * @returns {Array} Array of arrays, where each inner array contains nodes at that layer
 */
export function groupByLayer(nodes) {
  const layerGroups = [];

  for (const node of nodes) {
    const layer = node.layer;
    while (layerGroups.length <= layer) {
      layerGroups.push([]);
    }
    layerGroups[layer].push(node);
  }

  return layerGroups;
}

/**
 * Order nodes within each layer to minimize edge crossings
 * Uses a simple barycenter heuristic
 * @param {Array} layerGroups - Array of node arrays grouped by layer
 * @param {Map} nodeMap - Map of nodeId to node
 */
export function orderNodesInLayers(layerGroups, nodeMap) {
  // For each layer after the first, order by average position of dependencies
  for (let i = 1; i < layerGroups.length; i++) {
    const layer = layerGroups[i];
    const prevLayer = layerGroups[i - 1];
    const prevPositions = new Map(prevLayer.map((n, idx) => [n.id, idx]));

    // Calculate barycenter (average x position of dependencies)
    layer.forEach(node => {
      const deps = (node.dependencies || []).filter(d => prevPositions.has(d));
      if (deps.length > 0) {
        node._barycenter = deps.reduce((sum, d) => sum + prevPositions.get(d), 0) / deps.length;
      } else {
        node._barycenter = 0;
      }
    });

    // Sort by barycenter
    layer.sort((a, b) => a._barycenter - b._barycenter);

    // Clean up temporary property
    layer.forEach(node => delete node._barycenter);
  }
}

/**
 * Calculate positions for all nodes in the graph
 * @param {Object} graph - Graph object with nodes and edges
 * @param {Object} options - Layout options
 * @returns {Object} Graph with updated node positions and dimensions
 */
export function calculateLayout(graph, options = {}) {
  const { nodes, edges, nodeMap } = graph;

  if (nodes.length === 0) {
    return { ...graph, width: 0, height: 0 };
  }

  // Determine if we should use compact mode
  const useCompact = options.compact || nodes.length > 15;
  const config = {
    nodeWidth: useCompact ? LAYOUT_CONFIG.compactNodeWidth : LAYOUT_CONFIG.nodeWidth,
    nodeHeight: useCompact ? LAYOUT_CONFIG.compactNodeHeight : LAYOUT_CONFIG.nodeHeight,
    horizontalGap: useCompact ? LAYOUT_CONFIG.compactHorizontalGap : LAYOUT_CONFIG.horizontalGap,
    verticalGap: useCompact ? LAYOUT_CONFIG.compactVerticalGap : LAYOUT_CONFIG.verticalGap,
    padding: LAYOUT_CONFIG.padding,
    ...options,
  };

  // Step 1: Calculate layers
  const layerMap = calculateLayers(nodes);
  nodes.forEach(node => {
    node.layer = layerMap.get(node.id) || 0;
  });

  // Step 2: Group by layer
  const layerGroups = groupByLayer(nodes);

  // Step 3: Order nodes within layers to reduce crossings
  orderNodesInLayers(layerGroups, nodeMap);

  // Step 4: Calculate positions
  const maxNodesInLayer = Math.max(...layerGroups.map(l => l.length));
  const totalWidth = maxNodesInLayer * (config.nodeWidth + config.horizontalGap) - config.horizontalGap + config.padding * 2;

  layerGroups.forEach((layer, layerIndex) => {
    const layerWidth = layer.length * (config.nodeWidth + config.horizontalGap) - config.horizontalGap;
    const startX = (totalWidth - layerWidth) / 2; // Center the layer

    layer.forEach((node, nodeIndex) => {
      node.column = nodeIndex;
      node.x = startX + nodeIndex * (config.nodeWidth + config.horizontalGap);
      node.y = config.padding + layerIndex * (config.nodeHeight + config.verticalGap);
      node.width = config.nodeWidth;
      node.height = config.nodeHeight;
    });
  });

  // Step 5: Update edge positions
  edges.forEach(edge => {
    const sourceNode = nodeMap.get(edge.source);
    const targetNode = nodeMap.get(edge.target);

    if (sourceNode && targetNode) {
      edge.sourceX = sourceNode.x + sourceNode.width / 2;
      edge.sourceY = sourceNode.y + sourceNode.height;
      edge.targetX = targetNode.x + targetNode.width / 2;
      edge.targetY = targetNode.y;
      edge.sourceNode = sourceNode;
      edge.targetNode = targetNode;
    }
  });

  // Calculate total dimensions
  const totalHeight = layerGroups.length * (config.nodeHeight + config.verticalGap) - config.verticalGap + config.padding * 2;

  return {
    ...graph,
    nodes,
    edges,
    layerGroups,
    width: totalWidth,
    height: totalHeight,
    config,
  };
}

/**
 * Generate SVG path for an edge (curved bezier)
 * @param {Object} edge - Edge object with source and target coordinates
 * @returns {string} SVG path d attribute
 */
export function generateEdgePath(edge) {
  const { sourceX, sourceY, targetX, targetY } = edge;

  // Calculate control points for a smooth curve
  const midY = (sourceY + targetY) / 2;
  const controlOffset = Math.min(Math.abs(targetY - sourceY) * 0.5, 50);

  // Use quadratic bezier for smoother curves
  return `M ${sourceX} ${sourceY}
          C ${sourceX} ${sourceY + controlOffset},
            ${targetX} ${targetY - controlOffset},
            ${targetX} ${targetY}`;
}

/**
 * Generate straight line path for an edge
 * @param {Object} edge - Edge object with source and target coordinates
 * @returns {string} SVG path d attribute
 */
export function generateStraightEdgePath(edge) {
  const { sourceX, sourceY, targetX, targetY } = edge;
  return `M ${sourceX} ${sourceY} L ${targetX} ${targetY}`;
}

/**
 * Calculate the critical path (longest path through the DAG)
 * @param {Object} graph - Graph object with nodes and edges
 * @returns {Array} Array of node IDs representing the critical path
 */
export function calculateCriticalPath(graph) {
  const { nodes, nodeMap } = graph;

  if (nodes.length === 0) return [];

  // Find nodes with no dependents (end nodes)
  const hasDependent = new Set();
  nodes.forEach(node => {
    (node.dependencies || []).forEach(depId => hasDependent.add(depId));
  });

  const endNodes = nodes.filter(n => !hasDependent.has(n.id));

  // Calculate longest path to each node
  const longestPath = new Map();
  const pathTo = new Map();

  function getLongestPath(nodeId) {
    if (longestPath.has(nodeId)) {
      return longestPath.get(nodeId);
    }

    const node = nodeMap.get(nodeId);
    if (!node || !node.dependencies || node.dependencies.length === 0) {
      longestPath.set(nodeId, 1);
      pathTo.set(nodeId, [nodeId]);
      return 1;
    }

    let maxLen = 0;
    let maxPath = [];

    for (const depId of node.dependencies) {
      if (nodeMap.has(depId)) {
        const len = getLongestPath(depId);
        if (len > maxLen) {
          maxLen = len;
          maxPath = pathTo.get(depId) || [];
        }
      }
    }

    const len = maxLen + 1;
    longestPath.set(nodeId, len);
    pathTo.set(nodeId, [...maxPath, nodeId]);
    return len;
  }

  // Find the longest path ending at any end node
  let criticalPath = [];
  let maxLength = 0;

  for (const node of endNodes.length > 0 ? endNodes : nodes) {
    const len = getLongestPath(node.id);
    if (len > maxLength) {
      maxLength = len;
      criticalPath = pathTo.get(node.id) || [];
    }
  }

  return criticalPath;
}

/**
 * Get nodes that are ready to execute (all dependencies completed)
 * @param {Object} graph - Graph object
 * @returns {Array} Array of node IDs that are ready
 */
export function getReadyNodes(graph) {
  const { nodes, nodeMap } = graph;

  return nodes.filter(node => {
    if (node.status !== 'pending') return false;

    const deps = node.dependencies || [];
    return deps.every(depId => {
      const depNode = nodeMap.get(depId);
      return depNode && depNode.status === 'completed';
    });
  }).map(n => n.id);
}

/**
 * Get execution statistics for the graph
 * @param {Object} graph - Graph object
 * @returns {Object} Statistics object
 */
export function getGraphStats(graph) {
  const { nodes, edges, layerGroups } = graph;

  const statusCounts = {
    completed: 0,
    failed: 0,
    blocked: 0,
    in_progress: 0,
    pending: 0,
  };

  nodes.forEach(node => {
    const status = node.status || 'pending';
    statusCounts[status] = (statusCounts[status] || 0) + 1;
  });

  const criticalPath = calculateCriticalPath(graph);
  const readyNodes = getReadyNodes(graph);
  const maxParallelism = layerGroups ? Math.max(...layerGroups.map(l => l.length)) : 1;

  return {
    totalNodes: nodes.length,
    totalEdges: edges.length,
    totalLayers: layerGroups ? layerGroups.length : 0,
    maxParallelism,
    criticalPathLength: criticalPath.length,
    criticalPath,
    readyNodes,
    ...statusCounts,
    completionPercentage: nodes.length > 0
      ? Math.round((statusCounts.completed / nodes.length) * 100)
      : 0,
  };
}

/**
 * Apply layout to steps and return positioned data
 * Main entry point for the layout algorithm
 * @param {Array} steps - Array of step objects
 * @param {Object} options - Layout options
 * @returns {Object} Positioned graph with all layout information
 */
export function layoutSteps(steps, options = {}) {
  const graph = stepsToGraph(steps);
  const positionedGraph = calculateLayout(graph, options);
  const stats = getGraphStats(positionedGraph);

  return {
    ...positionedGraph,
    stats,
  };
}

export default {
  stepsToGraph,
  calculateLayers,
  calculateLayout,
  generateEdgePath,
  generateStraightEdgePath,
  calculateCriticalPath,
  getReadyNodes,
  getGraphStats,
  layoutSteps,
  LAYOUT_CONFIG,
};
