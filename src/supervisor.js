/**
 * Supervisor - LLM-based assessment of worker Claude's progress
 * Uses a separate Claude session to evaluate if work is on-track
 * Implements escalation system for drift recovery
 */

// Memory limits
const MAX_ASSESSMENT_HISTORY = 50;

export class Supervisor {
  constructor(client, goalTracker, config = null) {
    this.client = client;
    this.goalTracker = goalTracker;
    this.config = config;
    this.assessmentHistory = [];
    this.consecutiveIssues = 0;
    this.lastRelevantAction = Date.now();
    this.previousAction = null;
    this.totalCorrections = 0;
  }

  /**
   * Get escalation thresholds from config or use defaults
   */
  getThresholds() {
    if (this.config) {
      return this.config.get('escalationThresholds') || {
        warn: 2,
        intervene: 3,
        critical: 4,
        abort: 5,
      };
    }
    return { warn: 2, intervene: 3, critical: 4, abort: 5 };
  }

  /**
   * Get stagnation threshold from config or use default
   */
  getStagnationThreshold() {
    if (this.config) {
      return this.config.get('stagnationThreshold') || 15 * 60 * 1000;
    }
    return 15 * 60 * 1000; // 15 minutes default
  }

  /**
   * Build supervisor memory section for assessment prompt
   */
  buildSupervisionHistory() {
    const recent = this.assessmentHistory.slice(-3);
    if (recent.length === 0) {
      return 'No previous assessments.';
    }

    const history = recent.map((entry, i) => {
      const a = entry.assessment;
      return `  ${i + 1}. [${a.action}] Score: ${a.score}/100 - ${a.reason || 'No reason given'}`;
    }).join('\n');

    const thresholds = this.getThresholds();
    let warning = '';
    if (this.consecutiveIssues >= thresholds.critical) {
      warning = '\n⚠️ CRITICAL: Next issue will trigger session termination!';
    } else if (this.consecutiveIssues >= thresholds.intervene) {
      warning = '\n⚠️ WARNING: Pattern of drift detected - escalation imminent';
    } else if (this.consecutiveIssues >= thresholds.warn) {
      warning = '\n⚠️ ALERT: Multiple consecutive issues detected';
    }

    return `${history}\nConsecutive issues: ${this.consecutiveIssues}/${thresholds.abort}${warning}`;
  }

  /**
   * Build the supervisor assessment prompt
   */
  buildAssessmentPrompt(response, recentActions) {
    const thresholds = this.getThresholds();

    return `You are a SUPERVISOR evaluating an AI assistant working autonomously.

## ASSIGNED GOAL
${this.goalTracker.primaryGoal}

${this.goalTracker.subGoals.length > 0 ? `## SUB-GOALS
${this.goalTracker.subGoals.map((g, i) => `${i + 1}. [${g.status}] ${g.description}`).join('\n')}

## CURRENT PHASE
Working on: ${this.getCurrentPhase()}` : ''}

## SUPERVISION HISTORY
${this.buildSupervisionHistory()}

## ASSISTANT'S LATEST RESPONSE
${response.substring(0, 3000)}

## RECENT ACTIONS
${recentActions.length > 0 ? recentActions.map(a => `- ${a}`).join('\n') : 'None recorded yet'}

## YOUR TASK

Evaluate whether the assistant is making progress toward the goal.

Consider:
- Is this work directly relevant to the goal, OR a necessary prerequisite?
- Is the assistant taking concrete actions (not just planning endlessly)?
- Is there forward momentum?
- Has the assistant gone off on a tangent?
- Did the assistant follow any previous correction given?

## SCORING GUIDE

SCORE: [0-100] where:
  - 90-100: Directly advancing the goal with concrete actions
  - 70-89: Related work, acceptable progress
  - 50-69: Tangential, needs gentle redirection
  - 30-49: Off-track, needs clear correction
  - 0-29: Completely lost, requires hard intervention

ACTION: Choose based on score AND history:
  - CONTINUE (score 70+): On track, no intervention needed
  - REMIND (score 50-69): Gentle nudge to refocus
  - CORRECT (score 30-49 OR ${thresholds.warn}+ consecutive issues): Clear redirection required
  - REFOCUS (score <30 OR ${thresholds.intervene}+ consecutive issues): Hard intervention needed

Respond in EXACTLY this format:

RELEVANT: [YES/NO] - [one sentence why]
PRODUCTIVE: [YES/NO] - [one sentence why]
PROGRESSING: [YES/NO] - [one sentence why]
SCORE: [0-100]
ACTION: [CONTINUE/REMIND/CORRECT/REFOCUS]
REASON: [one sentence summary]`;
  }

