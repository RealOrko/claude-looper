/**
 * Coder Agent - Implements tasks to high standards
 *
 * This agent:
 * - Implements programming tasks
 * - Writes tests for implementations
 * - Applies fixes based on tester feedback
 * - Can request clarification from planner
 */

import agentCore, { EventTypes } from './agent-core.js';
import agentExecutor from './agent-executor.js';

// Implementation status values
const IMPL_STATUS = {
  COMPLETE: 'complete',
  BLOCKED: 'blocked',
  NEEDS_CLARIFICATION: 'needs_clarification'
};

// Fix status values
const FIX_STATUS = {
  FIXED: 'fixed',
  STILL_FAILING: 'still_failing',
  BLOCKED: 'blocked'
};

// Tool definitions
const CODER_TOOLS = [
  {
    name: 'implementationComplete',
    description: 'Signal implementation complete',
    params: [
      { name: 'status', type: 'string' },
      { name: 'summary', type: 'string' },
      { name: 'filesModified', type: 'array' },
      { name: 'testsAdded', type: 'array' },
      { name: 'commands', type: 'array' },
      { name: 'blockReason', type: 'string' }
    ]
  },
  {
    name: 'fixComplete',
    description: 'Signal fix attempt complete',
    params: [
      { name: 'status', type: 'string' },
      { name: 'summary', type: 'string' },
      { name: 'filesModified', type: 'array' },
      { name: 'testsRun', type: 'boolean' },
      { name: 'testsPass', type: 'boolean' },
      { name: 'remainingIssues', type: 'array' },
      { name: 'blockReason', type: 'string' }
    ]
  }
];

/**
 * Coder Agent class
 */
export class CoderAgent {
  constructor(options = {}) {
    this.name = 'coder';
    this.model = options.model || 'opus';
    this.fallbackModel = options.fallbackModel || 'sonnet';

    // Register with agent core (allowExisting for resume scenarios)
    this.agent = agentCore.registerAgent(this.name, {
      model: this.model,
      subscribesTo: options.subscribesTo || ['supervisor', 'planner'],
      tools: CODER_TOOLS,
      state: {
        tasksImplemented: 0,
        fixesApplied: 0,
        linesOfCode: 0,
        testsWritten: 0,
        blockedCount: 0
      },
      allowExisting: options.allowExisting || false
    });

    // Set up subscriptions
    this._setupSubscriptions();
  }

  /**
   * Set up event subscriptions
   */
  _setupSubscriptions() {
    const subscribedAgents = this.agent.subscribesTo;

    agentCore.subscribeToAgents(this.name, subscribedAgents, (event) => {
      // React to task assignments
      if (event.type === EventTypes.TASK_UPDATED && event.object?.status === 'in_progress') {
        agentCore.addMemory(this.name, {
          content: `Task assigned: ${event.object?.description}`,
          type: 'task_assignment',
          metadata: { taskId: event.object?.id }
        });
      }
    });
  }

  /**
   * Implement a task
   * @param {object} task - Task to implement
   * @param {object} context - Implementation context
   */
  async implement(task, context = {}) {
    const { goal, completedTasks, codeContext, previousAttempts } = context;

    const templateContext = {
      goal,
      task: {
        description: task.description,
        verificationCriteria: task.metadata?.verificationCriteria || []
      },
      completedTasks: completedTasks?.map(t => ({
        description: t.description,
        status: t.status
      })),
      codeContext,
      // Include previous attempts so coder can learn from supervisor feedback
      previousAttempts: previousAttempts?.map(a => ({
        attemptNumber: a.attemptNumber,
        approach: a.approach,
        result: a.result,
        feedback: a.error // supervisor feedback is stored in error field
      }))
    };

    const jsonSchema = {
      type: 'object',
      properties: {
        toolCall: {
          type: 'object',
          properties: {
            name: { type: 'string', const: 'implementationComplete' },
            arguments: {
              type: 'object',
              properties: {
                status: { type: 'string', enum: ['complete', 'blocked', 'needs_clarification'] },
                summary: { type: 'string' },
                filesModified: { type: 'array', items: { type: 'string' } },
                testsAdded: { type: 'array', items: { type: 'string' } },
                commands: { type: 'array', items: { type: 'string' } },
                blockReason: { type: 'string' }
              },
              required: ['status', 'summary']
            }
          },
          required: ['name', 'arguments']
        }
      },
      required: ['toolCall']
    };

    const result = await agentExecutor.executeWithTemplate(
      this.name,
      'coder/implement.hbs',
      templateContext,
      {
        model: this.model,
        fallbackModel: this.fallbackModel,
        jsonSchema,
        timeout: 60 * 60 * 1000, // 1 hour for task implementations
        taskId: task.id,
        goalId: task.parentGoalId || null
      }
    );

    const implementation = this._parseImplementationResult(result);

    // Update state
    agentCore.updateAgentState(this.name, {
      tasksImplemented: this.agent.state.tasksImplemented + 1,
      testsWritten: this.agent.state.testsWritten + (implementation.testsAdded?.length || 0)
    });

    if (implementation.status === IMPL_STATUS.BLOCKED) {
      agentCore.updateAgentState(this.name, {
        blockedCount: this.agent.state.blockedCount + 1
      });
    }

    // Record the output
    agentCore.recordOutput(this.name, {
      content: implementation,
      type: 'implementation',
      taskId: task.id,
      metadata: {
        status: implementation.status,
        filesCount: implementation.filesModified?.length || 0
      }
    });

    // Log the interaction
    agentCore.logInteraction(this.name, 'planner', {
      type: 'implementation_result',
      content: implementation
    });

    return implementation;
  }

