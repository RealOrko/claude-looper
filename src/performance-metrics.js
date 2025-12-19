/**
 * Performance Metrics - Re-exports from refactored modules
 */
export { MetricsCollector } from './metrics-collector.js';
export { AdaptiveOptimizer, TaskType, ExecutionStrategy } from './adaptive-optimizer.js';

// Backwards compatibility aliases
export { MetricsCollector as PerformanceMetrics } from './metrics-collector.js';

export default MetricsCollector;
