import { describe, it, expect } from 'vitest';
import {
  stepsToGraph,
  calculateLayers,
  calculateLayout,
  generateEdgePath,
  calculateCriticalPath,
  getReadyNodes,
  getGraphStats,
  layoutSteps,
  LAYOUT_CONFIG,
} from './dagLayout.js';

describe('DAG Layout Utilities', () => {
  // Sample step data for testing
  const sampleSteps = [
    { number: 1, description: 'Setup project', status: 'completed', dependencies: [] },
    { number: 2, description: 'Create database schema', status: 'completed', dependencies: [1] },
    { number: 3, description: 'Build API endpoints', status: 'in_progress', dependencies: [1] },
    { number: 4, description: 'Create frontend', status: 'pending', dependencies: [2, 3] },
    { number: 5, description: 'Add authentication', status: 'pending', dependencies: [3] },
    { number: 6, description: 'Integration tests', status: 'pending', dependencies: [4, 5] },
  ];

  describe('stepsToGraph', () => {
    it('should convert steps to graph structure', () => {
      const graph = stepsToGraph(sampleSteps);

      expect(graph.nodes).toHaveLength(6);
      expect(graph.edges).toHaveLength(7); // 1 dep for steps 2,3; 2 deps for 4; 1 dep for 5; 2 deps for 6
      expect(graph.nodeMap.size).toBe(6);
    });

    it('should handle empty steps array', () => {
      const graph = stepsToGraph([]);
      expect(graph.nodes).toHaveLength(0);
      expect(graph.edges).toHaveLength(0);
    });

    it('should handle null/undefined steps', () => {
      expect(stepsToGraph(null)).toEqual({ nodes: [], edges: [] });
      expect(stepsToGraph(undefined)).toEqual({ nodes: [], edges: [] });
    });

    it('should create correct edges from dependencies', () => {
      const graph = stepsToGraph(sampleSteps);

      // Step 4 depends on 2 and 3
      const edgesToStep4 = graph.edges.filter(e => e.target === 4);
      expect(edgesToStep4).toHaveLength(2);
      expect(edgesToStep4.map(e => e.source).sort()).toEqual([2, 3]);
    });
  });

  describe('calculateLayers', () => {
    it('should assign layers based on dependencies', () => {
      const graph = stepsToGraph(sampleSteps);
      const layers = calculateLayers(graph.nodes);

      expect(layers.get(1)).toBe(0); // No dependencies
      expect(layers.get(2)).toBe(1); // Depends on 1
      expect(layers.get(3)).toBe(1); // Depends on 1
      expect(layers.get(4)).toBe(2); // Depends on 2,3 (max is 1, so layer 2)
      expect(layers.get(5)).toBe(2); // Depends on 3
      expect(layers.get(6)).toBe(3); // Depends on 4,5 (max is 2, so layer 3)
    });

    it('should handle nodes with no dependencies', () => {
      const steps = [
        { number: 1, description: 'A', dependencies: [] },
        { number: 2, description: 'B', dependencies: [] },
      ];
      const graph = stepsToGraph(steps);
      const layers = calculateLayers(graph.nodes);

      expect(layers.get(1)).toBe(0);
      expect(layers.get(2)).toBe(0);
    });
  });

  describe('calculateLayout', () => {
    it('should assign positions to all nodes', () => {
      const graph = stepsToGraph(sampleSteps);
      const layout = calculateLayout(graph);

      layout.nodes.forEach(node => {
        expect(typeof node.x).toBe('number');
        expect(typeof node.y).toBe('number');
        expect(node.x).toBeGreaterThanOrEqual(0);
        expect(node.y).toBeGreaterThanOrEqual(0);
      });
    });

    it('should calculate total dimensions', () => {
      const graph = stepsToGraph(sampleSteps);
      const layout = calculateLayout(graph);

      expect(layout.width).toBeGreaterThan(0);
      expect(layout.height).toBeGreaterThan(0);
    });

    it('should position edges correctly', () => {
      const graph = stepsToGraph(sampleSteps);
      const layout = calculateLayout(graph);

      layout.edges.forEach(edge => {
        expect(typeof edge.sourceX).toBe('number');
        expect(typeof edge.sourceY).toBe('number');
        expect(typeof edge.targetX).toBe('number');
        expect(typeof edge.targetY).toBe('number');
      });
    });

    it('should use compact mode for many nodes', () => {
      const manySteps = Array.from({ length: 20 }, (_, i) => ({
        number: i + 1,
        description: `Step ${i + 1}`,
        dependencies: i > 0 ? [i] : [],
      }));

      const graph = stepsToGraph(manySteps);
      const layout = calculateLayout(graph);

      expect(layout.config.nodeWidth).toBe(LAYOUT_CONFIG.compactNodeWidth);
    });
  });

  describe('generateEdgePath', () => {
    it('should generate a valid SVG path', () => {
      const edge = {
        sourceX: 100,
        sourceY: 50,
        targetX: 100,
        targetY: 150,
      };

      const path = generateEdgePath(edge);

      expect(path).toContain('M 100 50');
      expect(path).toContain('100 150');
    });
  });

  describe('calculateCriticalPath', () => {
    it('should find the longest path through the DAG', () => {
      const graph = stepsToGraph(sampleSteps);
      const layout = calculateLayout(graph);
      const criticalPath = calculateCriticalPath(layout);

      // The longest path should be: 1 -> 3 -> 4 -> 6 or 1 -> 3 -> 5 -> 6 (length 4)
      // or 1 -> 2 -> 4 -> 6 (length 4)
      expect(criticalPath.length).toBe(4);
      expect(criticalPath[0]).toBe(1);
      expect(criticalPath[criticalPath.length - 1]).toBe(6);
    });

    it('should handle single node graph', () => {
      const steps = [{ number: 1, description: 'Only step', dependencies: [] }];
      const graph = stepsToGraph(steps);
      const layout = calculateLayout(graph);
      const criticalPath = calculateCriticalPath(layout);

      expect(criticalPath).toEqual([1]);
    });
  });

  describe('getReadyNodes', () => {
    it('should find nodes ready for execution', () => {
      const graph = stepsToGraph(sampleSteps);
      const layout = calculateLayout(graph);
      const readyNodes = getReadyNodes(layout);

      // Steps 4 should be ready (deps 2,3: 2 is completed, 3 is in_progress - so NOT ready)
      // Step 5 should NOT be ready (dep 3 is in_progress)
      // No pending steps are ready because step 3 is still in_progress
      expect(readyNodes).toEqual([]);
    });

    it('should identify pending nodes with all completed dependencies', () => {
      const steps = [
        { number: 1, description: 'A', status: 'completed', dependencies: [] },
        { number: 2, description: 'B', status: 'completed', dependencies: [] },
        { number: 3, description: 'C', status: 'pending', dependencies: [1, 2] },
      ];
      const graph = stepsToGraph(steps);
      const layout = calculateLayout(graph);
      const readyNodes = getReadyNodes(layout);

      expect(readyNodes).toEqual([3]);
    });
  });

  describe('getGraphStats', () => {
    it('should calculate correct statistics', () => {
      const graph = stepsToGraph(sampleSteps);
      const layout = calculateLayout(graph);
      const stats = getGraphStats(layout);

      expect(stats.totalNodes).toBe(6);
      expect(stats.totalEdges).toBe(7);
      expect(stats.completed).toBe(2);
      expect(stats.in_progress).toBe(1);
      expect(stats.pending).toBe(3);
      expect(stats.completionPercentage).toBe(33); // 2/6 = 33%
    });

    it('should calculate max parallelism', () => {
      const graph = stepsToGraph(sampleSteps);
      const layout = calculateLayout(graph);
      const stats = getGraphStats(layout);

      // Layer 1 has steps 2 and 3, layer 2 has steps 4 and 5
      expect(stats.maxParallelism).toBe(2);
    });
  });

  describe('layoutSteps', () => {
    it('should be the main entry point combining all operations', () => {
      const result = layoutSteps(sampleSteps);

      expect(result.nodes).toBeDefined();
      expect(result.edges).toBeDefined();
      expect(result.layerGroups).toBeDefined();
      expect(result.width).toBeGreaterThan(0);
      expect(result.height).toBeGreaterThan(0);
      expect(result.stats).toBeDefined();
      expect(result.stats.totalNodes).toBe(6);
    });

    it('should handle options', () => {
      const result = layoutSteps(sampleSteps, { compact: true });

      expect(result.config.nodeWidth).toBe(LAYOUT_CONFIG.compactNodeWidth);
    });
  });

  describe('complex graph scenarios', () => {
    it('should handle diamond dependency pattern', () => {
      const diamondSteps = [
        { number: 1, description: 'Start', dependencies: [] },
        { number: 2, description: 'Path A', dependencies: [1] },
        { number: 3, description: 'Path B', dependencies: [1] },
        { number: 4, description: 'End', dependencies: [2, 3] },
      ];

      const result = layoutSteps(diamondSteps);

      expect(result.layerGroups).toHaveLength(3);
      expect(result.layerGroups[0]).toHaveLength(1); // Start
      expect(result.layerGroups[1]).toHaveLength(2); // Path A, Path B
      expect(result.layerGroups[2]).toHaveLength(1); // End
    });

    it('should handle linear chain', () => {
      const linearSteps = [
        { number: 1, description: 'Step 1', dependencies: [] },
        { number: 2, description: 'Step 2', dependencies: [1] },
        { number: 3, description: 'Step 3', dependencies: [2] },
        { number: 4, description: 'Step 4', dependencies: [3] },
      ];

      const result = layoutSteps(linearSteps);

      expect(result.layerGroups).toHaveLength(4);
      result.layerGroups.forEach(layer => {
        expect(layer).toHaveLength(1);
      });
    });

    it('should handle parallel independent steps', () => {
      const parallelSteps = [
        { number: 1, description: 'Task A', dependencies: [] },
        { number: 2, description: 'Task B', dependencies: [] },
        { number: 3, description: 'Task C', dependencies: [] },
        { number: 4, description: 'Task D', dependencies: [] },
      ];

      const result = layoutSteps(parallelSteps);

      expect(result.layerGroups).toHaveLength(1);
      expect(result.layerGroups[0]).toHaveLength(4);
      expect(result.stats.maxParallelism).toBe(4);
    });
  });
});
