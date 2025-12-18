/**
 * Supervisor - LLM-based assessment of worker Claude's progress
 * Uses a separate Claude session to evaluate if work is on-track
 * Implements escalation system for drift recovery
 *
 * Enhanced with:
 * - JSON schema for structured outputs (eliminates regex parsing)
 * - Read-only tool restrictions for safety
 * - Optimized prompts for faster assessment
 * - Skip-supervision for simple complexity steps
 */

// Memory limits
const MAX_ASSESSMENT_HISTORY = 50;

// JSON schemas for structured supervisor outputs
const ASSESSMENT_SCHEMA = {
  type: 'object',
  properties: {
    relevant: { type: 'boolean', description: 'Is work relevant to the goal?' },
    relevantReason: { type: 'string', description: 'Why relevant or not' },
    productive: { type: 'boolean', description: 'Is assistant taking concrete actions?' },
    productiveReason: { type: 'string', description: 'Why productive or not' },
    progressing: { type: 'boolean', description: 'Is there forward momentum?' },
    progressingReason: { type: 'string', description: 'Why progressing or not' },
    score: { type: 'integer', minimum: 0, maximum: 100, description: 'Alignment score 0-100' },
    action: { type: 'string', enum: ['CONTINUE', 'REMIND', 'CORRECT', 'REFOCUS'], description: 'Recommended action' },
    reason: { type: 'string', description: 'One sentence summary' },
  },
  required: ['relevant', 'productive', 'progressing', 'score', 'action', 'reason'],
};

const PLAN_REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    approved: { type: 'boolean', description: 'Is the plan approved?' },
    issues: { type: 'array', items: { type: 'string' }, description: 'Problems with the plan' },
    missingSteps: { type: 'array', items: { type: 'string' }, description: 'Steps that should be added' },
    suggestions: { type: 'array', items: { type: 'string' }, description: 'Improvements to consider' },
  },
  required: ['approved', 'issues', 'missingSteps', 'suggestions'],
};

const STEP_VERIFICATION_SCHEMA = {
  type: 'object',
  properties: {
    verified: { type: 'boolean', description: 'Was the step actually completed?' },
    reason: { type: 'string', description: 'Explanation' },
  },
  required: ['verified', 'reason'],
};

