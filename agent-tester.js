/**
 * Tester Agent - Validates implementations and generates fix plans
 *
 * This agent:
 * - Runs tests against implementations
 * - Writes additional tests for coverage
 * - Generates detailed fix plans for failures
 * - Hands off to supervisor for final verification
 */

import agentCore, { EventTypes } from './agent-core.js';
import agentExecutor from './agent-executor.js';

// Test status values
const TEST_STATUS = {
  PASSED: 'passed',
  FAILED: 'failed',
  BLOCKED: 'blocked'
};

// Issue severity levels
const SEVERITY = {
  CRITICAL: 'critical',
  MAJOR: 'major',
  MINOR: 'minor',
  SUGGESTION: 'suggestion'
};

// Tool definitions
const TESTER_TOOLS = [
  {
    name: 'testComplete',
    description: 'Signal test completion',
    params: [
      { name: 'status', type: 'string' },
      { name: 'testsRun', type: 'number' },
      { name: 'testsPassed', type: 'number' },
      { name: 'testsFailed', type: 'number' },
      { name: 'failures', type: 'array' },
      { name: 'coverage', type: 'number' },
      { name: 'fixPlan', type: 'string' },
      { name: 'blockReason', type: 'string' }
    ]
  }
];

/**
 * Tester Agent class
 */
