/**
 * Phase management for structured task execution
 * Breaks down large tasks into manageable phases with checkpoints
 */

// Memory limits
const MAX_CHECKPOINTS = 100;

export class PhaseManager {
  constructor(timeLimit, config) {
    this.timeLimit = timeLimit;
    this.config = config;
    this.startTime = null;
    this.phases = [];
    this.currentPhaseIndex = 0;
    this.checkpoints = [];
    this.isRunning = false;
    this.isPaused = false;
    this.pauseReason = null;
  }

  /**
   * Initialize phases from goal tracker sub-goals
   */
  initializeFromGoals(goalTracker) {
    if (goalTracker.subGoals.length > 0) {
      this.phases = goalTracker.subGoals.map((goal, index) => ({
        id: index + 1,
        name: goal.description,
        status: index === 0 ? 'active' : 'pending',
        startTime: null,
        endTime: null,
        checkpointCount: 0,
      }));
    } else {
      // Single phase for the primary goal
      this.phases = [{
        id: 1,
        name: goalTracker.primaryGoal,
        status: 'active',
        startTime: null,
        endTime: null,
        checkpointCount: 0,
      }];
    }
    return this.phases;
  }

  /**
   * Start the execution timer
   */
  start() {
    this.startTime = Date.now();
    this.isRunning = true;
    if (this.phases.length > 0) {
      this.phases[0].startTime = this.startTime;
    }
    return this;
  }

  /**
   * Get remaining time in milliseconds
   */
  getRemainingTime() {
    if (!this.startTime) return this.timeLimit;
    return Math.max(0, this.timeLimit - (Date.now() - this.startTime));
  }

  /**
   * Get elapsed time in milliseconds
   */
  getElapsedTime() {
    if (!this.startTime) return 0;
    return Date.now() - this.startTime;
  }

  /**
   * Check if time has expired
   */
  isTimeExpired() {
    return this.getRemainingTime() <= 0;
  }

  /**
   * Format time duration for display
   */
  formatDuration(ms) {
    const hours = Math.floor(ms / (60 * 60 * 1000));
    const minutes = Math.floor((ms % (60 * 60 * 1000)) / (60 * 1000));
    const seconds = Math.floor((ms % (60 * 1000)) / 1000);

    const parts = [];
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    if (seconds > 0 || parts.length === 0) parts.push(`${seconds}s`);

    return parts.join(' ');
  }

  /**
   * Get the current phase
   */
  getCurrentPhase() {
    return this.phases[this.currentPhaseIndex] || null;
  }

  /**
   * Move to the next phase
   */
  advancePhase() {
    const currentPhase = this.getCurrentPhase();
    if (currentPhase) {
      currentPhase.status = 'completed';
      currentPhase.endTime = Date.now();
    }

    this.currentPhaseIndex++;
    const nextPhase = this.getCurrentPhase();
    if (nextPhase) {
      nextPhase.status = 'active';
      nextPhase.startTime = Date.now();
      return nextPhase;
    }
    return null;
  }

  /**
   * Record a checkpoint
   */
  addCheckpoint(description, data = {}) {
    const checkpoint = {
      id: this.checkpoints.length + 1,
      timestamp: Date.now(),
      elapsed: this.getElapsedTime(),
      phaseId: this.currentPhaseIndex + 1,
      description,
      data,
    };
    this.checkpoints.push(checkpoint);

    // Trim checkpoints to prevent unbounded memory growth
    if (this.checkpoints.length > MAX_CHECKPOINTS) {
      this.checkpoints = this.checkpoints.slice(-MAX_CHECKPOINTS);
    }

    const currentPhase = this.getCurrentPhase();
    if (currentPhase) {
      currentPhase.checkpointCount++;
    }

    return checkpoint;
  }

  /**
   * Check if it's time for a progress check
   */
  isTimeForProgressCheck(lastCheckTime) {
    const interval = this.config.get('progressCheckInterval');
    return Date.now() - lastCheckTime >= interval;
  }

