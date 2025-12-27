/**
 * Coder Agent Tests
 *
 * Comprehensive test suite for the CoderAgent class covering:
 * - Constructor and initialization
 * - Implementation result parsing
 * - Fix result parsing
 * - Text fallback parsing
 * - State management
 * - Clarification requests
 * - Statistics
 */

import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert';
import agentCore from './agent-core.js';
import { CoderAgent, IMPL_STATUS, FIX_STATUS } from './agent-coder.js';

describe('CoderAgent - Constants', () => {
  it('should export IMPL_STATUS constants', () => {
    assert.strictEqual(IMPL_STATUS.COMPLETE, 'complete');
    assert.strictEqual(IMPL_STATUS.BLOCKED, 'blocked');
    assert.strictEqual(IMPL_STATUS.NEEDS_CLARIFICATION, 'needs_clarification');
  });

  it('should export FIX_STATUS constants', () => {
    assert.strictEqual(FIX_STATUS.FIXED, 'fixed');
    assert.strictEqual(FIX_STATUS.STILL_FAILING, 'still_failing');
    assert.strictEqual(FIX_STATUS.BLOCKED, 'blocked');
  });
});

describe('CoderAgent - Constructor and Initialization', () => {
  beforeEach(() => {
    agentCore.reset();
  });

  it('should create instance with default options', () => {
    const coder = new CoderAgent();

    assert.strictEqual(coder.name, 'coder');
    assert.strictEqual(coder.model, 'opus');
    assert.strictEqual(coder.fallbackModel, 'sonnet');
  });

  it('should create instance with custom options', () => {
    const coder = new CoderAgent({
      model: 'sonnet',
      fallbackModel: 'haiku',
      allowExisting: true
    });

    assert.strictEqual(coder.model, 'sonnet');
    assert.strictEqual(coder.fallbackModel, 'haiku');
  });

  it('should register agent with agent core', () => {
    const coder = new CoderAgent();

    const agent = agentCore.getAgent('coder');
    assert.ok(agent);
    assert.strictEqual(agent.name, 'coder');
    assert.strictEqual(agent.model, 'opus');
  });

  it('should initialize agent state correctly', () => {
    const coder = new CoderAgent();

    assert.strictEqual(coder.agent.state.tasksImplemented, 0);
    assert.strictEqual(coder.agent.state.fixesApplied, 0);
    assert.strictEqual(coder.agent.state.linesOfCode, 0);
    assert.strictEqual(coder.agent.state.testsWritten, 0);
    assert.strictEqual(coder.agent.state.blockedCount, 0);
  });

  it('should set up subscriptions to other agents', () => {
    const coder = new CoderAgent({
      subscribesTo: ['supervisor', 'planner']
    });

    assert.deepStrictEqual(coder.agent.subscribesTo, ['supervisor', 'planner']);
  });

  it('should register tools with agent core', () => {
    const coder = new CoderAgent();

    assert.ok(coder.agent.tools.length > 0);
    assert.ok(coder.agent.tools.some(t => t.name === 'implementationComplete'));
    assert.ok(coder.agent.tools.some(t => t.name === 'fixComplete'));
  });
});

describe('CoderAgent - Implementation Result Parsing', () => {
  let coder;

  beforeEach(() => {
    agentCore.reset();
    coder = new CoderAgent();
  });

  it('should parse implementation from structuredOutput.toolCall.arguments', () => {
    const result = {
      structuredOutput: {
        toolCall: {
          name: 'implementationComplete',
          arguments: {
            status: 'complete',
            summary: 'Implementation done',
            filesModified: ['src/index.js', 'src/utils.js'],
            testsAdded: ['test/index.test.js'],
            commands: ['npm install']
          }
        }
      }
    };

    const parsed = coder._parseImplementationResult(result);

    assert.strictEqual(parsed.status, 'complete');
    assert.strictEqual(parsed.summary, 'Implementation done');
    assert.deepStrictEqual(parsed.filesModified, ['src/index.js', 'src/utils.js']);
    assert.deepStrictEqual(parsed.testsAdded, ['test/index.test.js']);
  });

  it('should parse implementation from toolCalls array', () => {
    const result = {
      toolCalls: [
        {
          name: 'implementationComplete',
          arguments: {
            status: 'complete',
            summary: 'From toolCalls',
            filesModified: ['file.js']
          }
        }
      ]
    };

    const parsed = coder._parseImplementationResult(result);

    assert.strictEqual(parsed.summary, 'From toolCalls');
  });

  it('should fallback to text parsing when structured output unavailable', () => {
    const result = {
      response: 'Implementation completed. Modified `src/main.js` and `src/helper.js`.'
    };

    const parsed = coder._parseImplementationResult(result);

    assert.ok(parsed.status);
    assert.ok(parsed.summary);
  });
});

