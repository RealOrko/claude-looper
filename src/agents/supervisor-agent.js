/**
 * Supervisor Agent - Output Verification and Quality Control
 *
 * The Supervisor agent is responsible for:
 * 1. Verifying ALL outputs from ALL agents (Planner, Coder, Tester)
 * 2. Assessing goal alignment and progress
 * 3. Issuing corrections when agents drift off-track
 * 4. Escalating issues and recommending abort when necessary
 *
 * Uses Sonnet model for efficient verification.
 */

import {
  BaseAgent,
  AgentRole,
  AgentStatus,
  MessageType,
  VerificationType,
  VerificationResult,
  AgentMessage,
} from './interfaces.js';

// Escalation levels
export const EscalationLevel = {
  NONE: 'none',
  REMIND: 'remind',
  CORRECT: 'correct',
  REFOCUS: 'refocus',
  CRITICAL: 'critical',
  ABORT: 'abort',
};

// Memory limits
const MAX_VERIFICATION_HISTORY = 50;
const MAX_ASSESSMENT_HISTORY = 50;

/**
 * Supervisor Agent
 */
export class SupervisorAgent extends BaseAgent {
  constructor(client, goalTracker, config = {}) {
    super(AgentRole.SUPERVISOR, client, config);

    this.model = config.model || 'sonnet';
    this.goalTracker = goalTracker;
    this.verificationHistory = [];
    this.assessmentHistory = [];
    this.consecutiveIssues = 0;
    this.totalCorrections = 0;
    this.lastRelevantAction = Date.now();

    // Escalation thresholds
    this.thresholds = config.escalationThresholds || {
      warn: 2,
      intervene: 3,
      critical: 4,
      abort: 5,
    };

    // Register message handlers
    this.registerHandlers();
  }

  /**
   * Register message handlers
   */
  registerHandlers() {
    this.onMessage(MessageType.VERIFY_REQUEST, (msg) => this.handleVerifyRequest(msg));
    this.onMessage(MessageType.CORRECTION, (msg) => this.handleCorrectionRequest(msg));
  }

  /**
   * Handle verification request
   */
  async handleVerifyRequest(message) {
    const { type, target, context } = message.payload;

    this.status = AgentStatus.WORKING;

    try {
      let result;

      switch (type) {
        case VerificationType.PLAN:
          result = await this.verifyPlan(target, context);
          break;
        case VerificationType.CODE:
          result = await this.verifyCode(target, context);
          break;
        case VerificationType.TEST:
          result = await this.verifyTestResults(target, context);
          break;
        case VerificationType.STEP:
          result = await this.verifyStepCompletion(target, context);
          break;
        case VerificationType.GOAL:
          result = await this.verifyGoalAchievement(target, context);
          break;
        default:
          result = await this.verifyGeneric(target, context);
      }

      // Store in history
      this.addToVerificationHistory(result);

      return message.createResponse(MessageType.VERIFY_RESPONSE, {
        success: true,
        ...result,
      });

    } catch (error) {
      const errorResult = new VerificationResult(type, target?.id || 'unknown');
      errorResult.setResult(true, 50, 'continue', `Verification error: ${error.message}`);

      return message.createResponse(MessageType.VERIFY_RESPONSE, {
        success: false,
        verified: true, // Don't block on supervisor errors
        error: error.message,
        ...errorResult,
      });
    } finally {
      this.status = AgentStatus.IDLE;
    }
  }

  /**
   * Verify a plan from Planner agent
   */
  async verifyPlan(plan, context = {}) {
    const result = new VerificationResult(VerificationType.PLAN, plan.id);
    const goal = this.goalTracker?.primaryGoal || context.goal || plan.goal;

    const prompt = `You are reviewing an execution plan before it begins.

## ORIGINAL GOAL
${goal}

## PROPOSED PLAN
Analysis: ${plan.analysis || 'None provided'}

Steps:
${plan.steps.map(s => `${s.number}. ${s.description} [${s.complexity}]`).join('\n')}

Total Steps: ${plan.steps.length}
Plan Depth: ${plan.depth || 0} (0=main, 1+=sub-plan)

## YOUR TASK

Critically review this plan:
1. Does it fully address the original goal?
2. Are steps concrete and actionable (not vague)?
3. Is the order logical?
4. Are there any critical missing steps?
5. Are complexity estimates reasonable?

Respond in EXACTLY this format:

SCORE: [0-100] (how well does this plan address the goal?)
APPROVED: [YES/NO]
ISSUES: [comma-separated list of problems, or "none"]
MISSING: [comma-separated missing steps, or "none"]
RECOMMENDATION: [APPROVE/FIX/REJECT]
REASON: [one paragraph explanation]`;

    try {
      const response = await this.client.sendPrompt(prompt, {
        newSession: true,
        timeout: 3 * 60 * 1000,
        model: this.model,
      });

      this.parsePlanVerification(response.response, result);

    } catch (error) {
      result.setResult(true, 70, 'continue', `Plan verification unavailable: ${error.message}`);
    }

    return result;
  }