  /**
   * Get current phase description
   */
  getCurrentPhase() {
    const current = this.goalTracker.subGoals[this.goalTracker.currentPhase];
    return current ? current.description : this.goalTracker.primaryGoal;
  }

  /**
   * Assess the worker's response
   */
  async assess(response, recentActions = []) {
    const prompt = this.buildAssessmentPrompt(response, recentActions);

    try {
      // Use separate session for supervisor (doesn't pollute worker conversation)
      const result = await this.client.sendPrompt(prompt, {
        newSession: true,
        timeout: 5 * 60 * 1000, // 5 min timeout for assessment
        model: 'sonnet', // Use Sonnet for supervision
      });

      const assessment = this.parseAssessment(result.response);

      // Track history
      this.assessmentHistory.push({
        timestamp: Date.now(),
        assessment,
        responseSnippet: response.substring(0, 100),
      });

      // Trim history to prevent unbounded memory growth
      if (this.assessmentHistory.length > MAX_ASSESSMENT_HISTORY) {
        this.assessmentHistory = this.assessmentHistory.slice(-MAX_ASSESSMENT_HISTORY);
      }

      // Update issue counter
      if (assessment.action !== 'CONTINUE') {
        this.consecutiveIssues++;
      } else {
        this.consecutiveIssues = 0;
        this.lastRelevantAction = Date.now();
      }

      return assessment;

    } catch (error) {
      // On supervisor failure, assume OK and continue (don't block worker)
      console.error('[Supervisor] Assessment failed:', error.message);
      return {
        relevant: true,
        productive: true,
        progressing: true,
        score: 70,
        action: 'CONTINUE',
        reason: 'Assessment unavailable - continuing',
        error: error.message,
      };
    }
  }

  /**
   * Parse supervisor's assessment response
   */
  parseAssessment(text) {
    const assessment = {
      relevant: true,
      productive: true,
      progressing: true,
      score: 50,
      action: 'CONTINUE',
      reason: '',
      raw: text,
    };

    const lines = text.split('\n');

    for (const line of lines) {
      const trimmed = line.trim().toUpperCase();

      if (trimmed.startsWith('RELEVANT:')) {
        assessment.relevant = trimmed.includes('YES');
        assessment.relevantReason = line.split('-')[1]?.trim();
      }
      else if (trimmed.startsWith('PRODUCTIVE:')) {
        assessment.productive = trimmed.includes('YES');
        assessment.productiveReason = line.split('-')[1]?.trim();
      }
      else if (trimmed.startsWith('PROGRESSING:')) {
        assessment.progressing = trimmed.includes('YES');
        assessment.progressingReason = line.split('-')[1]?.trim();
      }
      else if (trimmed.startsWith('SCORE:')) {
        const match = line.match(/(\d+)/);
        if (match) {
          assessment.score = Math.min(100, Math.max(0, parseInt(match[1], 10)));
        }
      }
      else if (trimmed.startsWith('ACTION:')) {
        const action = trimmed.split(':')[1]?.trim();
        // Note: CRITICAL and ABORT are forced by escalation logic, not LLM
        if (['CONTINUE', 'REMIND', 'CORRECT', 'REFOCUS'].includes(action)) {
          assessment.action = action;
        }
      }
      else if (trimmed.startsWith('REASON:')) {
        assessment.reason = line.substring(line.indexOf(':') + 1).trim();
      }
    }

    return assessment;
  }

  /**
   * Determine final action based on escalation logic
   * May override LLM's suggested action based on consecutive issues
   */
  determineAction(assessment) {
    const thresholds = this.getThresholds();
    const issues = this.consecutiveIssues;

    // Force escalation based on consecutive issues (highest priority first)
    if (issues >= thresholds.abort) {
      return 'ABORT';
    }
    if (issues >= thresholds.critical) {
      return 'CRITICAL';
    }
    if (issues >= thresholds.intervene && assessment.action !== 'REFOCUS') {
      return 'REFOCUS';
    }
    if (issues >= thresholds.warn && assessment.action === 'CONTINUE') {
      return 'CORRECT';
    }

    // Use LLM's suggested action
    return assessment.action;
  }

