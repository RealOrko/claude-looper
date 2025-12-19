/**
 * Progress Monitor Module
 *
 * Tracks overall progress during task execution and detects stalls.
 * Records checkpoints, calculates progress scores, and provides trend analysis.
 */

// Default configuration
const DEFAULT_STALL_THRESHOLD = 5 * 60 * 1000; // 5 minutes
const MAX_CHECKPOINTS = 100;

/**
 * Progress Monitor - Tracks overall progress and detects stalls
 */
export class ProgressMonitor {
  constructor(config = {}) {
    this.checkpoints = [];
    this.stallThreshold = config.stallThreshold || DEFAULT_STALL_THRESHOLD;
    this.progressScores = [];
    this.lastProgressTime = Date.now();
    this.stallCount = 0;
  }

  /**
   * Record a progress checkpoint
   * @param {string} phase - The current workflow phase
   * @param {Object} metrics - Metrics for the checkpoint
   * @returns {Object} The recorded checkpoint
   */
  recordCheckpoint(phase, metrics) {
    const checkpoint = {
      timestamp: Date.now(),
      phase,
      metrics: { ...metrics },
      progressScore: this.calculateProgressScore(metrics),
    };

    this.checkpoints.push(checkpoint);
    this.progressScores.push(checkpoint.progressScore);

    // Detect progress
    if (checkpoint.progressScore > 0) {
      this.lastProgressTime = Date.now();
      this.stallCount = 0;
    } else {
      this.stallCount++;
    }

    // Keep bounded
    if (this.checkpoints.length > MAX_CHECKPOINTS) {
      this.checkpoints = this.checkpoints.slice(-MAX_CHECKPOINTS);
    }

    return checkpoint;
  }

  /**
   * Calculate a progress score from metrics
   * @param {Object} metrics - The metrics to calculate score from
   * @returns {number} The progress score
   */
  calculateProgressScore(metrics) {
    if (!metrics) return 0;

    let score = 0;

    // Completed steps = positive progress
    if (metrics.completedSteps > 0) {
      score += metrics.completedSteps * 10;
    }

    // Failed steps = negative progress
    if (metrics.failedSteps > 0) {
      score -= metrics.failedSteps * 5;
    }

    // Fix cycles = partial progress (fixing is progress)
    if (metrics.fixCycles > 0) {
      score += metrics.fixCycles * 2;
    }

    // Verifications passed = progress
    if (metrics.verificationsPassed > 0) {
      score += metrics.verificationsPassed * 3;
    }

    return score;
  }

  /**
   * Check if we're in a stall condition
   * @returns {boolean} Whether execution is stalled
   */
  isStalled() {
    const timeSinceProgress = Date.now() - this.lastProgressTime;
    return timeSinceProgress > this.stallThreshold;
  }

  /**
   * Get stall duration in milliseconds
   * @returns {number} Duration since last progress
   */
  getStallDuration() {
    return Date.now() - this.lastProgressTime;
  }

  /**
   * Get progress trend (improving, stable, declining)
   * @returns {string} The trend direction
   */
  getProgressTrend() {
    if (this.progressScores.length < 3) return 'unknown';

    const recent = this.progressScores.slice(-5);
    const older = this.progressScores.slice(-10, -5);

    if (older.length === 0) return 'unknown';

    const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
    const olderAvg = older.reduce((a, b) => a + b, 0) / older.length;

    if (recentAvg > olderAvg + 2) return 'improving';
    if (recentAvg < olderAvg - 2) return 'declining';
    return 'stable';
  }

  /**
   * Get progress summary
   * @returns {Object} Summary of progress state
   */
  getSummary() {
    const recentCheckpoints = this.checkpoints.slice(-5);

    return {
      checkpointCount: this.checkpoints.length,
      isStalled: this.isStalled(),
      stallDuration: this.getStallDuration(),
      stallCount: this.stallCount,
      trend: this.getProgressTrend(),
      recentPhases: recentCheckpoints.map(c => c.phase),
      averageProgressScore: this.progressScores.length > 0
        ? Math.round(this.progressScores.reduce((a, b) => a + b, 0) / this.progressScores.length)
        : 0,
    };
  }

  /**
   * Reset the monitor for a new task
   */
  reset() {
    this.checkpoints = [];
    this.progressScores = [];
    this.lastProgressTime = Date.now();
    this.stallCount = 0;
  }

  /**
   * Get the most recent checkpoint
   * @returns {Object|null} The most recent checkpoint or null
   */
  getLastCheckpoint() {
    return this.checkpoints.length > 0
      ? this.checkpoints[this.checkpoints.length - 1]
      : null;
  }

  /**
   * Get checkpoints for a specific phase
   * @param {string} phase - The phase to filter by
   * @returns {Object[]} Checkpoints for the phase
   */
  getCheckpointsForPhase(phase) {
    return this.checkpoints.filter(c => c.phase === phase);
  }

  /**
   * Get the total time elapsed since first checkpoint
   * @returns {number} Elapsed time in milliseconds
   */
  getTotalElapsedTime() {
    if (this.checkpoints.length === 0) return 0;
    return Date.now() - this.checkpoints[0].timestamp;
  }
}

export default ProgressMonitor;