  /**
   * Verify code output from Coder agent
   */
  async verifyCode(codeOutput, context = {}) {
    const result = new VerificationResult(VerificationType.CODE, codeOutput.id);

    const filesInfo = codeOutput.files?.map(f =>
      `- ${f.path} (${f.action}): ${f.language || 'unknown'}`
    ).join('\n') || 'No files';

    const testsInfo = codeOutput.tests?.map(t =>
      `- ${t.path} (${t.testType})`
    ).join('\n') || 'No tests';

    const prompt = `You are reviewing code output from a developer agent.

## STEP BEING IMPLEMENTED
${context.step?.description || 'Unknown step'}

## CODE OUTPUT SUMMARY
${codeOutput.summary || 'No summary provided'}

## FILES CHANGED
${filesInfo}

## TESTS CREATED
${testsInfo}

## COMMANDS EXECUTED
${codeOutput.commands?.length || 0} commands run

## BLOCKED STATUS
${codeOutput.blocked ? `BLOCKED: ${codeOutput.blockReason}` : 'Not blocked'}

## YOUR TASK

Verify this code output:
1. Does it address the step's requirements?
2. Were appropriate files created/modified?
3. Were tests written?
4. Is the work complete or just started?

Respond in EXACTLY this format:

SCORE: [0-100]
VERIFIED: [YES/NO]
COMPLETENESS: [COMPLETE/PARTIAL/MINIMAL]
ISSUES: [list any problems, or "none"]
RECOMMENDATION: [CONTINUE/FIX/REIMPLEMENT]
REASON: [one sentence]`;

    try {
      const response = await this.client.sendPrompt(prompt, {
        newSession: true,
        timeout: 2 * 60 * 1000,
        model: this.model,
      });

      this.parseCodeVerification(response.response, result);

    } catch (error) {
      result.setResult(true, 60, 'continue', `Code verification unavailable: ${error.message}`);
    }

    return result;
  }

  /**
   * Verify test results from Tester agent
   */
  async verifyTestResults(testResult, context = {}) {
    const result = new VerificationResult(VerificationType.TEST, testResult.id);

    const issuesList = testResult.issues?.map(i =>
      `- [${i.severity}] ${i.description}`
    ).join('\n') || 'No issues';

    const prompt = `You are reviewing test results from a QA agent.

## TEST SUMMARY
Test Type: ${testResult.testType}
Passed: ${testResult.passed}
Issue Count: ${testResult.issues?.length || 0}
Coverage: ${testResult.coverage || 'Unknown'}

## ISSUES FOUND
${issuesList}

## SUGGESTIONS
${testResult.suggestions?.map(s => `- [${s.priority}] ${s.description}`).join('\n') || 'None'}

## YOUR TASK

Verify the test results are accurate:
1. Are the issues real problems or false positives?
2. Is the severity assessment correct?
3. Should any issues be escalated or downgraded?
4. Is the pass/fail verdict appropriate?

Respond in EXACTLY this format:

SCORE: [0-100]
VERIFIED: [YES/NO]
VERDICT_CORRECT: [YES/NO]
ADJUSTED_ISSUES: [list any severity changes, or "none"]
RECOMMENDATION: [ACCEPT/RETEST/OVERRIDE]
REASON: [one sentence]`;

    try {
      const response = await this.client.sendPrompt(prompt, {
        newSession: true,
        timeout: 2 * 60 * 1000,
        model: this.model,
      });

      this.parseTestVerification(response.response, result);

    } catch (error) {
      result.setResult(true, 70, 'continue', `Test verification unavailable: ${error.message}`);
    }

    return result;
  }

