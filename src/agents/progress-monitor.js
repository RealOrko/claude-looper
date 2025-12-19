/**
 * progress-monitor.js - Progress monitoring and escalation handling
 */

/**
 * Escalation levels (duplicated here to avoid circular imports)
 */
const EscalationLevel = {
  NONE: 'none',
  REMIND: 'remind',
  CORRECT: 'correct',
  REFOCUS: 'refocus',
  CRITICAL: 'critical',
  ABORT: 'abort',
};

/**
 * Progress Monitor - Tracks overall progress and detects stalls
 */
export class ProgressMonitor {
  constructor(config = {}) {
    this.checkpoints = [];
    this.stallThreshold = config.stallThreshold || 5 * 60 * 1000; // 5 minutes
    this.progressScores = [];
    this.lastProgressTime = Date.now();
    this.stallCount = 0;
  }

  recordCheckpoint(phase, metrics) {
    const checkpoint = {
      timestamp: Date.now(),
      phase,
      metrics: { ...metrics },
      progressScore: this.calculateProgressScore(metrics),
    };

    this.checkpoints.push(checkpoint);
    this.progressScores.push(checkpoint.progressScore);

    if (checkpoint.progressScore > 0) {
      this.lastProgressTime = Date.now();
      this.stallCount = 0;
    } else {
      this.stallCount++;
    }

    if (this.checkpoints.length > 100) {
      this.checkpoints = this.checkpoints.slice(-100);
    }

    return checkpoint;
  }

  calculateProgressScore(metrics) {
    if (!metrics) return 0;

    let score = 0;

    if (metrics.completedSteps > 0) {
      score += metrics.completedSteps * 10;
    }
    if (metrics.failedSteps > 0) {
      score -= metrics.failedSteps * 5;
    }
    if (metrics.fixCycles > 0) {
      score += metrics.fixCycles * 2;
    }
    if (metrics.verificationsPassed > 0) {
      score += metrics.verificationsPassed * 3;
    }

    return score;
  }

  isStalled() {
    const timeSinceProgress = Date.now() - this.lastProgressTime;
    return timeSinceProgress > this.stallThreshold;
  }

  getStallDuration() {
    return Date.now() - this.lastProgressTime;
  }

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

  reset() {
    this.checkpoints = [];
    this.progressScores = [];
    this.lastProgressTime = Date.now();
    this.stallCount = 0;
  }
}

/**
 * Generate a correction prompt based on escalation level
 */
export function generateCorrection(level, assessment, goal, consecutiveIssues, thresholds) {
  switch (level) {
    case EscalationLevel.REMIND:
      return {
        level,
        prompt: `## Quick Reminder\n\n${assessment.reason}\n\n**Goal:** ${goal}\n\nContinue working.`,
      };

    case EscalationLevel.CORRECT:
      return {
        level,
        prompt: `## Course Correction\n\n${assessment.reason}\n\n**Your goal is:** ${goal}\n\nScore: ${assessment.score}/100\nConsecutive issues: ${consecutiveIssues}/${thresholds.abort}\n\nRefocus and take your next action toward the goal.`,
      };

    case EscalationLevel.REFOCUS:
      return {
        level,
        prompt: `## CRITICAL: REFOCUS REQUIRED\n\nYou have drifted for ${consecutiveIssues} consecutive responses.\n\n**STOP. Your ONLY objective is:** ${goal}\n\n1. Acknowledge this correction\n2. State what you were doing wrong\n3. List 3 steps to get back on track\n4. Execute the FIRST step immediately\n\nWARNING: Continued drift will terminate this session.`,
      };

    case EscalationLevel.CRITICAL:
      return {
        level,
        prompt: `## CRITICAL ESCALATION - FINAL WARNING\n\n⚠️ ONE MORE OFF-TRACK RESPONSE WILL TERMINATE THIS SESSION ⚠️\n\nConsecutive issues: ${consecutiveIssues}/${thresholds.abort}\n\nYou MUST immediately:\n1. STOP all current work\n2. State the EXACT goal: "${goal}"\n3. Take ONE concrete action toward that goal\n\nThis is not a suggestion.`,
      };

    case EscalationLevel.ABORT:
      return {
        level,
        prompt: `## SESSION TERMINATED\n\nUnable to maintain goal focus after ${consecutiveIssues} consecutive issues.\n\nProvide a final summary of:\n1. What was accomplished\n2. What went wrong\n3. Recommendations for retry`,
        shouldAbort: true,
      };

    default:
      return null;
  }
}

/**
 * Determine escalation level based on assessment and consecutive issues
 */
export function determineEscalation(assessment, consecutiveIssues, thresholds) {
  if (consecutiveIssues >= thresholds.abort) {
    return EscalationLevel.ABORT;
  }
  if (consecutiveIssues >= thresholds.critical) {
    return EscalationLevel.CRITICAL;
  }
  if (consecutiveIssues >= thresholds.intervene) {
    return EscalationLevel.REFOCUS;
  }
  if (consecutiveIssues >= thresholds.warn) {
    return EscalationLevel.CORRECT;
  }
  if (assessment.action === 'REMIND') {
    return EscalationLevel.REMIND;
  }

  return EscalationLevel.NONE;
}

export default ProgressMonitor;