  /**
   * Generate time status for prompts
   */
  getTimeStatus() {
    const elapsed = this.getElapsedTime();
    const remaining = this.getRemainingTime();
    const percentComplete = Math.round((elapsed / this.timeLimit) * 100);

    return {
      elapsed: this.formatDuration(elapsed),
      remaining: this.formatDuration(remaining),
      percentTimeUsed: percentComplete,
      isExpired: this.isTimeExpired(),
      isLowTime: remaining < this.timeLimit * 0.1, // Less than 10% remaining
      isHalfway: percentComplete >= 50 && percentComplete < 60,
    };
  }

  /**
   * Generate time-based prompt additions
   */
  getTimePrompt() {
    const status = this.getTimeStatus();

    if (status.isExpired) {
      return `
## TIME EXPIRED

The allocated time (${this.formatDuration(this.timeLimit)}) has expired.

Please:
1. Summarize what was accomplished
2. List any incomplete tasks
3. Provide recommendations for next steps

This is the final response for this session.
`;
    }

    if (status.isLowTime) {
      return `
## LOW TIME WARNING

Only ${status.remaining} remaining out of ${this.formatDuration(this.timeLimit)}.

Please prioritize:
1. Complete the most critical remaining tasks
2. Document any work in progress
3. Prepare a handoff summary if time runs out
`;
    }

    if (status.isHalfway) {
      return `
## HALFWAY POINT

Time Status: ${status.elapsed} elapsed, ${status.remaining} remaining

This is a good time to:
1. Assess progress against goals
2. Reprioritize remaining tasks if needed
3. Ensure most important work is complete
`;
    }

    return '';
  }

  /**
   * Get a full status report
   */
  getStatusReport() {
    const timeStatus = this.getTimeStatus();
    const currentPhase = this.getCurrentPhase();

    return {
      time: timeStatus,
      phases: {
        total: this.phases.length,
        current: this.currentPhaseIndex + 1,
        completed: this.phases.filter(p => p.status === 'completed').length,
        currentPhase: currentPhase ? {
          id: currentPhase.id,
          name: currentPhase.name,
          checkpoints: currentPhase.checkpointCount,
        } : null,
      },
      checkpoints: {
        total: this.checkpoints.length,
        recent: this.checkpoints.slice(-3),
      },
      isRunning: this.isRunning,
      isPaused: this.isPaused,
      pauseReason: this.pauseReason,
    };
  }

  /**
   * Pause execution
   */
  pause(reason = 'User requested') {
    this.isPaused = true;
    this.pauseReason = reason;
    this.addCheckpoint(`Paused: ${reason}`);
  }

  /**
   * Resume execution
   */
  resume() {
    this.isPaused = false;
    this.pauseReason = null;
    this.addCheckpoint('Resumed');
  }

  /**
   * Stop execution
   */
  stop() {
    this.isRunning = false;
    const currentPhase = this.getCurrentPhase();
    if (currentPhase && currentPhase.status === 'active') {
      currentPhase.status = 'interrupted';
      currentPhase.endTime = Date.now();
    }
    this.addCheckpoint('Execution stopped');
  }

  /**
   * Generate phase transition prompt
   */
  generatePhaseTransitionPrompt(completedPhase, nextPhase) {
    if (!nextPhase) {
      return `
## ALL PHASES COMPLETE

Excellent! You have completed all phases:
${this.phases.map(p => `  - Phase ${p.id}: ${p.name} ✓`).join('\n')}

Please provide a final summary of accomplishments and any recommendations.
`;
    }

    return `
## PHASE TRANSITION

**Completed:** Phase ${completedPhase.id} - ${completedPhase.name}
**Starting:** Phase ${nextPhase.id} - ${nextPhase.name}

Time Status: ${this.getTimeStatus().remaining} remaining

Please:
1. Briefly summarize what was done in the completed phase
2. Begin work on the new phase
3. Identify the first concrete action to take
`;
  }
}
