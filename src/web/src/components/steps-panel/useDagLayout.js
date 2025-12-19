/**
 * Custom hook for DAG layout calculation
 */
import { useMemo } from 'react';
import { DAG_LAYOUT } from './constants.js';

export function useDagLayout(steps) {
  return useMemo(() => {
    if (steps.length === 0) return { nodes: [], edges: [], width: 0, height: 0 };

    const { NODE_WIDTH, NODE_HEIGHT, LEVEL_GAP, NODE_GAP } = DAG_LAYOUT;

    // Build dependency graph
    const nodeMap = new Map();
    steps.forEach((step, index) => {
      nodeMap.set(step.number || index + 1, {
        ...step,
        number: step.number || index + 1,
        dependents: [],
        level: 0,
      });
    });

    // Calculate levels based on dependencies
    steps.forEach(step => {
      const deps = step.dependencies || [];
      deps.forEach(depNum => {
        const parent = nodeMap.get(depNum);
        if (parent) {
          parent.dependents.push(step.number || steps.indexOf(step) + 1);
        }
      });
    });

    // Calculate levels using BFS
    const levels = calculateLevels(nodeMap);
    const maxLevel = Math.max(...levels.values(), 0);

    // Group nodes by level
    const levelGroups = new Map();
    levels.forEach((level, num) => {
      if (!levelGroups.has(level)) {
        levelGroups.set(level, []);
      }
      levelGroups.get(level).push(num);
    });

    // Calculate node positions
    const maxNodesInLevel = Math.max(...[...levelGroups.values()].map(g => g.length), 1);
    const totalWidth = Math.max(maxNodesInLevel * (NODE_WIDTH + NODE_GAP), 400);
    const totalHeight = (maxLevel + 1) * (NODE_HEIGHT + LEVEL_GAP) + 100;

    const nodes = [];
    levelGroups.forEach((nodeNums, level) => {
      const levelWidth = nodeNums.length * (NODE_WIDTH + NODE_GAP) - NODE_GAP;
      const startX = (totalWidth - levelWidth) / 2;

      nodeNums.forEach((num, i) => {
        const step = nodeMap.get(num);
        nodes.push({
          ...step,
          x: startX + i * (NODE_WIDTH + NODE_GAP) + NODE_WIDTH / 2,
          y: level * (NODE_HEIGHT + LEVEL_GAP) + NODE_HEIGHT / 2 + 40,
          width: NODE_WIDTH,
          height: NODE_HEIGHT,
        });
      });
    });

    // Calculate edges
    const edges = [];
    nodes.forEach(node => {
      const deps = node.dependencies || [];
      deps.forEach(depNum => {
        const parent = nodes.find(n => n.number === depNum);
        if (parent) {
          edges.push({ from: parent, to: node, status: parent.status });
        }
      });
    });

    return { nodes, edges, width: totalWidth, height: totalHeight };
  }, [steps]);
}

function calculateLevels(nodeMap) {
  const levels = new Map();
  const visited = new Set();

  // Find root nodes (no dependencies)
  const roots = [];
  nodeMap.forEach((node, num) => {
    const deps = node.dependencies || [];
    const hasDeps = deps.some(d => nodeMap.has(d));
    if (!hasDeps) {
      roots.push(num);
      levels.set(num, 0);
    }
  });

  // BFS to calculate levels
  const queue = [...roots];
  while (queue.length > 0) {
    const current = queue.shift();
    if (visited.has(current)) continue;
    visited.add(current);

    const node = nodeMap.get(current);
    const currentLevel = levels.get(current) || 0;

    node.dependents.forEach(depNum => {
      const existingLevel = levels.get(depNum) || 0;
      levels.set(depNum, Math.max(existingLevel, currentLevel + 1));
      if (!visited.has(depNum)) {
        queue.push(depNum);
      }
    });
  }

  // Handle nodes without dependencies that weren't processed
  nodeMap.forEach((node, num) => {
    if (!levels.has(num)) {
      levels.set(num, 0);
    }
  });

  return levels;
}