describe('CoderAgent - Text Implementation Parsing', () => {
  let coder;

  beforeEach(() => {
    agentCore.reset();
    coder = new CoderAgent();
  });

  it('should detect complete status from text', () => {
    const response = 'Successfully implemented the feature. All done.';

    const parsed = coder._parseTextImplementation(response);

    assert.strictEqual(parsed.status, IMPL_STATUS.COMPLETE);
  });

  it('should detect blocked status from text', () => {
    const response = 'Implementation blocked due to missing dependencies';

    const parsed = coder._parseTextImplementation(response);

    assert.strictEqual(parsed.status, IMPL_STATUS.BLOCKED);
    assert.ok(parsed.blockReason);
  });

  it('should detect blocked status from "cannot proceed"', () => {
    const response = 'Cannot proceed with the implementation';

    const parsed = coder._parseTextImplementation(response);

    assert.strictEqual(parsed.status, IMPL_STATUS.BLOCKED);
  });

  it('should detect blocked status from "unable to"', () => {
    const response = 'Unable to complete the task';

    const parsed = coder._parseTextImplementation(response);

    assert.strictEqual(parsed.status, IMPL_STATUS.BLOCKED);
  });

  it('should extract file paths from text', () => {
    const response = 'Modified `src/index.js` and "lib/helper.js" files';

    const parsed = coder._parseTextImplementation(response);

    assert.ok(parsed.filesModified.includes('src/index.js'));
    assert.ok(parsed.filesModified.includes('lib/helper.js'));
  });

  it('should identify test files from modified files', () => {
    const response = 'Created `test/feature.test.js` and `spec/helper.spec.js`';

    const parsed = coder._parseTextImplementation(response);

    assert.ok(parsed.testsAdded.includes('test/feature.test.js'));
    assert.ok(parsed.testsAdded.includes('spec/helper.spec.js'));
  });

  it('should truncate long summaries to 500 characters', () => {
    const response = 'A'.repeat(1000);

    const parsed = coder._parseTextImplementation(response);

    assert.strictEqual(parsed.summary.length, 500);
  });
});

describe('CoderAgent - Fix Result Parsing', () => {
  let coder;

  beforeEach(() => {
    agentCore.reset();
    coder = new CoderAgent();
  });

  it('should parse fix from structuredOutput.toolCall.arguments', () => {
    const result = {
      structuredOutput: {
        toolCall: {
          name: 'fixComplete',
          arguments: {
            status: 'fixed',
            summary: 'Bug fixed',
            filesModified: ['src/bug.js'],
            testsRun: true,
            testsPass: true,
            remainingIssues: []
          }
        }
      }
    };

    const parsed = coder._parseFixResult(result);

    assert.strictEqual(parsed.status, 'fixed');
    assert.strictEqual(parsed.testsPass, true);
    assert.deepStrictEqual(parsed.remainingIssues, []);
  });

  it('should parse fix from toolCalls array', () => {
    const result = {
      toolCalls: [
        {
          name: 'fixComplete',
          arguments: {
            status: 'still_failing',
            summary: 'From toolCalls',
            remainingIssues: ['Issue 1']
          }
        }
      ]
    };

    const parsed = coder._parseFixResult(result);

    assert.strictEqual(parsed.status, 'still_failing');
    assert.deepStrictEqual(parsed.remainingIssues, ['Issue 1']);
  });

  it('should fallback to text parsing when structured output unavailable', () => {
    const result = {
      response: 'The tests now pass after the fix.'
    };

    const parsed = coder._parseFixResult(result);

    assert.ok(parsed.status);
  });
});

describe('CoderAgent - Text Fix Parsing', () => {
  let coder;

  beforeEach(() => {
    agentCore.reset();
    coder = new CoderAgent();
  });

  it('should detect fixed status from "fixed"', () => {
    const response = 'Bug fixed successfully';

    const parsed = coder._parseTextFix(response);

    assert.strictEqual(parsed.status, FIX_STATUS.FIXED);
    assert.strictEqual(parsed.testsPass, true);
  });

  it('should detect fixed status from "tests pass"', () => {
    const response = 'All tests pass now';

    const parsed = coder._parseTextFix(response);

    assert.strictEqual(parsed.status, FIX_STATUS.FIXED);
  });

  it('should detect fixed status from "resolved"', () => {
    const response = 'Issue resolved';

    const parsed = coder._parseTextFix(response);

    assert.strictEqual(parsed.status, FIX_STATUS.FIXED);
  });

  it('should detect blocked status from "blocked"', () => {
    const response = 'Fix blocked by external dependency';

    const parsed = coder._parseTextFix(response);

    assert.strictEqual(parsed.status, FIX_STATUS.BLOCKED);
    assert.ok(parsed.blockReason);
  });

  it('should detect blocked status from "cannot fix"', () => {
    const response = 'Cannot fix this issue';

    const parsed = coder._parseTextFix(response);

    assert.strictEqual(parsed.status, FIX_STATUS.BLOCKED);
  });

  it('should default to still_failing status', () => {
    const response = 'Made some changes but not sure if it works';

    const parsed = coder._parseTextFix(response);

    assert.strictEqual(parsed.status, FIX_STATUS.STILL_FAILING);
    assert.strictEqual(parsed.testsPass, false);
  });

  it('should set testsRun to true', () => {
    const response = 'Test output here';

    const parsed = coder._parseTextFix(response);

    assert.strictEqual(parsed.testsRun, true);
  });

  it('should have remaining issues when not fixed', () => {
    const response = 'Still failing';

    const parsed = coder._parseTextFix(response);

    assert.ok(parsed.remainingIssues.length > 0);
  });

  it('should have empty remaining issues when fixed', () => {
    const response = 'All tests pass';

    const parsed = coder._parseTextFix(response);

    assert.deepStrictEqual(parsed.remainingIssues, []);
  });
});