export class TesterAgent {
  constructor(options = {}) {
    this.name = 'tester';
    this.model = options.model || 'opus';
    this.fallbackModel = options.fallbackModel || 'sonnet';

    // Register with agent core (allowExisting for resume scenarios)
    this.agent = agentCore.registerAgent(this.name, {
      model: this.model,
      subscribesTo: options.subscribesTo || ['supervisor', 'planner'],
      tools: TESTER_TOOLS,
      state: {
        testsRun: 0,
        testsPassed: 0,
        testsFailed: 0,
        fixPlansGenerated: 0,
        averageCoverage: 0
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
      // React to implementation completions
      if (event.type === EventTypes.OUTPUT_RECORDED &&
          event.object?.type === 'implementation' &&
          event.source === 'coder') {
        agentCore.addMemory(this.name, {
          content: `Implementation ready for testing: ${event.object.taskId}`,
          type: 'implementation_ready',
          metadata: { taskId: event.object.taskId }
        });
      }
    });
  }

  /**
   * Test an implementation
   * @param {object} task - Task being tested
   * @param {object} implementation - Implementation result from coder
   * @param {object} context - Test context
   */
  async test(task, implementation, context = {}) {
    const { goal } = context;

    const templateContext = {
      goal,
      task: {
        description: task.description,
        verificationCriteria: task.metadata?.verificationCriteria || []
      },
      implementation: {
        summary: implementation.summary,
        filesModified: implementation.filesModified || [],
        testsAdded: implementation.testsAdded || []
      }
    };

    const jsonSchema = {
      type: 'object',
      properties: {
        toolCall: {
          type: 'object',
          properties: {
            name: { type: 'string', const: 'testComplete' },
            arguments: {
              type: 'object',
              properties: {
                status: { type: 'string', enum: ['passed', 'failed', 'blocked'] },
                testsRun: { type: 'number', minimum: 0 },
                testsPassed: { type: 'number', minimum: 0 },
                testsFailed: { type: 'number', minimum: 0 },
                failures: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      testName: { type: 'string' },
                      file: { type: 'string' },
                      error: { type: 'string' },
                      stackTrace: { type: 'string' },
                      severity: { type: 'string', enum: ['critical', 'major', 'minor', 'suggestion'] }
                    },
                    required: ['testName', 'error']
                  }
                },
                coverage: { type: 'number', minimum: 0, maximum: 100 },
                fixPlan: { type: 'string' },
                blockReason: { type: 'string' }
              },
              required: ['status', 'testsRun', 'testsPassed', 'testsFailed']
            }
          },
          required: ['name', 'arguments']
        }
      },
      required: ['toolCall']
    };

    const result = await agentExecutor.executeWithTemplate(
      this.name,
      'tester/test.hbs',
      templateContext,
      {
        model: this.model,
        fallbackModel: this.fallbackModel,
        jsonSchema
      }
    );

    const testResult = this._parseTestResult(result);

    // Update state
    const newTestsRun = this.agent.state.testsRun + testResult.testsRun;
    const newTestsPassed = this.agent.state.testsPassed + testResult.testsPassed;
    const newTestsFailed = this.agent.state.testsFailed + testResult.testsFailed;

    agentCore.updateAgentState(this.name, {
      testsRun: newTestsRun,
      testsPassed: newTestsPassed,
      testsFailed: newTestsFailed,
      averageCoverage: this._updateAverageCoverage(testResult.coverage)
    });

    if (testResult.fixPlan) {
      agentCore.updateAgentState(this.name, {
        fixPlansGenerated: this.agent.state.fixPlansGenerated + 1
      });
    }

    // Record the output
    agentCore.recordOutput(this.name, {
      content: testResult,
      type: 'test_result',
      taskId: task.id,
      metadata: {
        status: testResult.status,
        testsRun: testResult.testsRun,
        testsPassed: testResult.testsPassed,
        testsFailed: testResult.testsFailed,
        coverage: testResult.coverage
      }
    });

    // Log the interaction
    agentCore.logInteraction(this.name, 'coder', {
      type: 'test_result',
      content: testResult
    });

    return testResult;
  }

  /**
   * Parse test result from structured output
   */
  _parseTestResult(result) {
    if (result.structuredOutput?.toolCall?.arguments) {
      return result.structuredOutput.toolCall.arguments;
    }

    if (result.toolCalls?.length > 0) {
      const toolCall = result.toolCalls.find(tc => tc.name === 'testComplete');
      if (toolCall) {
        return toolCall.arguments;
      }
    }

    // Fallback text parsing
    return this._parseTextTestResult(result.response);
  }

  /**
   * Fallback text parsing for test results
   */
  _parseTextTestResult(response) {
    const lowerResponse = response.toLowerCase();

    // Check status
    const passed = lowerResponse.includes('all tests pass') ||
                   lowerResponse.includes('tests passed') ||
                   lowerResponse.includes('passed:');

    const blocked = lowerResponse.includes('blocked') ||
                    lowerResponse.includes('cannot run');

    // Try to extract test counts
    const passedMatch = response.match(/(\d+)\s*(?:tests?\s*)?passed/i);
    const failedMatch = response.match(/(\d+)\s*(?:tests?\s*)?failed/i);
    const totalMatch = response.match(/(\d+)\s*tests?\s*(?:run|total)/i);

    const testsPassed = passedMatch ? parseInt(passedMatch[1]) : (passed ? 1 : 0);
    const testsFailed = failedMatch ? parseInt(failedMatch[1]) : (passed ? 0 : 1);
    const testsRun = totalMatch ? parseInt(totalMatch[1]) : testsPassed + testsFailed;

    // Extract coverage
    const coverageMatch = response.match(/(\d+(?:\.\d+)?)\s*%\s*coverage/i);
    const coverage = coverageMatch ? parseFloat(coverageMatch[1]) : 0;

    let status = TEST_STATUS.FAILED;
    if (passed && testsFailed === 0) status = TEST_STATUS.PASSED;
    if (blocked) status = TEST_STATUS.BLOCKED;

    return {
      status,
      testsRun,
      testsPassed,
      testsFailed,
      failures: testsFailed > 0 ? [{ testName: 'Unknown', error: 'See response for details' }] : [],
      coverage,
      fixPlan: testsFailed > 0 ? 'Review test output and fix failures' : undefined,
      blockReason: blocked ? 'Unable to run tests' : undefined
    };
  }

  /**
   * Update rolling average coverage
   */
  _updateAverageCoverage(newCoverage) {
    if (!newCoverage) return this.agent.state.averageCoverage;

    const currentAvg = this.agent.state.averageCoverage || 0;
    const testCount = Math.floor(this.agent.state.testsRun / 10) + 1; // Rough estimate of test runs

    // Weighted moving average
    return Math.round((currentAvg * (testCount - 1) + newCoverage) / testCount);
  }

  /**
   * Get agent statistics
   */
  getStats() {
    return {
      name: this.name,
      ...this.agent.state,
      passRate: this.agent.state.testsRun > 0
        ? Math.round(this.agent.state.testsPassed / this.agent.state.testsRun * 100) + '%'
        : 'N/A'
    };
  }
}

export default TesterAgent;
export { TEST_STATUS, SEVERITY };
