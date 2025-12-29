/**
 * Tester Agent Tests
 *
 * Comprehensive test suite for the TesterAgent class covering:
 * - Constructor and initialization
 * - Test result parsing
 * - Text fallback parsing
 * - Fix plan generation
 * - Quick check functionality
 * - Severity-based analysis
 * - State management
 * - Statistics
 */

import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert';
import agentCore from './agent-core.js';
import { TesterAgent, TEST_STATUS, SEVERITY } from './agent-tester.js';

describe('TesterAgent - Constants', () => {
  it('should export TEST_STATUS constants', () => {
    assert.strictEqual(TEST_STATUS.PASSED, 'passed');
    assert.strictEqual(TEST_STATUS.FAILED, 'failed');
    assert.strictEqual(TEST_STATUS.BLOCKED, 'blocked');
  });

  it('should export SEVERITY constants', () => {
    assert.strictEqual(SEVERITY.CRITICAL, 'critical');
    assert.strictEqual(SEVERITY.MAJOR, 'major');
    assert.strictEqual(SEVERITY.MINOR, 'minor');
    assert.strictEqual(SEVERITY.SUGGESTION, 'suggestion');
  });
});

describe('TesterAgent - Constructor and Initialization', () => {
  beforeEach(() => {
    agentCore.reset();
  });

  it('should create instance with default options', () => {
    const tester = new TesterAgent();

    assert.strictEqual(tester.name, 'tester');
    assert.strictEqual(tester.model, 'opus');
    assert.strictEqual(tester.fallbackModel, 'sonnet');
  });

  it('should create instance with custom options', () => {
    const tester = new TesterAgent({
      model: 'sonnet',
      fallbackModel: 'haiku',
      allowExisting: true
    });

    assert.strictEqual(tester.model, 'sonnet');
    assert.strictEqual(tester.fallbackModel, 'haiku');
  });

  it('should register agent with agent core', () => {
    const tester = new TesterAgent();

    const agent = agentCore.getAgent('tester');
    assert.ok(agent);
    assert.strictEqual(agent.name, 'tester');
    assert.strictEqual(agent.model, 'opus');
  });

  it('should initialize agent state correctly', () => {
    const tester = new TesterAgent();

    assert.strictEqual(tester.agent.state.testsRun, 0);
    assert.strictEqual(tester.agent.state.testsPassed, 0);
    assert.strictEqual(tester.agent.state.testsFailed, 0);
    assert.strictEqual(tester.agent.state.fixPlansGenerated, 0);
    assert.strictEqual(tester.agent.state.averageCoverage, 0);
  });

  it('should set up subscriptions to other agents', () => {
    const tester = new TesterAgent({
      subscribesTo: ['supervisor', 'planner']
    });

    assert.deepStrictEqual(tester.agent.subscribesTo, ['supervisor', 'planner']);
  });

  it('should register testComplete tool', () => {
    const tester = new TesterAgent();

    assert.ok(tester.agent.tools.some(t => t.name === 'testComplete'));
  });
});

describe('TesterAgent - Test Result Parsing', () => {
  let tester;

  beforeEach(() => {
    agentCore.reset();
    tester = new TesterAgent();
  });

  it('should parse test result from structuredOutput.toolCall.arguments', () => {
    const result = {
      structuredOutput: {
        toolCall: {
          name: 'testComplete',
          arguments: {
            status: 'passed',
            testsRun: 10,
            testsPassed: 10,
            testsFailed: 0,
            failures: [],
            coverage: 85
          }
        }
      }
    };

    const parsed = tester._parseTestResult(result);

    assert.strictEqual(parsed.status, 'passed');
    assert.strictEqual(parsed.testsRun, 10);
    assert.strictEqual(parsed.testsPassed, 10);
    assert.strictEqual(parsed.testsFailed, 0);
    assert.strictEqual(parsed.coverage, 85);
  });

  it('should parse test result from toolCalls array', () => {
    const result = {
      toolCalls: [
        {
          name: 'testComplete',
          arguments: {
            status: 'failed',
            testsRun: 5,
            testsPassed: 3,
            testsFailed: 2,
            failures: [{ testName: 'test1', error: 'Error' }]
          }
        }
      ]
    };

    const parsed = tester._parseTestResult(result);

    assert.strictEqual(parsed.status, 'failed');
    assert.strictEqual(parsed.testsFailed, 2);
    assert.strictEqual(parsed.failures.length, 1);
  });

  it('should fallback to text parsing when structured output unavailable', () => {
    const result = {
      response: '5 tests passed, 2 tests failed'
    };

    const parsed = tester._parseTestResult(result);

    assert.ok(parsed.status);
    assert.ok(parsed.testsRun >= 0);
  });
});