describe('CoderAgent - Clarification Requests', () => {
  let coder;

  beforeEach(() => {
    agentCore.reset();
    coder = new CoderAgent();
  });

  it('should create clarification request', async () => {
    const task = { id: 'task-123', description: 'Implement feature' };
    const question = 'What format should the output be in?';

    const clarification = await coder.requestClarification(task, question);

    assert.strictEqual(clarification.taskId, 'task-123');
    assert.strictEqual(clarification.taskDescription, 'Implement feature');
    assert.strictEqual(clarification.question, question);
    assert.ok(clarification.timestamp);
  });

  it('should add clarification to memory', async () => {
    const task = { id: 'task-456', description: 'Test task' };
    const question = 'Need clarification';

    await coder.requestClarification(task, question);

    const memories = coder.agent.memory;
    assert.ok(memories.some(m => m.content.includes('clarification')));
  });
});

describe('CoderAgent - Statistics', () => {
  let coder;

  beforeEach(() => {
    agentCore.reset();
    coder = new CoderAgent();
  });

  it('should return agent statistics', () => {
    const stats = coder.getStats();

    assert.strictEqual(stats.name, 'coder');
    assert.strictEqual(stats.tasksImplemented, 0);
    assert.strictEqual(stats.fixesApplied, 0);
    assert.strictEqual(stats.linesOfCode, 0);
    assert.strictEqual(stats.testsWritten, 0);
    assert.strictEqual(stats.blockedCount, 0);
  });

  it('should reflect updated state in statistics', () => {
    agentCore.updateAgentState('coder', {
      tasksImplemented: 5,
      fixesApplied: 3,
      testsWritten: 10
    });

    const stats = coder.getStats();

    assert.strictEqual(stats.tasksImplemented, 5);
    assert.strictEqual(stats.fixesApplied, 3);
    assert.strictEqual(stats.testsWritten, 10);
  });
});

describe('CoderAgent - Subscription Setup', () => {
  beforeEach(() => {
    agentCore.reset();
  });

  it('should set up subscriptions on construction', () => {
    const coder = new CoderAgent();

    // Verify subscriptions are set up (agent has subscribesTo)
    assert.ok(coder.agent.subscribesTo);
    assert.ok(coder.agent.subscribesTo.length > 0);
  });

  it('should use custom subscribesTo when provided', () => {
    const coder = new CoderAgent({
      subscribesTo: ['supervisor']
    });

    assert.deepStrictEqual(coder.agent.subscribesTo, ['supervisor']);
  });
});

describe('CoderAgent - Tool Definitions', () => {
  let coder;

  beforeEach(() => {
    agentCore.reset();
    coder = new CoderAgent();
  });

  it('should have implementationComplete tool with correct params', () => {
    const implTool = coder.agent.tools.find(t => t.name === 'implementationComplete');

    assert.ok(implTool);
    assert.ok(implTool.params.some(p => p.name === 'status'));
    assert.ok(implTool.params.some(p => p.name === 'summary'));
    assert.ok(implTool.params.some(p => p.name === 'filesModified'));
    assert.ok(implTool.params.some(p => p.name === 'testsAdded'));
    assert.ok(implTool.params.some(p => p.name === 'commands'));
    assert.ok(implTool.params.some(p => p.name === 'blockReason'));
  });

  it('should have fixComplete tool with correct params', () => {
    const fixTool = coder.agent.tools.find(t => t.name === 'fixComplete');

    assert.ok(fixTool);
    assert.ok(fixTool.params.some(p => p.name === 'status'));
    assert.ok(fixTool.params.some(p => p.name === 'summary'));
    assert.ok(fixTool.params.some(p => p.name === 'filesModified'));
    assert.ok(fixTool.params.some(p => p.name === 'testsRun'));
    assert.ok(fixTool.params.some(p => p.name === 'testsPass'));
    assert.ok(fixTool.params.some(p => p.name === 'remainingIssues'));
  });
});

describe('CoderAgent - Allow Existing Registration', () => {
  beforeEach(() => {
    agentCore.reset();
  });

  it('should allow re-registration with allowExisting option', () => {
    new CoderAgent();

    // Should not throw
    assert.doesNotThrow(() => {
      new CoderAgent({ allowExisting: true });
    });
  });

  it('should throw when re-registering without allowExisting', () => {
    new CoderAgent();

    assert.throws(() => {
      new CoderAgent();
    }, /already registered/);
  });
});
