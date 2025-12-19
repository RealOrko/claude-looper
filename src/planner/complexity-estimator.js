/**
 * Complexity Estimator - Estimates step complexity based on patterns and history
 */

// Complexity patterns for smarter initial estimation
const COMPLEXITY_PATTERNS = {
  simple: [
    /^read|^check|^verify|^list|^show|^display|^log|^print/i,
    /add.*comment|add.*log|update.*version|rename/i,
    /simple.*change|minor.*update|quick.*fix/i,
  ],
  complex: [
    /refactor|redesign|rewrite|overhaul|migrate/i,
    /implement.*from.*scratch|build.*new|create.*system/i,
    /integrate.*with|connect.*to.*external/i,
    /optimize.*performance|improve.*algorithm/i,
    /test.*coverage|comprehensive.*test/i,
    /multiple.*files|across.*codebase/i,
    /security|authentication|authorization/i,
    /database.*schema|data.*migration/i,
  ],
};

export class ComplexityEstimator {
  constructor() {
    this.complexityHistory = [];
  }

  /** Estimate step complexity based on description patterns */
  estimateComplexity(description) {
    const desc = description.toLowerCase();

    for (const pattern of COMPLEXITY_PATTERNS.complex) {
      if (pattern.test(desc)) return 'complex';
    }

    for (const pattern of COMPLEXITY_PATTERNS.simple) {
      if (pattern.test(desc)) return 'simple';
    }

    return 'medium';
  }

  /** Refine complexity based on historical data */
  refineComplexity(estimatedComplexity, description) {
    if (this.complexityHistory.length < 5) {
      return estimatedComplexity;
    }

    const words = new Set(description.toLowerCase().split(/\s+/).filter(w => w.length > 4));
    const similar = this.complexityHistory.filter(entry => {
      const entryWords = new Set(entry.description.toLowerCase().split(/\s+/).filter(w => w.length > 4));
      const overlap = [...words].filter(w => entryWords.has(w)).length;
      return overlap >= 2;
    });

    if (similar.length === 0) return estimatedComplexity;

    const avgDuration = similar.reduce((sum, e) => sum + e.duration, 0) / similar.length;

    if (avgDuration > 10 * 60 * 1000) return 'complex';
    if (avgDuration < 2 * 60 * 1000) return 'simple';
    return 'medium';
  }

  /** Record completed step for learning */
  recordStepCompletion(step, duration) {
    this.complexityHistory.push({
      description: step.description,
      estimatedComplexity: step.complexity,
      duration,
      timestamp: Date.now(),
    });

    if (this.complexityHistory.length > 50) {
      this.complexityHistory = this.complexityHistory.slice(-50);
    }
  }

  /** Check if a step should be decomposed based on complexity and time */
  shouldDecomposeStep(step, elapsedMs = 0) {
    if (step.complexity === 'complex' && step.status === 'pending') {
      return true;
    }

    const thresholds = { simple: 5 * 60 * 1000, medium: 10 * 60 * 1000, complex: 15 * 60 * 1000 };
    const threshold = thresholds[step.complexity] || thresholds.medium;

    if (elapsedMs > threshold && step.status === 'in_progress') {
      return true;
    }

    return false;
  }

  /** Get complexity thresholds */
  getThresholds() {
    return { simple: 5 * 60 * 1000, medium: 10 * 60 * 1000, complex: 15 * 60 * 1000 };
  }
}

export default ComplexityEstimator;
