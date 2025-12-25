/**
 * Supervisor Agent - Critiques and verifies output from other agents
 *
 * This agent ensures:
 * - Work aligns with the stated goal
 * - Results are verifiable with evidence
 * - No gaps in implementation
 * - Quality standards are met
 */

import agentCore, { EventTypes } from './agent-core.js';
import agentExecutor from './agent-executor.js';

// Quality thresholds for verification
const QUALITY_THRESHOLDS = {
  APPROVE: 70,
  REVISE: 50,
  REJECT: 30
};

// Escalation levels
const ESCALATION_LEVELS = {
  NONE: 'none',         // Score 70+
  REMIND: 'remind',     // Score 50-69
  CORRECT: 'correct',   // Score 30-49
  REFOCUS: 'refocus',   // Score <30
  CRITICAL: 'critical', // 4+ issues
  ABORT: 'abort'        // 5+ issues
};

// Verification types
const VERIFICATION_TYPES = {
  PLAN: 'plan',
  CODE: 'code',
  TEST: 'test',
  STEP: 'step',
  GOAL: 'goal',
  PROGRESS: 'progress'
};

// Tool definitions for structured responses
const SUPERVISOR_TOOLS = [
  {
    name: 'verificationComplete',
    description: 'Signal completion of verification',
    params: [
      { name: 'score', type: 'number' },
      { name: 'approved', type: 'boolean' },
      { name: 'completeness', type: 'string' },
      { name: 'issues', type: 'array' },
      { name: 'missingElements', type: 'array' },
      { name: 'risks', type: 'array' },
      { name: 'recommendation', type: 'string' },
      { name: 'feedback', type: 'string' },
      { name: 'escalationLevel', type: 'string' }
    ]
  },
  {
    name: 'progressAssessment',
    description: 'Signal completion of progress assessment',
    params: [
      { name: 'onTrack', type: 'boolean' },
      { name: 'percentComplete', type: 'number' },
      { name: 'healthScore', type: 'number' },
      { name: 'concerns', type: 'array' },
      { name: 'recommendations', type: 'array' },
      { name: 'continueExecution', type: 'boolean' },
      { name: 'abortReason', type: 'string' }
    ]
  }
];

/**
 * Supervisor Agent class
 */
export class SupervisorAgent {
  constructor(options = {}) {
    this.name = 'supervisor';
    this.model = options.model || 'opus';
    this.fallbackModel = options.fallbackModel || 'sonnet';

    // Register with agent core
    this.agent = agentCore.registerAgent(this.name, {
      model: this.model,
      subscribesTo: options.subscribesTo || ['planner', 'coder', 'tester'],
      tools: SUPERVISOR_TOOLS,
      state: {
        verificationsPerformed: 0,
        approvalsGiven: 0,
        rejectionsGiven: 0,
        escalationCount: 0
      }
    });

    // Subscribe to other agents' events
    this._setupSubscriptions();
  }

  /**
   * Set up event subscriptions
   */
  _setupSubscriptions() {
    const subscribedAgents = this.agent.subscribesTo;

    agentCore.subscribeToAgents(this.name, subscribedAgents, (event) => {
      // Log all interactions from subscribed agents
      if (event.source !== this.name && event.source !== 'core') {
        agentCore.addMemory(this.name, {
          content: `Observed event from ${event.source}: ${event.type}`,
          type: 'observation',
          metadata: { eventType: event.type, source: event.source }
        });
      }
    });
  }