  /**
   * Calculate average score from recent assessments
   */
  getAverageScore() {
    if (this.assessmentHistory.length === 0) return null;
    const scores = this.assessmentHistory.map(a => a.assessment.score);
    return Math.round(scores.reduce((sum, s) => sum + s, 0) / scores.length);
  }

  /**
   * Generate correction prompt based on assessment
   */
  generateCorrection(assessment) {
    const goal = this.goalTracker.primaryGoal;
    const phase = this.getCurrentPhase();
    const thresholds = this.getThresholds();
    const avgScore = this.getAverageScore();

    switch (assessment.action) {
      case 'CONTINUE':
        return null; // No correction needed

      case 'REMIND':
        return `## Quick Reminder

${assessment.reason || 'Stay focused on the goal.'}

**Goal:** ${goal}
**Current focus:** ${phase}

Continue working.`;

      case 'CORRECT':
        this.totalCorrections++;
        return `## Course Correction

${assessment.reason || 'Your recent work may not be aligned with the goal.'}

**Your goal is:** ${goal}
**You should be working on:** ${phase}

Score: ${assessment.score}/100
Consecutive issues: ${this.consecutiveIssues}/${thresholds.abort}
${!assessment.productive ? '⚠️ Take concrete action, not just planning.' : ''}
${!assessment.relevant ? '⚠️ This work doesn\'t appear relevant to the goal.' : ''}

Refocus and take your next action toward the goal.`;

      case 'REFOCUS':
        this.totalCorrections++;
        return `## CRITICAL: REFOCUS REQUIRED

You have drifted from the assigned task for ${this.consecutiveIssues} consecutive responses.

**STOP ALL CURRENT WORK IMMEDIATELY.**

Your ONLY objective is: ${goal}

Before taking ANY action, you MUST:
1. Acknowledge this correction explicitly
2. State what you were doing wrong
3. List exactly 3 steps to get back on track
4. Execute the FIRST step immediately

WARNING: Continued drift will result in session termination.
Current alignment score: ${assessment.score}/100
Consecutive issues: ${this.consecutiveIssues}/${thresholds.abort}`;

      case 'CRITICAL':
        this.totalCorrections++;
        return `## CRITICAL ESCALATION - FINAL WARNING

This is a CRITICAL escalation. You have failed to maintain goal focus for ${this.consecutiveIssues} consecutive responses.

Consecutive off-track responses: ${this.consecutiveIssues}/${thresholds.abort} (ABORT threshold)
Average alignment score: ${avgScore || assessment.score}/100

⚠️ ONE MORE OFF-TRACK RESPONSE WILL TERMINATE THIS SESSION ⚠️

You MUST immediately:
1. STOP all current work
2. Acknowledge you have drifted off-task
3. State the EXACT goal: "${goal}"
4. Take ONE concrete action directly toward that goal

This is not a suggestion. Failure to comply will result in session termination.`;

      case 'ABORT':
        return `## SESSION TERMINATED

This session is being terminated due to inability to maintain goal focus.

Final Statistics:
- Consecutive issues: ${this.consecutiveIssues}
- Total corrections issued: ${this.totalCorrections}
- Average alignment score: ${avgScore || 'N/A'}/100

Please provide a final summary of:
1. What was accomplished (if anything)
2. What went wrong
3. Recommendations for retry`;

      default:
        return null;
    }
  }

  /**
   * Check for stagnation (no progress for too long)
   */
  checkStagnation() {
    const maxIdleMs = this.getStagnationThreshold();
    const idle = Date.now() - this.lastRelevantAction;
    const thresholds = this.getThresholds();

    if (idle > maxIdleMs) {
      // Stagnation also counts as an issue for escalation purposes
      return {
        isStagnant: true,
        idleTime: idle,
        prompt: `## Stagnation Alert

No significant progress detected for ${Math.round(idle / 60000)} minutes.

**Goal:** ${this.goalTracker.primaryGoal}
**Consecutive issues:** ${this.consecutiveIssues}/${thresholds.abort}

Are you stuck? If so:
1. Explain what's blocking you
2. Try an alternative approach
3. Move to the next sub-task if current one is blocked

Take action now. Continued stagnation will escalate to session termination.`,
      };
    }

    return { isStagnant: false };
  }