describe('TesterAgent - Text Test Result Parsing', () => {
  let tester;

  beforeEach(() => {
    agentCore.reset();
    tester = new TesterAgent();
  });

  it('should detect passed status from "all tests pass"', () => {
    const response = 'All tests pass successfully';

    const parsed = tester._parseTextTestResult(response);

    assert.strictEqual(parsed.status, TEST_STATUS.PASSED);
  });

  it('should detect passed status from "tests passed"', () => {
    const response = '10 tests passed';

    const parsed = tester._parseTextTestResult(response);

    assert.strictEqual(parsed.status, TEST_STATUS.PASSED);
  });

  it('should detect blocked status', () => {
    const response = 'Tests blocked due to missing dependencies';

    const parsed = tester._parseTextTestResult(response);

    assert.strictEqual(parsed.status, TEST_STATUS.BLOCKED);
    assert.ok(parsed.blockReason);
  });

  it('should detect blocked status from "cannot run"', () => {
    const response = 'Cannot run tests';

    const parsed = tester._parseTextTestResult(response);

    assert.strictEqual(parsed.status, TEST_STATUS.BLOCKED);
  });

  it('should extract test counts from text', () => {
    const response = '10 tests run, 8 passed, 2 failed';

    const parsed = tester._parseTextTestResult(response);

    assert.strictEqual(parsed.testsPassed, 8);
    assert.strictEqual(parsed.testsFailed, 2);
  });

  it('should extract coverage percentage', () => {
    const response = 'Code coverage: 75.5% coverage';

    const parsed = tester._parseTextTestResult(response);

    assert.strictEqual(parsed.coverage, 75.5);
  });

  it('should default to failed status when no clear pass indicator', () => {
    const response = 'Some tests encountered errors';

    const parsed = tester._parseTextTestResult(response);

    assert.strictEqual(parsed.status, TEST_STATUS.FAILED);
  });

  it('should include fix plan for failed tests', () => {
    const response = '2 tests failed';

    const parsed = tester._parseTextTestResult(response);

    assert.ok(parsed.fixPlan);
  });

  it('should have no fix plan for passed tests', () => {
    const response = 'All tests pass';

    const parsed = tester._parseTextTestResult(response);

    assert.strictEqual(parsed.fixPlan, undefined);
  });

  it('should create failure entry when tests failed', () => {
    const response = 'Some tests failed';

    const parsed = tester._parseTextTestResult(response);

    assert.ok(parsed.failures.length > 0);
  });
});

describe('TesterAgent - Average Coverage Update', () => {
  let tester;

  beforeEach(() => {
    agentCore.reset();
    tester = new TesterAgent();
  });

  it('should return current average when no new coverage', () => {
    tester.agent.state.averageCoverage = 80;

    const result = tester._updateAverageCoverage(null);

    assert.strictEqual(result, 80);
  });

  it('should return current average when coverage is 0', () => {
    tester.agent.state.averageCoverage = 80;

    const result = tester._updateAverageCoverage(0);

    assert.strictEqual(result, 80);
  });

  it('should calculate weighted moving average', () => {
    tester.agent.state.averageCoverage = 0;
    tester.agent.state.testsRun = 0;

    const result = tester._updateAverageCoverage(80);

    assert.ok(result > 0);
  });
});

describe('TesterAgent - Statistics', () => {
  let tester;

  beforeEach(() => {
    agentCore.reset();
    tester = new TesterAgent();
  });

  it('should return agent statistics', () => {
    const stats = tester.getStats();

    assert.strictEqual(stats.name, 'tester');
    assert.strictEqual(stats.testsRun, 0);
    assert.strictEqual(stats.testsPassed, 0);
    assert.strictEqual(stats.testsFailed, 0);
    assert.strictEqual(stats.fixPlansGenerated, 0);
    assert.strictEqual(stats.averageCoverage, 0);
    assert.strictEqual(stats.passRate, 'N/A');
  });

  it('should calculate pass rate when tests have run', () => {
    agentCore.updateAgentState('tester', {
      testsRun: 10,
      testsPassed: 8
    });

    const stats = tester.getStats();

    assert.strictEqual(stats.passRate, '80%');
  });

  it('should reflect updated state in statistics', () => {
    agentCore.updateAgentState('tester', {
      testsRun: 100,
      testsPassed: 95,
      testsFailed: 5,
      fixPlansGenerated: 3,
      averageCoverage: 85
    });

    const stats = tester.getStats();

    assert.strictEqual(stats.testsRun, 100);
    assert.strictEqual(stats.testsPassed, 95);
    assert.strictEqual(stats.testsFailed, 5);
    assert.strictEqual(stats.fixPlansGenerated, 3);
    assert.strictEqual(stats.averageCoverage, 85);
  });
});

describe('TesterAgent - Tool Definitions', () => {
  let tester;

  beforeEach(() => {
    agentCore.reset();
    tester = new TesterAgent();
  });

  it('should have testComplete tool with correct params', () => {
    const testTool = tester.agent.tools.find(t => t.name === 'testComplete');

    assert.ok(testTool);
    assert.ok(testTool.params.some(p => p.name === 'status'));
    assert.ok(testTool.params.some(p => p.name === 'testsRun'));
    assert.ok(testTool.params.some(p => p.name === 'testsPassed'));
    assert.ok(testTool.params.some(p => p.name === 'testsFailed'));
    assert.ok(testTool.params.some(p => p.name === 'failures'));
    assert.ok(testTool.params.some(p => p.name === 'coverage'));
    assert.ok(testTool.params.some(p => p.name === 'fixPlan'));
    assert.ok(testTool.params.some(p => p.name === 'blockReason'));
  });
});

describe('TesterAgent - Allow Existing Registration', () => {
  beforeEach(() => {
    agentCore.reset();
  });

  it('should allow re-registration with allowExisting option', () => {
    new TesterAgent();

    // Should not throw
    assert.doesNotThrow(() => {
      new TesterAgent({ allowExisting: true });
    });
  });

  it('should throw when re-registering without allowExisting', () => {
    new TesterAgent();

    assert.throws(() => {
      new TesterAgent();
    }, /already registered/);
  });
});