  /**
   * Verify output from another agent
   * @param {string} sourceAgent - Agent that produced the output
   * @param {string} verificationType - Type of verification
   * @param {object} context - Verification context
   */
  async verify(sourceAgent, verificationType, context) {
    const { goal, task, agentOutput, previousFeedback, attemptNumber } = context;

    // Record this verification attempt
    agentCore.updateAgentState(this.name, {
      verificationsPerformed: this.agent.state.verificationsPerformed + 1
    });

    // Prepare template context
    const templateContext = {
      goal,
      verificationType,
      task,
      sourceAgent,
      agentOutput: typeof agentOutput === 'string' ? agentOutput : JSON.stringify(agentOutput, null, 2),
      previousFeedback,
      attemptNumber: attemptNumber || 1
    };

    // Build JSON schema for structured response
    const jsonSchema = {
      type: 'object',
      properties: {
        toolCall: {
          type: 'object',
          properties: {
            name: { type: 'string', const: 'verificationComplete' },
            arguments: {
              type: 'object',
              properties: {
                score: { type: 'number', minimum: 0, maximum: 100 },
                approved: { type: 'boolean' },
                completeness: { type: 'string', enum: ['complete', 'partial', 'insufficient'] },
                issues: { type: 'array', items: { type: 'string' } },
                missingElements: { type: 'array', items: { type: 'string' } },
                risks: { type: 'array', items: { type: 'string' } },
                recommendation: { type: 'string', enum: ['approve', 'revise', 'reject'] },
                feedback: { type: 'string' },
                escalationLevel: {
                  type: 'string',
                  enum: ['none', 'remind', 'correct', 'refocus', 'critical', 'abort']
                }
              },
              required: ['score', 'approved', 'recommendation', 'feedback']
            }
          },
          required: ['name', 'arguments']
        }
      },
      required: ['toolCall']
    };

    // Execute verification
    const result = await agentExecutor.executeWithTemplate(
      this.name,
      'supervisor/verify.hbs',
      templateContext,
      {
        model: this.model,
        fallbackModel: this.fallbackModel,
        jsonSchema
      }
    );

    // Parse the structured output
    const verification = this._parseVerificationResult(result);

    // Update agent state based on result
    if (verification.approved) {
      agentCore.updateAgentState(this.name, {
        approvalsGiven: this.agent.state.approvalsGiven + 1
      });
    } else {
      agentCore.updateAgentState(this.name, {
        rejectionsGiven: this.agent.state.rejectionsGiven + 1
      });
    }

    if (verification.escalationLevel !== 'none') {
      agentCore.updateAgentState(this.name, {
        escalationCount: this.agent.state.escalationCount + 1
      });
    }

    // Record the output
    agentCore.recordOutput(this.name, {
      content: verification,
      type: 'verification',
      metadata: {
        sourceAgent,
        verificationType,
        score: verification.score,
        approved: verification.approved
      }
    });

    // Log the interaction
    agentCore.logInteraction(this.name, sourceAgent, {
      type: 'verification',
      content: verification,
      toolCalls: result.toolCalls || []
    });

    return verification;
  }

  /**
   * Assess overall progress toward goal
   * @param {object} context - Progress context
   */
  async assessProgress(context) {
    const {
      goal,
      totalTasks,
      completedTasks,
      inProgressTasks,
      failedTasks,
      elapsedTime,
      recentEvents,
      blockers
    } = context;

    const templateContext = {
      goal,
      totalTasks,
      completedTasks,
      inProgressTasks,
      failedTasks,
      elapsedTime,
      recentEvents,
      blockers
    };

    const jsonSchema = {
      type: 'object',
      properties: {
        toolCall: {
          type: 'object',
          properties: {
            name: { type: 'string', const: 'progressAssessment' },
            arguments: {
              type: 'object',
              properties: {
                onTrack: { type: 'boolean' },
                percentComplete: { type: 'number', minimum: 0, maximum: 100 },
                healthScore: { type: 'number', minimum: 0, maximum: 100 },
                concerns: { type: 'array', items: { type: 'string' } },
                recommendations: { type: 'array', items: { type: 'string' } },
                continueExecution: { type: 'boolean' },
                abortReason: { type: 'string' }
              },
              required: ['onTrack', 'percentComplete', 'healthScore', 'continueExecution']
            }
          },
          required: ['name', 'arguments']
        }
      },
      required: ['toolCall']
    };

    const result = await agentExecutor.executeWithTemplate(
      this.name,
      'supervisor/progress.hbs',
      templateContext,
      {
        model: this.model,
        fallbackModel: this.fallbackModel,
        jsonSchema
      }
    );

    const assessment = this._parseProgressResult(result);

    // Record the assessment
    agentCore.recordOutput(this.name, {
      content: assessment,
      type: 'progress_assessment',
      metadata: {
        healthScore: assessment.healthScore,
        onTrack: assessment.onTrack
      }
    });

    return assessment;
  }