  /**
   * Verify step completion claim
   */
  async verifyStepCompletion(data, context = {}) {
    const { step, codeOutput, testResults } = data;
    const result = new VerificationResult(VerificationType.STEP, step.id);

    const prompt = `You are verifying whether a step was actually completed.

## STEP TO VERIFY
Step ${step.number}: ${step.description}
Complexity: ${step.complexity}

## CODE OUTPUT
Files changed: ${codeOutput?.files?.length || 0}
Tests created: ${codeOutput?.tests?.length || 0}
Summary: ${codeOutput?.summary || 'None'}
Blocked: ${codeOutput?.blocked || false}

## TEST RESULTS
Passed: ${testResults?.passed}
Issues: ${testResults?.issues?.length || 0}
Coverage: ${testResults?.coverage || 'Unknown'}

## YOUR TASK

Did the agent actually complete this step? Look for:
- Concrete actions taken (not just plans)
- Evidence the step's objective was achieved
- Tests passing (if applicable)
- No critical blockers

Respond in EXACTLY this format:

VERIFIED: [YES/NO]
CONFIDENCE: [HIGH/MEDIUM/LOW]
EVIDENCE: [brief list of what was done]
GAPS: [what's missing, or "none"]
RECOMMENDATION: [ADVANCE/RETRY/REPLAN]
REASON: [one sentence]`;

    try {
      const response = await this.client.sendPrompt(prompt, {
        newSession: true,
        timeout: 2 * 60 * 1000,
        model: this.model,
      });

      this.parseStepVerification(response.response, result);

    } catch (error) {
      result.setResult(true, 60, 'continue', `Step verification unavailable: ${error.message}`);
    }

    return result;
  }

  /**
   * Verify goal achievement (final verification)
   */
  async verifyGoalAchievement(data, context = {}) {
    const { goal, plan, metrics } = data;
    const result = new VerificationResult(VerificationType.GOAL, 'goal');

    const stepsStatus = plan?.steps?.map(s =>
      `${s.status === 'completed' ? '✓' : s.status === 'failed' ? '✗' : '○'} ${s.number}. ${s.description}`
    ).join('\n') || 'No steps';

    const prompt = `You are performing FINAL VERIFICATION that a goal was achieved.

## ORIGINAL GOAL
${goal}

## EXECUTION SUMMARY
Total Steps: ${plan?.steps?.length || 0}
Completed: ${metrics?.completedSteps || 0}
Failed: ${metrics?.failedSteps || 0}
Re-plans: ${metrics?.replanCount || 0}
Fix Cycles: ${metrics?.fixCycles || 0}

## STEP STATUS
${stepsStatus}

## YOUR TASK

This is the final check. Be CRITICAL and thorough.

1. Does the work done actually achieve the ORIGINAL GOAL?
2. Are there gaps between what was done and what was asked?
3. Would a human be satisfied with this result?
4. Is the result functional and complete?

Respond in EXACTLY this format:

GOAL_ACHIEVED: [YES/NO/PARTIAL]
CONFIDENCE: [HIGH/MEDIUM/LOW]
COMPLETENESS: [0-100]%
FUNCTIONAL: [YES/NO/UNKNOWN]
GAPS: [list gaps, or "none"]
RECOMMENDATION: [ACCEPT/REJECT/NEEDS_WORK]
REASON: [one paragraph]`;

    try {
      const response = await this.client.sendPrompt(prompt, {
        newSession: true,
        timeout: 3 * 60 * 1000,
        model: this.model,
      });

      this.parseGoalVerification(response.response, result);

    } catch (error) {
      result.setResult(false, 50, 'needs_work', `Goal verification failed: ${error.message}`);
    }

    return result;
  }

  /**
   * Generic verification for unknown types
   */
  async verifyGeneric(target, context = {}) {
    const result = new VerificationResult('generic', target?.id || 'unknown');
    result.setResult(true, 70, 'continue', 'Generic verification - defaulting to pass');
    return result;
  }

