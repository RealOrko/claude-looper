/**
 * Goal tracking and progress monitoring
 * Tracks the original goals and measures progress toward completion
 */

// Memory limits
const MAX_HISTORY = 100;
const MAX_MILESTONES = 50;

export class GoalTracker {
  constructor(primaryGoal, subGoals = []) {
    this.primaryGoal = primaryGoal;
    this.subGoals = subGoals.map((goal, index) => ({
      id: index + 1,
      description: goal,
      status: 'pending', // pending, in_progress, completed, blocked
      progress: 0,
      notes: [],
    }));
    this.completedMilestones = [];
    this.currentPhase = 0;
    this.overallProgress = 0;
    this.history = [];
    this.createdAt = Date.now();
  }

  /**
   * Generate the goal context prompt for Claude
   */
  getGoalContextPrompt() {
    const elapsed = this.getElapsedTime();
    const progressSummary = this.getProgressSummary();

    return `
## AUTONOMOUS MODE - GOAL REMINDER

**Primary Goal:** ${this.primaryGoal}

**Current Phase:** ${this.currentPhase + 1} of ${Math.max(this.subGoals.length, 1)}

**Sub-Goals Status:**
${this.subGoals.length > 0
  ? this.subGoals.map(g => `  ${g.id}. [${g.status.toUpperCase()}] ${g.description} (${g.progress}% complete)`).join('\n')
  : '  No sub-goals defined - work toward primary goal'}

**Overall Progress:** ${this.overallProgress}%
**Time Elapsed:** ${elapsed}

**Completed Milestones:**
${this.completedMilestones.length > 0
  ? this.completedMilestones.map(m => `  - ${m}`).join('\n')
  : '  None yet'}

**Instructions:**
1. Focus on the current phase/sub-goal before moving to the next
2. Report progress clearly after each significant action
3. If blocked, explain why and propose alternatives
4. Mark sub-goals as complete when finished
5. Continue working autonomously until all goals are met or time expires
`;
  }

  /**
   * Generate a progress check prompt
   */
  getProgressCheckPrompt() {
    return `
## PROGRESS CHECK

Please provide a brief status update:
1. What have you accomplished since the last check?
2. What is your current focus?
3. Are there any blockers or issues?
4. What is your next planned action?
5. Estimate overall progress percentage (0-100)

After responding, continue working on the task autonomously.
`;
  }

  /**
   * Parse Claude's response for progress indicators
   */
  parseProgressFromResponse(response) {
    const progressIndicators = {
      completed: false,
      progressPercent: null,
      blockers: [],
      nextActions: [],
      subGoalUpdates: [],
    };

    // Look for completion signals
    const completionPhrases = [
      'task complete', 'goal achieved', 'finished', 'done',
      'successfully completed', 'all goals met', 'mission accomplished'
    ];
    const lowerResponse = response.toLowerCase();
    progressIndicators.completed = completionPhrases.some(phrase =>
      lowerResponse.includes(phrase)
    );

    // Look for progress percentage
    const progressMatch = response.match(/(\d{1,3})%\s*(complete|progress|done)/i);
    if (progressMatch) {
      progressIndicators.progressPercent = Math.min(100, parseInt(progressMatch[1], 10));
    }

    // Look for blocker mentions
    const blockerPhrases = ['blocked', 'issue', 'problem', 'error', 'cannot', 'unable'];
    blockerPhrases.forEach(phrase => {
      if (lowerResponse.includes(phrase)) {
        const sentences = response.split(/[.!?]+/);
        sentences.forEach(sentence => {
          if (sentence.toLowerCase().includes(phrase)) {
            progressIndicators.blockers.push(sentence.trim());
          }
        });
      }
    });

    return progressIndicators;
  }