  /**
   * Full check cycle - assess, apply escalation, and generate correction if needed
   */
  async check(response, recentActions = []) {
    // Get LLM assessment
    const assessment = await this.assess(response, recentActions);

    // Apply escalation logic to determine final action
    const finalAction = this.determineAction(assessment);
    const escalated = finalAction !== assessment.action;

    // Create modified assessment with final action
    const finalAssessment = {
      ...assessment,
      originalAction: assessment.action,
      action: finalAction,
      escalated,
    };

    // Track previous action for verification
    this.previousAction = finalAction;

    // Generate correction prompt for the final action
    const correction = this.generateCorrection(finalAssessment);
    const stagnation = this.checkStagnation();

    return {
      assessment: finalAssessment,
      correction,
      stagnation,
      needsIntervention: correction !== null || stagnation.isStagnant,
      prompt: correction || (stagnation.isStagnant ? stagnation.prompt : null),
      consecutiveIssues: this.consecutiveIssues,
      escalated,
    };
  }

  /**
   * Review a plan before execution
   * Returns { approved: boolean, issues: [], suggestions: [], revisedSteps: [] }
   */
  async reviewPlan(plan, originalGoal) {
    const prompt = `You are reviewing an execution plan before it begins.

## ORIGINAL GOAL
${originalGoal}

## PROPOSED PLAN
Analysis: ${plan.analysis || 'None provided'}

Steps:
${plan.steps.map(s => `${s.number}. ${s.description} [${s.complexity}]`).join('\n')}

## YOUR TASK

Critically review this plan. Consider:
1. Does it fully address the original goal?
2. Are any critical steps missing?
3. Is the order logical?
4. Are steps too vague or too granular?
5. Are there any obvious blockers or risks?

Respond in EXACTLY this format:

APPROVED: [YES/NO]
ISSUES: [comma-separated list of problems, or "none"]
MISSING_STEPS: [comma-separated list of missing steps, or "none"]
SUGGESTIONS: [comma-separated improvements, or "none"]`;

    try {
      const result = await this.client.sendPrompt(prompt, {
        newSession: true,
        timeout: 3 * 60 * 1000,
        model: 'sonnet', // Use Sonnet for plan review
      });

      const response = result.response || '';
      const approved = response.toUpperCase().includes('APPROVED: YES');

      const issuesMatch = response.match(/ISSUES:\s*(.+?)(?:\n|$)/i);
      const missingMatch = response.match(/MISSING_STEPS:\s*(.+?)(?:\n|$)/i);
      const suggestionsMatch = response.match(/SUGGESTIONS:\s*(.+?)(?:\n|$)/i);

      const parseList = (match) => {
        if (!match || match[1].toLowerCase().trim() === 'none') return [];
        return match[1].split(',').map(s => s.trim()).filter(s => s);
      };

      return {
        approved,
        issues: parseList(issuesMatch),
        missingSteps: parseList(missingMatch),
        suggestions: parseList(suggestionsMatch),
        raw: response,
      };
    } catch (error) {
      console.error('[Supervisor] Plan review failed:', error.message);
      // On failure, approve to avoid blocking
      return { approved: true, issues: [], missingSteps: [], suggestions: [], error: error.message };
    }
  }

  /**
   * Verify a step completion claim
   * Returns { verified: boolean, reason: string }
   */
  async verifyStepCompletion(step, responseContent) {
    const prompt = `You are verifying whether a step was actually completed.

## STEP TO VERIFY
Step ${step.number}: ${step.description}
Complexity: ${step.complexity}

## ASSISTANT'S RESPONSE
${responseContent.substring(0, 3000)}

## YOUR TASK
Did the assistant actually complete this step? Look for:
- Concrete actions taken (not just plans)
- Evidence the step's objective was achieved
- Actual output, file changes, or results

Respond in EXACTLY this format:
VERIFIED: [YES/NO]
REASON: [one sentence explanation]`;

    try {
      const result = await this.client.sendPrompt(prompt, {
        newSession: true,
        timeout: 2 * 60 * 1000, // 2 min timeout
        model: 'sonnet', // Use Sonnet for step verification
      });

      const response = result.response || '';
      const verified = response.toUpperCase().includes('VERIFIED: YES');
      const reasonMatch = response.match(/REASON:\s*(.+?)(?:\n|$)/i);
      const reason = reasonMatch ? reasonMatch[1].trim() : 'No reason provided';

      return { verified, reason };
    } catch (error) {
      // On failure, trust the claim to avoid blocking
      console.error('[Supervisor] Step verification failed:', error.message);
      return { verified: true, reason: 'Verification unavailable - trusting claim' };
    }
  }