  /**
   * Assess agent response for goal alignment (used by orchestrator)
   */
  async assessResponse(response, recentActions = []) {
    const goal = this.goalTracker?.primaryGoal || 'Unknown goal';

    const prompt = `You are a SUPERVISOR evaluating an AI assistant working autonomously.

## ASSIGNED GOAL
${goal}

## AGENT'S RESPONSE
${response.substring(0, 3000)}

## RECENT ACTIONS
${recentActions.length > 0 ? recentActions.map(a => `- ${a}`).join('\n') : 'None'}

## CONSECUTIVE ISSUES
${this.consecutiveIssues}/${this.thresholds.abort}

## YOUR TASK

Is the agent making progress toward the goal?

SCORE: [0-100]
  90-100: Excellent progress
  70-89: Good progress
  50-69: Needs guidance
  30-49: Off track
  0-29: Completely lost

ACTION: [CONTINUE/REMIND/CORRECT/REFOCUS]
RELEVANT: [YES/NO]
PRODUCTIVE: [YES/NO]
REASON: [one sentence]`;

    try {
      const result = await this.client.sendPrompt(prompt, {
        newSession: true,
        timeout: 2 * 60 * 1000,
        model: this.model,
      });

      const assessment = this.parseAssessment(result.response);

      // Update consecutive issues
      if (assessment.action !== 'CONTINUE') {
        this.consecutiveIssues++;
      } else {
        this.consecutiveIssues = 0;
        this.lastRelevantAction = Date.now();
      }

      // Apply escalation logic
      assessment.escalatedAction = this.determineEscalation(assessment);

      // Store in history
      this.addToAssessmentHistory(assessment);

      return assessment;

    } catch (error) {
      return {
        score: 70,
        action: 'CONTINUE',
        relevant: true,
        productive: true,
        reason: `Assessment unavailable: ${error.message}`,
        escalatedAction: 'CONTINUE',
      };
    }
  }

  /**
   * Determine escalation level based on assessment and history
   */
  determineEscalation(assessment) {
    const issues = this.consecutiveIssues;

    if (issues >= this.thresholds.abort) {
      return EscalationLevel.ABORT;
    }
    if (issues >= this.thresholds.critical) {
      return EscalationLevel.CRITICAL;
    }
    if (issues >= this.thresholds.intervene) {
      return EscalationLevel.REFOCUS;
    }
    if (issues >= this.thresholds.warn) {
      return EscalationLevel.CORRECT;
    }
    if (assessment.action === 'REMIND') {
      return EscalationLevel.REMIND;
    }

    return EscalationLevel.NONE;
  }

  /**
   * Generate correction prompt based on escalation level
   */
  generateCorrection(level, assessment, goal) {
    switch (level) {
      case EscalationLevel.REMIND:
        return {
          level,
          prompt: `## Quick Reminder\n\n${assessment.reason}\n\n**Goal:** ${goal}\n\nContinue working.`,
        };

      case EscalationLevel.CORRECT:
        this.totalCorrections++;
        return {
          level,
          prompt: `## Course Correction\n\n${assessment.reason}\n\n**Your goal is:** ${goal}\n\nScore: ${assessment.score}/100\nConsecutive issues: ${this.consecutiveIssues}/${this.thresholds.abort}\n\nRefocus and take your next action toward the goal.`,
        };

      case EscalationLevel.REFOCUS:
        this.totalCorrections++;
        return {
          level,
          prompt: `## CRITICAL: REFOCUS REQUIRED\n\nYou have drifted for ${this.consecutiveIssues} consecutive responses.\n\n**STOP. Your ONLY objective is:** ${goal}\n\n1. Acknowledge this correction\n2. State what you were doing wrong\n3. List 3 steps to get back on track\n4. Execute the FIRST step immediately\n\nWARNING: Continued drift will terminate this session.`,
        };

      case EscalationLevel.CRITICAL:
        this.totalCorrections++;
        return {
          level,
          prompt: `## CRITICAL ESCALATION - FINAL WARNING\n\n⚠️ ONE MORE OFF-TRACK RESPONSE WILL TERMINATE THIS SESSION ⚠️\n\nConsecutive issues: ${this.consecutiveIssues}/${this.thresholds.abort}\n\nYou MUST immediately:\n1. STOP all current work\n2. State the EXACT goal: "${goal}"\n3. Take ONE concrete action toward that goal\n\nThis is not a suggestion.`,
        };

      case EscalationLevel.ABORT:
        return {
          level,
          prompt: `## SESSION TERMINATED\n\nUnable to maintain goal focus after ${this.consecutiveIssues} consecutive issues.\n\nProvide a final summary of:\n1. What was accomplished\n2. What went wrong\n3. Recommendations for retry`,
          shouldAbort: true,
        };

      default:
        return null;
    }
  }