const GOAL_VERIFICATION_SCHEMA = {
  type: 'object',
  properties: {
    achieved: { type: 'boolean', description: 'Was the goal achieved?' },
    confidence: { type: 'string', enum: ['HIGH', 'MEDIUM', 'LOW'], description: 'Confidence level' },
    functional: { type: 'string', enum: ['YES', 'NO', 'UNKNOWN'], description: 'Is the result functional?' },
    recommendation: { type: 'string', enum: ['ACCEPT', 'REJECT', 'NEEDS_TESTING'], description: 'Final recommendation' },
    gaps: { type: 'string', description: 'Gaps between goal and result, or null if none' },
    reason: { type: 'string', description: 'Detailed explanation' },
  },
  required: ['achieved', 'confidence', 'recommendation', 'reason'],
};

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

    // Supervisor configuration
    this.useStructuredOutput = config?.get('supervisor')?.useStructuredOutput !== false;
    this.readOnlyTools = config?.get('supervisor')?.readOnlyTools !== false;
    this.maxResponseLength = config?.get('supervisor')?.maxResponseLength || 5000;
    this.skipForSimpleSteps = config?.get('supervisor')?.skipForSimpleSteps || false;
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
   * Optimized for concise, structured output
   */
  buildAssessmentPrompt(response, recentActions) {
    const thresholds = this.getThresholds();
    const truncatedResponse = response.substring(0, this.maxResponseLength);

    // Use concise prompt when structured output is enabled
    if (this.useStructuredOutput) {
      return `SUPERVISOR: Evaluate AI assistant progress.

GOAL: ${this.goalTracker.primaryGoal}
${this.goalTracker.subGoals.length > 0 ? `CURRENT PHASE: ${this.getCurrentPhase()}` : ''}
CONSECUTIVE ISSUES: ${this.consecutiveIssues}/${thresholds.abort}

ASSISTANT OUTPUT:
${truncatedResponse}

RECENT ACTIONS: ${recentActions.length > 0 ? recentActions.join('; ') : 'None'}

SCORING: 90-100=advancing goal, 70-89=acceptable, 50-69=tangential, 30-49=off-track, 0-29=lost
ACTIONS: CONTINUE(70+), REMIND(50-69), CORRECT(30-49 or ${thresholds.warn}+ issues), REFOCUS(<30 or ${thresholds.intervene}+ issues)`;
    }

    // Full prompt for text-based parsing (fallback)
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
${truncatedResponse}

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
   * Check if we can use fast-path assessment (skip LLM call)
   * Returns true if response shows clear progress and recent history is positive
   */
  canUseFastAssessment(response) {
    // Need at least 2 previous assessments
    if (this.assessmentHistory.length < 2) return false;

    // Last assessment must be CONTINUE with good score
    const lastAssessment = this.assessmentHistory[this.assessmentHistory.length - 1]?.assessment;
    if (!lastAssessment || lastAssessment.action !== 'CONTINUE' || lastAssessment.score < 75) {
      return false;
    }

    // Must have no consecutive issues
    if (this.consecutiveIssues > 0) return false;

    // Response must contain clear progress indicators
    const progressIndicators = [
      /STEP\s+COMPLETE/i,
      /successfully\s+(created|implemented|wrote|added|fixed|updated)/i,
      /completed?\s+(the|this)?\s*(step|task|implementation)/i,
      /✓|✔|done|finished/i,
    ];

    const hasProgressIndicator = progressIndicators.some(pattern => pattern.test(response));
    if (!hasProgressIndicator) return false;

    // Response must NOT contain blockers or errors
    const blockerIndicators = [
      /STEP\s+BLOCKED/i,
      /error|exception|failed|cannot|unable/i,
      /stuck|blocked|problem/i,
    ];

    const hasBlocker = blockerIndicators.some(pattern => pattern.test(response));
    if (hasBlocker) return false;

    return true;
  }

  /**
   * Ultra-fast assessment for tool-usage responses
   * If the response shows active tool usage with no errors, skip assessment entirely
   */
  canUseUltraFastAssessment(response) {
    // Must have no consecutive issues
    if (this.consecutiveIssues > 0) return false;

    // Look for clear tool usage indicators
    const toolUsageIndicators = [
      /Read tool|Write tool|Edit tool|Bash tool|Glob tool|Grep tool/i,
      /reading file|writing file|editing file|running command/i,
      /searching for|found \d+ files|found \d+ matches/i,
      /Let me (read|write|edit|run|search|check|look)/i,
      /I'll (read|write|edit|run|search|check|create|update)/i,
    ];

    const hasToolUsage = toolUsageIndicators.some(pattern => pattern.test(response));
    if (!hasToolUsage) return false;

    // Must NOT have error indicators
    const errorIndicators = [
      /error:|exception:|failed to|cannot|unable to/i,
      /STEP\s+BLOCKED/i,
      /permission denied/i,
    ];

    const hasError = errorIndicators.some(pattern => pattern.test(response));
    if (hasError) return false;

    // Response should be of reasonable length (not empty/too short)
    if (response.length < 50) return false;

    return true;
  }

  /**
   * Assess the worker's response
   * Enhanced with JSON schema for structured outputs and read-only tools
   */
  async assess(response, recentActions = [], options = {}) {
    // Skip supervision for simple steps if configured
    if (this.skipForSimpleSteps && options.complexity === 'simple') {
      return {
        relevant: true,
        productive: true,
        progressing: true,
        score: 80,
        action: 'CONTINUE',
        reason: 'Skipped - simple complexity step',
        skipped: true,
      };
    }

    // Ultra-fast path: Skip assessment entirely if response shows active tool usage
    // This significantly speeds up iterations during active work
    if (this.canUseUltraFastAssessment(response)) {
      return {
        relevant: true,
        productive: true,
        progressing: true,
        score: 90,
        action: 'CONTINUE',
        reason: 'Ultra-fast: Active tool usage detected',
        ultraFastPath: true,
      };
    }

    // Fast-path: If last assessment was CONTINUE with high score, and response
    // contains clear progress indicators, skip full LLM assessment
    if (this.canUseFastAssessment(response)) {
      return {
        relevant: true,
        productive: true,
        progressing: true,
        score: 85,
        action: 'CONTINUE',
        reason: 'Fast-path: Clear progress detected',
        fastPath: true,
      };
    }

    const prompt = this.buildAssessmentPrompt(response, recentActions);

    try {
      // Build options for supervisor call
      const callOptions = {
        newSession: true,
        timeout: 3 * 60 * 1000, // 3 min timeout (reduced from 5)
        model: 'sonnet',
        noSessionPersistence: true, // Don't save supervisor sessions
      };

      // Use JSON schema for structured output when enabled
      if (this.useStructuredOutput) {
        callOptions.jsonSchema = ASSESSMENT_SCHEMA;
      }

      // Restrict to read-only tools for safety
      if (this.readOnlyTools) {
        callOptions.disallowedTools = ['Edit', 'Write', 'Bash', 'NotebookEdit'];
      }

      const result = await this.client.sendPrompt(prompt, callOptions);

      // Parse assessment - use structured output if available
      let assessment;
      if (result.structuredOutput) {
        assessment = this.normalizeStructuredAssessment(result.structuredOutput);
      } else {
        assessment = this.parseAssessment(result.response);
      }

      // Track history
      this.assessmentHistory.push({
        timestamp: Date.now(),
        assessment,
        responseSnippet: response.substring(0, 100),
        usedStructuredOutput: !!result.structuredOutput,
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
   * Normalize structured output to assessment format
   */
  normalizeStructuredAssessment(structured) {
    return {
      relevant: structured.relevant ?? true,
      relevantReason: structured.relevantReason || '',
      productive: structured.productive ?? true,
      productiveReason: structured.productiveReason || '',
      progressing: structured.progressing ?? true,
      progressingReason: structured.progressingReason || '',
      score: Math.min(100, Math.max(0, structured.score ?? 50)),
      action: ['CONTINUE', 'REMIND', 'CORRECT', 'REFOCUS'].includes(structured.action)
        ? structured.action
        : 'CONTINUE',
      reason: structured.reason || '',
      raw: structured,
    };
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
   * Detect repetitive behavior patterns that indicate stalling
   * Returns analysis of recent behavior patterns
   */
  detectRepetitiveBehavior() {
    if (this.assessmentHistory.length < 5) {
      return { isRepetitive: false };
    }

    const recent = this.assessmentHistory.slice(-10);

    // Check for repeated similar scores (stuck at same level)
    const scores = recent.map(a => a.assessment.score);
    const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
    const variance = scores.reduce((sum, s) => sum + Math.pow(s - avgScore, 2), 0) / scores.length;

    // Low variance in scores might indicate stuck behavior
    const isScoreStuck = variance < 25 && avgScore < 70;

    // Check for repeated actions
    const actions = recent.map(a => a.assessment.action);
    const actionCounts = actions.reduce((acc, action) => {
      acc[action] = (acc[action] || 0) + 1;
      return acc;
    }, {});

    // If same non-CONTINUE action repeated 3+ times, likely stuck
    const repeatedNonContinue = Object.entries(actionCounts)
      .filter(([action, count]) => action !== 'CONTINUE' && count >= 3)
      .length > 0;

    // Check for content similarity in responses
    const snippets = recent.map(a => a.responseSnippet?.toLowerCase() || '');
    let similarityCount = 0;
    for (let i = 1; i < snippets.length; i++) {
      if (this.stringSimilarity(snippets[i], snippets[i - 1]) > 0.7) {
        similarityCount++;
      }
    }
    const isContentRepetitive = similarityCount >= 3;

    const isRepetitive = isScoreStuck || repeatedNonContinue || isContentRepetitive;

    return {
      isRepetitive,
      patterns: {
        scoreStuck: isScoreStuck,
        repeatedCorrections: repeatedNonContinue,
        similarContent: isContentRepetitive,
        avgScore,
        scoreVariance: variance,
      },
      suggestion: isRepetitive ? this.generateRecoverySuggestion({
        scoreStuck: isScoreStuck,
        repeatedCorrections: repeatedNonContinue,
        similarContent: isContentRepetitive,
      }) : null,
    };
  }

  /**
   * Simple string similarity (Jaccard on words)
   */
  stringSimilarity(str1, str2) {
    const words1 = new Set(str1.split(/\s+/).filter(w => w.length > 3));
    const words2 = new Set(str2.split(/\s+/).filter(w => w.length > 3));

    if (words1.size === 0 || words2.size === 0) return 0;

    const intersection = [...words1].filter(w => words2.has(w)).length;
    const union = new Set([...words1, ...words2]).size;

    return intersection / union;
  }

  /**
   * Generate a recovery suggestion based on detected patterns
   */
  generateRecoverySuggestion(patterns) {
    if (patterns.repeatedCorrections) {
      return `You've received multiple corrections without changing approach. Try a completely different strategy:
1. List 3 alternative approaches you haven't tried
2. Pick the most promising one
3. Execute it immediately`;
    }

    if (patterns.similarContent) {
      return `Your responses are too similar - you may be in a loop. Break out by:
1. Stop the current activity completely
2. Re-read the original goal
3. Start fresh with a different first step`;
    }

    if (patterns.scoreStuck) {
      return `Progress has plateaued. To advance:
1. Identify what specific blocker is preventing progress
2. If technical: try a workaround or simplification
3. If unclear requirements: state assumptions and proceed`;
    }

    return 'Consider taking a different approach to make progress.';
  }

  /**
   * Automatically attempt recovery from detected stall
   * Returns recovery action to take
   */
  suggestAutoRecovery(repetitiveAnalysis, currentStep = null) {
    if (!repetitiveAnalysis.isRepetitive) {
      return null;
    }

    const recoveryActions = [];

    // If we have a current step that's stuck, suggest skipping
    if (currentStep && repetitiveAnalysis.patterns.repeatedCorrections) {
      recoveryActions.push({
        action: 'SKIP_STEP',
        reason: 'Step appears blocked after multiple attempts',
        prompt: `This step appears blocked. Let's mark it as blocked and move to the next step.

Say "STEP BLOCKED: Unable to complete after multiple attempts" to proceed.`,
      });
    }

    // If content is repetitive, suggest context reset
    if (repetitiveAnalysis.patterns.similarContent) {
      recoveryActions.push({
        action: 'CONTEXT_RESET',
        reason: 'Repetitive responses detected',
        prompt: `You appear to be in a loop. Let me reset context.

Current goal: ${this.goalTracker.primaryGoal}
${currentStep ? `Current step: ${currentStep.description}` : ''}

Start fresh: What is ONE concrete action you can take RIGHT NOW to make progress?`,
      });
    }

    // If score is stuck low, suggest simplification
    if (repetitiveAnalysis.patterns.scoreStuck && repetitiveAnalysis.patterns.avgScore < 50) {
      recoveryActions.push({
        action: 'SIMPLIFY',
        reason: 'Consistently low alignment scores',
        prompt: `Progress is stalled. Let's simplify:

1. What is the MINIMUM viable action to advance the goal?
2. Ignore edge cases and optimizations for now
3. Execute the simplest possible next step

What is that one simple action?`,
      });
    }

    // Return the most appropriate recovery action
    return recoveryActions[0] || null;
  }

  /**
   * Full check cycle - assess, apply escalation, and generate correction if needed
   */
  async check(response, recentActions = [], options = {}) {
    const { currentStep = null } = options;

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

    // Check for repetitive behavior patterns
    const repetitiveAnalysis = this.detectRepetitiveBehavior();
    const autoRecovery = this.suggestAutoRecovery(repetitiveAnalysis, currentStep);

    // Determine the prompt to use (priority: autoRecovery > correction > stagnation)
    let prompt = null;
    if (autoRecovery) {
      prompt = autoRecovery.prompt;
    } else if (correction) {
      prompt = correction;
    } else if (stagnation.isStagnant) {
      prompt = stagnation.prompt;
    }

    return {
      assessment: finalAssessment,
      correction,
      stagnation,
      repetitiveAnalysis,
      autoRecovery,
      needsIntervention: prompt !== null,
      prompt,
      consecutiveIssues: this.consecutiveIssues,
      escalated,
    };
  }

  /**
   * Review a plan before execution
   * Returns { approved: boolean, issues: [], suggestions: [], revisedSteps: [] }
   * Enhanced with JSON schema for structured output
   */
  async reviewPlan(plan, originalGoal) {
    // Use concise prompt when structured output is enabled
    const prompt = this.useStructuredOutput
      ? `Review this execution plan for goal: "${originalGoal}"

Plan:
${plan.steps.map(s => `${s.number}. ${s.description} [${s.complexity}]`).join('\n')}

Check: Addresses goal? Missing steps? Logical order? Right granularity?`
      : `You are reviewing an execution plan before it begins.

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
      const callOptions = {
        newSession: true,
        timeout: 2 * 60 * 1000, // 2 min (reduced from 3)
        model: 'sonnet',
        noSessionPersistence: true,
      };

      if (this.useStructuredOutput) {
        callOptions.jsonSchema = PLAN_REVIEW_SCHEMA;
      }

      if (this.readOnlyTools) {
        callOptions.disallowedTools = ['Edit', 'Write', 'Bash', 'NotebookEdit'];
      }

      const result = await this.client.sendPrompt(prompt, callOptions);

      // Use structured output if available
      if (result.structuredOutput) {
        return {
          approved: result.structuredOutput.approved ?? true,
          issues: result.structuredOutput.issues || [],
          missingSteps: result.structuredOutput.missingSteps || [],
          suggestions: result.structuredOutput.suggestions || [],
          raw: result.structuredOutput,
        };
      }

      // Fall back to regex parsing
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
   * Enhanced with JSON schema and optional skip for simple steps
   */
  async verifyStepCompletion(step, responseContent) {
    // Skip verification for simple steps if configured
    if (this.skipForSimpleSteps && step.complexity === 'simple') {
      return { verified: true, reason: 'Skipped - simple complexity step', skipped: true };
    }

    const truncatedResponse = responseContent.substring(0, this.maxResponseLength);

    const prompt = this.useStructuredOutput
      ? `Verify step completion: "${step.description}" [${step.complexity}]

Response:
${truncatedResponse}

Did assistant complete this step with concrete actions and evidence?`
      : `You are verifying whether a step was actually completed.

## STEP TO VERIFY
Step ${step.number}: ${step.description}
Complexity: ${step.complexity}

## ASSISTANT'S RESPONSE
${truncatedResponse}

## YOUR TASK
Did the assistant actually complete this step? Look for:
- Concrete actions taken (not just plans)
- Evidence the step's objective was achieved
- Actual output, file changes, or results

Respond in EXACTLY this format:
VERIFIED: [YES/NO]
REASON: [one sentence explanation]`;

    try {
      const callOptions = {
        newSession: true,
        timeout: 90 * 1000, // 90 sec (reduced from 2 min)
        model: 'sonnet',
        noSessionPersistence: true,
      };

      if (this.useStructuredOutput) {
        callOptions.jsonSchema = STEP_VERIFICATION_SCHEMA;
      }

      if (this.readOnlyTools) {
        callOptions.disallowedTools = ['Edit', 'Write', 'Bash', 'NotebookEdit'];
      }

      const result = await this.client.sendPrompt(prompt, callOptions);

      // Use structured output if available
      if (result.structuredOutput) {
        return {
          verified: result.structuredOutput.verified ?? true,
          reason: result.structuredOutput.reason || 'No reason provided',
        };
      }

      // Fall back to regex parsing
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
   * Enhanced with JSON schema for structured output
   */
  async verifyGoalAchieved(originalGoal, completedSteps, workingDirectory) {
    const stepsSummary = completedSteps
      .map(s => `${s.status === 'completed' ? '✓' : '✗'} ${s.number}. ${s.description}`)
      .join('\n');

    const prompt = this.useStructuredOutput
      ? `FINAL VERIFICATION - Was goal achieved?

GOAL: ${originalGoal}

COMPLETED STEPS:
${stepsSummary}

WORKING DIR: ${workingDirectory}

Critical review: Does work achieve goal? Any gaps? Functional result? Human would be satisfied?`
      : `You are performing FINAL VERIFICATION that a goal was truly achieved.

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
      const callOptions = {
        newSession: true,
        timeout: 2 * 60 * 1000, // 2 min (reduced from 3)
        model: 'sonnet',
        noSessionPersistence: true,
      };

      if (this.useStructuredOutput) {
        callOptions.jsonSchema = GOAL_VERIFICATION_SCHEMA;
      }

      if (this.readOnlyTools) {
        callOptions.disallowedTools = ['Edit', 'Write', 'Bash', 'NotebookEdit'];
      }

      const result = await this.client.sendPrompt(prompt, callOptions);

      // Use structured output if available
      if (result.structuredOutput) {
        const so = result.structuredOutput;
        return {
          achieved: so.achieved ?? false,
          confidence: so.confidence || 'UNKNOWN',
          functional: so.functional || 'UNKNOWN',
          recommendation: so.recommendation || 'UNKNOWN',
          gaps: so.gaps && so.gaps.toLowerCase() !== 'none' ? so.gaps : null,
          reason: so.reason || 'No reason provided',
          raw: so,
        };
      }

      // Fall back to regex parsing
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
      const isTimeout = error.message?.includes('timed out');
      return {
        // Don't mark achieved as false on timeout - we don't know if goal was achieved
        // null means "verification inconclusive", false means "goal definitely not achieved"
        achieved: isTimeout ? null : false,
        confidence: 'LOW',
        functional: 'UNKNOWN',
        recommendation: 'NEEDS_TESTING',
        reason: `Verification failed: ${error.message}`,
        error: error.message,
        verificationError: true,
        verificationTimeout: isTimeout,
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