  /**
   * Final verification that the original goal was achieved
   * This is separate from step verification - verifies the GOAL not the steps
   */
  async verifyGoalAchieved(originalGoal, completedSteps, workingDirectory) {
    const stepsSummary = completedSteps
      .map(s => `${s.status === 'completed' ? '✓' : '✗'} ${s.number}. ${s.description}`)
      .join('\n');

    const prompt = `You are performing FINAL VERIFICATION that a goal was truly achieved.

## ORIGINAL GOAL
${originalGoal}

## COMPLETED STEPS
${stepsSummary}

## WORKING DIRECTORY
${workingDirectory}

## YOUR TASK

This is the final check before declaring success. Be CRITICAL and thorough.

Consider:
1. Does the work done actually achieve the ORIGINAL GOAL?
2. Are there any gaps between what was done and what was asked?
3. Would a human reviewing this work be satisfied?
4. Is the result functional and complete, not just "done"?

Think about edge cases and what could still be missing.

Respond in EXACTLY this format:

GOAL_ACHIEVED: [YES/NO]
CONFIDENCE: [HIGH/MEDIUM/LOW]
GAPS: [list any gaps between goal and result, or "none"]
FUNCTIONAL: [YES/NO/UNKNOWN] - Would this actually work if used?
RECOMMENDATION: [ACCEPT/REJECT/NEEDS_TESTING]
REASON: [one paragraph explanation]`;

    try {
      const result = await this.client.sendPrompt(prompt, {
        newSession: true,
        timeout: 3 * 60 * 1000,
        model: 'sonnet', // Use smarter model for final verification
      });

      const response = result.response || '';
      const achieved = response.toUpperCase().includes('GOAL_ACHIEVED: YES');
      const confidenceMatch = response.match(/CONFIDENCE:\s*(HIGH|MEDIUM|LOW)/i);
      const functionalMatch = response.match(/FUNCTIONAL:\s*(YES|NO|UNKNOWN)/i);
      const recommendationMatch = response.match(/RECOMMENDATION:\s*(ACCEPT|REJECT|NEEDS_TESTING)/i);
      const gapsMatch = response.match(/GAPS:\s*(.+?)(?:\n|$)/i);
      const reasonMatch = response.match(/REASON:\s*(.+?)(?:\n\n|$)/is);

      return {
        achieved,
        confidence: confidenceMatch ? confidenceMatch[1].toUpperCase() : 'UNKNOWN',
        functional: functionalMatch ? functionalMatch[1].toUpperCase() : 'UNKNOWN',
        recommendation: recommendationMatch ? recommendationMatch[1].toUpperCase() : 'UNKNOWN',
        gaps: gapsMatch && gapsMatch[1].toLowerCase().trim() !== 'none'
          ? gapsMatch[1].trim() : null,
        reason: reasonMatch ? reasonMatch[1].trim() : 'No reason provided',
        raw: response,
      };
    } catch (error) {
      console.error('[Supervisor] Goal verification failed:', error.message);
      return {
        achieved: false,
        confidence: 'LOW',
        functional: 'UNKNOWN',
        recommendation: 'NEEDS_TESTING',
        reason: `Verification failed: ${error.message}`,
        error: error.message,
      };
    }
  }

  /**
   * Get supervisor stats
   */
  getStats() {
    const thresholds = this.getThresholds();
    const actionCounts = this.assessmentHistory.reduce((counts, entry) => {
      const action = entry.assessment.action;
      counts[action] = (counts[action] || 0) + 1;
      return counts;
    }, {});

    return {
      totalAssessments: this.assessmentHistory.length,
      consecutiveIssues: this.consecutiveIssues,
      totalCorrections: this.totalCorrections,
      lastRelevantAction: this.lastRelevantAction,
      recentScores: this.assessmentHistory.slice(-5).map(a => a.assessment.score),
      averageScore: this.getAverageScore(),
      actionCounts,
      thresholds,
      escalationStatus: this.getEscalationStatus(),
    };
  }

  /**
   * Get current escalation status
   */
  getEscalationStatus() {
    const thresholds = this.getThresholds();
    const issues = this.consecutiveIssues;

    if (issues >= thresholds.abort) return 'ABORT';
    if (issues >= thresholds.critical) return 'CRITICAL';
    if (issues >= thresholds.intervene) return 'INTERVENE';
    if (issues >= thresholds.warn) return 'WARN';
    return 'OK';
  }
}

export default Supervisor;