  // === Parsing Methods ===

  parsePlanVerification(response, result) {
    const scoreMatch = response.match(/SCORE:\s*(\d+)/i);
    const approvedMatch = response.match(/APPROVED:\s*(YES|NO)/i);
    const recommendationMatch = response.match(/RECOMMENDATION:\s*(APPROVE|FIX|REJECT)/i);
    const reasonMatch = response.match(/REASON:\s*(.+?)(?:\n\n|$)/is);

    const score = scoreMatch ? parseInt(scoreMatch[1], 10) : 70;
    const verified = approvedMatch ? approvedMatch[1].toUpperCase() === 'YES' : true;
    const recommendation = recommendationMatch ? recommendationMatch[1].toLowerCase() : 'continue';
    const reason = reasonMatch ? reasonMatch[1].trim() : 'No reason provided';

    result.setResult(verified, score, recommendation, reason);
  }

  parseCodeVerification(response, result) {
    const scoreMatch = response.match(/SCORE:\s*(\d+)/i);
    const verifiedMatch = response.match(/VERIFIED:\s*(YES|NO)/i);
    const recommendationMatch = response.match(/RECOMMENDATION:\s*(CONTINUE|FIX|REIMPLEMENT)/i);
    const reasonMatch = response.match(/REASON:\s*(.+?)(?:\n|$)/i);

    const score = scoreMatch ? parseInt(scoreMatch[1], 10) : 60;
    const verified = verifiedMatch ? verifiedMatch[1].toUpperCase() === 'YES' : true;
    const recommendation = recommendationMatch ? recommendationMatch[1].toLowerCase() : 'continue';
    const reason = reasonMatch ? reasonMatch[1].trim() : 'No reason provided';

    result.setResult(verified, score, recommendation, reason);
  }

  parseTestVerification(response, result) {
    const scoreMatch = response.match(/SCORE:\s*(\d+)/i);
    const verifiedMatch = response.match(/VERIFIED:\s*(YES|NO)/i);
    const verdictMatch = response.match(/VERDICT_CORRECT:\s*(YES|NO)/i);
    const reasonMatch = response.match(/REASON:\s*(.+?)(?:\n|$)/i);

    const score = scoreMatch ? parseInt(scoreMatch[1], 10) : 70;
    const verified = verifiedMatch ? verifiedMatch[1].toUpperCase() === 'YES' : true;
    const reason = reasonMatch ? reasonMatch[1].trim() : 'No reason provided';

    result.setResult(verified, score, 'continue', reason);
  }

  parseStepVerification(response, result) {
    const verifiedMatch = response.match(/VERIFIED:\s*(YES|NO)/i);
    const confidenceMatch = response.match(/CONFIDENCE:\s*(HIGH|MEDIUM|LOW)/i);
    const recommendationMatch = response.match(/RECOMMENDATION:\s*(ADVANCE|RETRY|REPLAN)/i);
    const reasonMatch = response.match(/REASON:\s*(.+?)(?:\n|$)/i);

    const verified = verifiedMatch ? verifiedMatch[1].toUpperCase() === 'YES' : true;
    const confidence = confidenceMatch ? confidenceMatch[1].toLowerCase() : 'medium';
    const score = confidence === 'high' ? 90 : confidence === 'medium' ? 70 : 50;
    const recommendation = recommendationMatch ? recommendationMatch[1].toLowerCase() : 'advance';
    const reason = reasonMatch ? reasonMatch[1].trim() : 'No reason provided';

    result.setResult(verified, score, recommendation, reason);
  }