  /**
   * Update progress based on Claude's response
   */
  updateProgress(response, toolResults = []) {
    const indicators = this.parseProgressFromResponse(response);

    // Update overall progress
    if (indicators.progressPercent !== null) {
      this.overallProgress = indicators.progressPercent;
    }

    // Check for tool completions as milestones
    toolResults.forEach(result => {
      if (result.success && result.significantAction) {
        this.completedMilestones.push(result.description);
        // Trim milestones
        if (this.completedMilestones.length > MAX_MILESTONES) {
          this.completedMilestones = this.completedMilestones.slice(-MAX_MILESTONES);
        }
      }
    });

    // Record in history
    this.history.push({
      timestamp: Date.now(),
      overallProgress: this.overallProgress,
      response: response.substring(0, 500),
      indicators,
    });

    // Trim history to prevent unbounded memory growth
    if (this.history.length > MAX_HISTORY) {
      this.history = this.history.slice(-MAX_HISTORY);
    }

    return indicators;
  }

  /**
   * Mark a sub-goal as complete
   */
  completeSubGoal(goalId) {
    const goal = this.subGoals.find(g => g.id === goalId);
    if (goal) {
      goal.status = 'completed';
      goal.progress = 100;
      this.completedMilestones.push(`Sub-goal ${goalId}: ${goal.description}`);
      // Trim milestones
      if (this.completedMilestones.length > MAX_MILESTONES) {
        this.completedMilestones = this.completedMilestones.slice(-MAX_MILESTONES);
      }
      this.recalculateOverallProgress();

      // Move to next phase
      if (this.currentPhase < this.subGoals.length - 1) {
        this.currentPhase++;
        const nextGoal = this.subGoals[this.currentPhase];
        if (nextGoal) {
          nextGoal.status = 'in_progress';
        }
      }
    }
  }

  /**
   * Update a sub-goal's progress
   */
  updateSubGoalProgress(goalId, progress, notes = null) {
    const goal = this.subGoals.find(g => g.id === goalId);
    if (goal) {
      goal.progress = Math.min(100, Math.max(0, progress));
      if (goal.progress > 0 && goal.status === 'pending') {
        goal.status = 'in_progress';
      }
      if (goal.progress >= 100) {
        this.completeSubGoal(goalId);
      }
      if (notes) {
        goal.notes.push({ timestamp: Date.now(), note: notes });
      }
      this.recalculateOverallProgress();
    }
  }

  /**
   * Recalculate overall progress from sub-goals
   */
  recalculateOverallProgress() {
    if (this.subGoals.length === 0) return;
    const totalProgress = this.subGoals.reduce((sum, g) => sum + g.progress, 0);
    this.overallProgress = Math.round(totalProgress / this.subGoals.length);
  }

  /**
   * Check if all goals are complete
   */
  isComplete() {
    if (this.subGoals.length === 0) {
      return this.overallProgress >= 100;
    }
    return this.subGoals.every(g => g.status === 'completed');
  }

  /**
   * Get elapsed time as formatted string
   */
  getElapsedTime() {
    const elapsed = Date.now() - this.createdAt;
    const hours = Math.floor(elapsed / (60 * 60 * 1000));
    const minutes = Math.floor((elapsed % (60 * 60 * 1000)) / (60 * 1000));
    const seconds = Math.floor((elapsed % (60 * 1000)) / 1000);

    if (hours > 0) {
      return `${hours}h ${minutes}m ${seconds}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds}s`;
    }
    return `${seconds}s`;
  }

  /**
   * Get a summary of current progress
   */
  getProgressSummary() {
    return {
      primaryGoal: this.primaryGoal,
      overallProgress: this.overallProgress,
      currentPhase: this.currentPhase + 1,
      totalPhases: Math.max(this.subGoals.length, 1),
      completedSubGoals: this.subGoals.filter(g => g.status === 'completed').length,
      totalSubGoals: this.subGoals.length,
      milestones: this.completedMilestones.length,
      elapsedTime: this.getElapsedTime(),
      isComplete: this.isComplete(),
    };
  }
}