  /**
   * Parse verification result from structured output
   */
  _parseVerificationResult(result) {
    // Try to extract from structured output first
    if (result.structuredOutput?.toolCall?.arguments) {
      return result.structuredOutput.toolCall.arguments;
    }

    if (result.toolCalls?.length > 0) {
      const toolCall = result.toolCalls.find(tc => tc.name === 'verificationComplete');
      if (toolCall) {
        return toolCall.arguments;
      }
    }

    // Fallback: try to parse from raw response
    return this._parseTextResponse(result.response, 'verification');
  }

  /**
   * Parse progress result from structured output
   */
  _parseProgressResult(result) {
    if (result.structuredOutput?.toolCall?.arguments) {
      return result.structuredOutput.toolCall.arguments;
    }

    if (result.toolCalls?.length > 0) {
      const toolCall = result.toolCalls.find(tc => tc.name === 'progressAssessment');
      if (toolCall) {
        return toolCall.arguments;
      }
    }

    return this._parseTextResponse(result.response, 'progress');
  }

  /**
   * Fallback text parsing (should rarely be needed with JSON schema)
   */
  _parseTextResponse(response, type) {
    // Extract score
    const scoreMatch = response.match(/score[:\s]+(\d+)/i);
    const score = scoreMatch ? parseInt(scoreMatch[1]) : 50;

    // Extract approved/passed
    const approvedMatch = response.match(/(approved|passed|accept)[:\s]+(yes|true|no|false)/i);
    const approved = approvedMatch ? ['yes', 'true'].includes(approvedMatch[2].toLowerCase()) : score >= QUALITY_THRESHOLDS.APPROVE;

    if (type === 'verification') {
      return {
        score,
        approved,
        completeness: score >= 70 ? 'complete' : score >= 50 ? 'partial' : 'insufficient',
        issues: [],
        missingElements: [],
        risks: [],
        recommendation: score >= QUALITY_THRESHOLDS.APPROVE ? 'approve' : score >= QUALITY_THRESHOLDS.REVISE ? 'revise' : 'reject',
        feedback: response.substring(0, 500),
        escalationLevel: this._determineEscalation(score, [])
      };
    }

    return {
      onTrack: score >= 50,
      percentComplete: Math.min(score, 100),
      healthScore: score,
      concerns: [],
      recommendations: [],
      continueExecution: score >= QUALITY_THRESHOLDS.REJECT,
      abortReason: score < QUALITY_THRESHOLDS.REJECT ? 'Score too low' : undefined
    };
  }

  /**
   * Determine escalation level based on score and issues
   */
  _determineEscalation(score, issues) {
    const issueCount = issues?.length || 0;

    if (issueCount >= 5) return ESCALATION_LEVELS.ABORT;
    if (issueCount >= 4) return ESCALATION_LEVELS.CRITICAL;
    if (score < 30 || issueCount >= 3) return ESCALATION_LEVELS.REFOCUS;
    if (score < 50 || issueCount >= 2) return ESCALATION_LEVELS.CORRECT;
    if (score < 70) return ESCALATION_LEVELS.REMIND;
    return ESCALATION_LEVELS.NONE;
  }

  /**
   * Get agent statistics
   */
  getStats() {
    return {
      name: this.name,
      ...this.agent.state,
      approvalRate: this.agent.state.verificationsPerformed > 0
        ? (this.agent.state.approvalsGiven / this.agent.state.verificationsPerformed * 100).toFixed(1) + '%'
        : 'N/A'
    };
  }
}

export default SupervisorAgent;
export { QUALITY_THRESHOLDS, ESCALATION_LEVELS, VERIFICATION_TYPES };