  /**
   * Apply a fix based on test failures
   * @param {object} task - Task being fixed
   * @param {object} testResult - Test result with failures
   * @param {number} fixCycle - Current fix attempt number
   * @param {number} maxFixCycles - Maximum fix attempts
   */
  async applyFix(task, testResult, fixCycle = 1, maxFixCycles = 3) {
    const templateContext = {
      task: {
        description: task.description
      },
      failures: testResult.failures || [],
      fixPlan: testResult.fixPlan,
      fixCycle,
      maxFixCycles,
      previousFixes: task.metadata?.previousFixes || []
    };

    const jsonSchema = {
      type: 'object',
      properties: {
        toolCall: {
          type: 'object',
          properties: {
            name: { type: 'string', const: 'fixComplete' },
            arguments: {
              type: 'object',
              properties: {
                status: { type: 'string', enum: ['fixed', 'still_failing', 'blocked'] },
                summary: { type: 'string' },
                filesModified: { type: 'array', items: { type: 'string' } },
                testsRun: { type: 'boolean' },
                testsPass: { type: 'boolean' },
                remainingIssues: { type: 'array', items: { type: 'string' } },
                blockReason: { type: 'string' }
              },
              required: ['status', 'summary']
            }
          },
          required: ['name', 'arguments']
        }
      },
      required: ['toolCall']
    };

    const result = await agentExecutor.executeWithTemplate(
      this.name,
      'coder/fix.hbs',
      templateContext,
      {
        model: this.model,
        fallbackModel: this.fallbackModel,
        jsonSchema,
        taskId: task.id,
        goalId: task.parentGoalId || null
      }
    );

    const fix = this._parseFixResult(result);

    // Update state
    agentCore.updateAgentState(this.name, {
      fixesApplied: this.agent.state.fixesApplied + 1
    });

    // Record the output
    agentCore.recordOutput(this.name, {
      content: fix,
      type: 'fix',
      taskId: task.id,
      metadata: {
        status: fix.status,
        fixCycle,
        testsPass: fix.testsPass
      }
    });

    // Log the interaction
    agentCore.logInteraction(this.name, 'tester', {
      type: 'fix_result',
      content: fix
    });

    return fix;
  }

  /**
   * Request clarification from planner
   * @param {object} task - Task needing clarification
   * @param {string} question - Clarification question
   */
  async requestClarification(task, question) {
    const clarification = {
      taskId: task.id,
      taskDescription: task.description,
      question,
      timestamp: Date.now()
    };

    // Log the interaction
    agentCore.logInteraction(this.name, 'planner', {
      type: 'clarification_request',
      content: clarification
    });

    // Add to memory
    agentCore.addMemory(this.name, {
      content: `Requested clarification for task ${task.id}: ${question}`,
      type: 'clarification',
      metadata: clarification
    });

    return clarification;
  }

  /**
   * Parse implementation result from structured output
   */
  _parseImplementationResult(result) {
    if (result.structuredOutput?.toolCall?.arguments) {
      return result.structuredOutput.toolCall.arguments;
    }

    if (result.toolCalls?.length > 0) {
      const toolCall = result.toolCalls.find(tc => tc.name === 'implementationComplete');
      if (toolCall) {
        return toolCall.arguments;
      }
    }

    // Fallback text parsing
    return this._parseTextImplementation(result.response);
  }

  /**
   * Parse fix result from structured output
   */
  _parseFixResult(result) {
    if (result.structuredOutput?.toolCall?.arguments) {
      return result.structuredOutput.toolCall.arguments;
    }

    if (result.toolCalls?.length > 0) {
      const toolCall = result.toolCalls.find(tc => tc.name === 'fixComplete');
      if (toolCall) {
        return toolCall.arguments;
      }
    }

    return this._parseTextFix(result.response);
  }

  /**
   * Fallback text parsing for implementation
   */
  _parseTextImplementation(response) {
    const lowerResponse = response.toLowerCase();

    // Check for blocked indicators
    const isBlocked = lowerResponse.includes('blocked') ||
                      lowerResponse.includes('cannot proceed') ||
                      lowerResponse.includes('unable to');

    // Extract file paths
    const fileMatches = response.match(/[`'"]([\w\-./]+\.[a-zA-Z]+)[`'"]/g) || [];
    const filesModified = fileMatches.map(m => m.replace(/[`'"]/g, ''));

    // Extract test files
    const testsAdded = filesModified.filter(f =>
      f.includes('test') || f.includes('spec') || f.includes('.test.')
    );

    return {
      status: isBlocked ? IMPL_STATUS.BLOCKED : IMPL_STATUS.COMPLETE,
      summary: response.substring(0, 500),
      filesModified,
      testsAdded,
      commands: [],
      blockReason: isBlocked ? 'Unable to complete implementation' : undefined
    };
  }

  /**
   * Fallback text parsing for fix
   */
  _parseTextFix(response) {
    const lowerResponse = response.toLowerCase();

    const isFixed = lowerResponse.includes('fixed') ||
                    lowerResponse.includes('tests pass') ||
                    lowerResponse.includes('resolved');

    const isBlocked = lowerResponse.includes('blocked') ||
                      lowerResponse.includes('cannot fix');

    let status = FIX_STATUS.STILL_FAILING;
    if (isFixed) status = FIX_STATUS.FIXED;
    if (isBlocked) status = FIX_STATUS.BLOCKED;

    return {
      status,
      summary: response.substring(0, 500),
      filesModified: [],
      testsRun: true,
      testsPass: isFixed,
      remainingIssues: isFixed ? [] : ['Unable to determine remaining issues'],
      blockReason: isBlocked ? 'Unable to apply fix' : undefined
    };
  }

  /**
   * Get agent statistics
   */
  getStats() {
    return {
      name: this.name,
      ...this.agent.state
    };
  }
}

export default CoderAgent;
export { IMPL_STATUS, FIX_STATUS };