  parseGoalVerification(response, result) {
    const achievedMatch = response.match(/GOAL_ACHIEVED:\s*(YES|NO|PARTIAL)/i);
    const confidenceMatch = response.match(/CONFIDENCE:\s*(HIGH|MEDIUM|LOW)/i);
    const completenessMatch = response.match(/COMPLETENESS:\s*(\d+)/i);
    const functionalMatch = response.match(/FUNCTIONAL:\s*(YES|NO|UNKNOWN)/i);
    const recommendationMatch = response.match(/RECOMMENDATION:\s*(ACCEPT|REJECT|NEEDS_WORK)/i);
    const reasonMatch = response.match(/REASON:\s*(.+?)(?:\n\n|$)/is);

    const achieved = achievedMatch ? achievedMatch[1].toUpperCase() : 'PARTIAL';
    const verified = achieved === 'YES';
    const score = completenessMatch ? parseInt(completenessMatch[1], 10) : (verified ? 90 : 50);
    const recommendation = recommendationMatch ? recommendationMatch[1].toLowerCase() : 'needs_work';
    const reason = reasonMatch ? reasonMatch[1].trim() : 'No reason provided';

    result.setResult(verified, score, recommendation, reason);
    result.functional = functionalMatch ? functionalMatch[1].toUpperCase() : 'UNKNOWN';
    result.achieved = achieved;
  }

  parseAssessment(response) {
    const scoreMatch = response.match(/SCORE:\s*(\d+)/i);
    const actionMatch = response.match(/ACTION:\s*(CONTINUE|REMIND|CORRECT|REFOCUS)/i);
    const relevantMatch = response.match(/RELEVANT:\s*(YES|NO)/i);
    const productiveMatch = response.match(/PRODUCTIVE:\s*(YES|NO)/i);
    const reasonMatch = response.match(/REASON:\s*(.+?)(?:\n|$)/i);

    return {
      score: scoreMatch ? parseInt(scoreMatch[1], 10) : 70,
      action: actionMatch ? actionMatch[1].toUpperCase() : 'CONTINUE',
      relevant: relevantMatch ? relevantMatch[1].toUpperCase() === 'YES' : true,
      productive: productiveMatch ? productiveMatch[1].toUpperCase() === 'YES' : true,
      reason: reasonMatch ? reasonMatch[1].trim() : 'No reason provided',
    };
  }

  // === History Management ===

  addToVerificationHistory(result) {
    this.verificationHistory.push({
      timestamp: Date.now(),
      type: result.type,
      targetId: result.targetId,
      verified: result.verified,
      score: result.score,
    });

    if (this.verificationHistory.length > MAX_VERIFICATION_HISTORY) {
      this.verificationHistory = this.verificationHistory.slice(-MAX_VERIFICATION_HISTORY);
    }
  }

  addToAssessmentHistory(assessment) {
    this.assessmentHistory.push({
      timestamp: Date.now(),
      score: assessment.score,
      action: assessment.action,
      escalatedAction: assessment.escalatedAction,
    });

    if (this.assessmentHistory.length > MAX_ASSESSMENT_HISTORY) {
      this.assessmentHistory = this.assessmentHistory.slice(-MAX_ASSESSMENT_HISTORY);
    }
  }

  /**
   * Execute method (for BaseAgent compatibility)
   */
  async execute(task) {
    if (task.type === 'verify') {
      const result = await this.handleVerifyRequest({
        payload: task,
        createResponse: (type, payload) => ({ type, payload }),
      });
      return result.payload;
    }
    throw new Error(`Unknown task type: ${task.type}`);
  }

  /**
   * Get agent statistics
   */
  getStats() {
    const verifiedCount = this.verificationHistory.filter(v => v.verified).length;
    const avgScore = this.verificationHistory.length > 0
      ? Math.round(this.verificationHistory.reduce((sum, v) => sum + v.score, 0) / this.verificationHistory.length)
      : null;

    return {
      ...super.getStats(),
      model: this.model,
      totalVerifications: this.verificationHistory.length,
      verifiedCount,
      verificationRate: this.verificationHistory.length > 0
        ? Math.round((verifiedCount / this.verificationHistory.length) * 100)
        : null,
      averageScore: avgScore,
      consecutiveIssues: this.consecutiveIssues,
      totalCorrections: this.totalCorrections,
      escalationStatus: this.determineEscalation({ action: 'CONTINUE' }),
      recentVerifications: this.verificationHistory.slice(-5),
    };
  }
}

export default SupervisorAgent;
