# Testing Guide

This document describes the test structure, how to run tests, and how to write new tests for the claude-looper-agents project.

## Test Organization

The project uses Node.js's built-in test runner (`node:test`) for all tests. Tests are organized into two categories:

### Unit Tests

Unit tests focus on individual agent classes and their methods. Each agent has its own test file:

| File | Description |
|------|-------------|
| `agent-planner.test.js` | Tests for PlannerAgent - plan parsing, task management, complexity calculation |
| `agent-coder.test.js` | Tests for CoderAgent - implementation/fix result parsing, text fallback |
| `agent-tester.test.js` | Tests for TesterAgent - test result parsing, fix plans, severity sorting |
| `agent-supervisor.test.js` | Tests for SupervisorAgent - verification parsing, progress assessment, escalation |
| `agent-executor.test.js` | Tests for AgentExecutor - prompt building, tool handling, execution flow |
| `orchestrator.test.js` | Tests for Orchestrator - workflow phases, configuration, state management |

### Integration Tests

Integration tests verify end-to-end workflows and multi-agent coordination:

| File | Description |
|------|-------------|
| `integration.test.js` | Complete workflow execution, resume functionality, event communication, state persistence |

## Running Tests

### Run All Tests

```bash
npm test
```

This runs all `*.test.js` files using Node.js's native test runner.

### Run Individual Test Files

```bash
# Run a specific test file
node --test agent-planner.test.js

# Run multiple specific files
node --test agent-coder.test.js agent-tester.test.js
```

### Run Tests with Verbose Output

```bash
node --test --test-reporter spec *.test.js
```

### Run a Specific Test by Name

```bash
node --test --test-name-pattern "should parse plan" agent-planner.test.js
```

## Writing New Tests

### Test File Structure

Follow this pattern for new test files:

```javascript
/**
 * [Agent Name] Tests
 *
 * Comprehensive test suite for the [Agent] class covering:
 * - [Category 1]
 * - [Category 2]
 */

import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert';
import agentCore from './agent-core.js';
import { YourAgent } from './your-agent.js';

describe('YourAgent - Category', () => {
  let agent;

  beforeEach(() => {
    // Reset agent core to ensure test isolation
    agentCore.reset();
    agent = new YourAgent();
  });

  it('should do something specific', () => {
    // Arrange
    const input = { /* test data */ };

    // Act
    const result = agent.someMethod(input);

    // Assert
    assert.strictEqual(result.status, 'expected');
  });
});
```

### Key Patterns

#### 1. Always Reset Agent Core

Each test should start with a clean state:

```javascript
beforeEach(() => {
  agentCore.reset();
});
```

#### 2. Use Strict Assertions

Prefer `strictEqual` over `equal` for type-safe comparisons:

```javascript
assert.strictEqual(result.status, 'complete');  // Good
assert.equal(result.status, 'complete');        // Avoid
```

#### 3. Test Both Structured and Text Parsing

Many agents support both structured output (tool calls) and text fallback parsing:

```javascript
// Structured output test
it('should parse from structuredOutput', () => {
  const result = {
    structuredOutput: {
      toolCall: {
        name: 'implementationComplete',
        arguments: { status: 'complete', summary: 'Done' }
      }
    }
  };
  const parsed = agent._parseResult(result);
  assert.strictEqual(parsed.status, 'complete');
});

// Text fallback test
it('should fallback to text parsing', () => {
  const result = { response: 'Implementation complete' };
  const parsed = agent._parseResult(result);
  assert.strictEqual(parsed.status, 'complete');
});
```

#### 4. Test Edge Cases

Always test boundary conditions and error cases:

```javascript
it('should handle empty input', () => {
  const parsed = agent._parseResult({});
  assert.ok(parsed.status); // Should have a default status
});

it('should truncate long summaries', () => {
  const result = { response: 'A'.repeat(1000) };
  const parsed = agent._parseResult(result);
  assert.strictEqual(parsed.summary.length, 500);
});
```

## Mocking Strategy

### Unit Test Mocking

For unit tests, use Node's built-in `mock` module:

```javascript
import { mock } from 'node:test';

it('should call dependency', async () => {
  const mockFn = mock.fn(() => 'mocked result');
  agent.dependency = mockFn;

  await agent.doSomething();

  assert.strictEqual(mockFn.mock.calls.length, 1);
});
```

### Integration Test Mocking

For integration tests, mock agent methods directly to simulate workflows:

```javascript
function mockSuccessfulWorkflow(orchestrator) {
  // Mock planner.createPlan
  orchestrator.agents.planner.createPlan = async (goal, context) => {
    const goalObj = agentCore.setGoal('planner', goal);
    const task = agentCore.addTask('planner', {
      description: 'Task 1',
      parentGoalId: goalObj.id
    });
    return { goalId: goalObj.id, tasks: [task] };
  };

  // Mock coder.implement
  orchestrator.agents.coder.implement = async (task, context) => {
    return {
      status: 'complete',
      filesModified: ['file.js'],
      testsAdded: []
    };
  };

  // Mock tester.test
  orchestrator.agents.tester.test = async (task, impl, context) => {
    return {
      status: 'passed',
      testsRun: 5,
      testsPassed: 5,
      failures: []
    };
  };

  // Mock supervisor.verify
  orchestrator.agents.supervisor.verify = async (agent, type, context) => {
    return {
      approved: true,
      score: 85,
      feedback: 'Approved'
    };
  };
}
```

### Test Directory Isolation

For tests that write to disk, use isolated directories:

```javascript
const TEST_CONFIG_DIR = path.join(process.cwd(), '.test-dir');

function cleanupTestDir() {
  if (fs.existsSync(TEST_CONFIG_DIR)) {
    fs.rmSync(TEST_CONFIG_DIR, { recursive: true, force: true });
  }
}

beforeEach(() => {
  cleanupTestDir();
});

afterEach(() => {
  cleanupTestDir();
});
```

## Coverage Requirements

### Minimum Coverage Targets

- **Line coverage**: 80% minimum
- **Branch coverage**: 75% minimum
- **Function coverage**: 90% minimum

### Checking Coverage

Node.js 18+ supports built-in coverage reporting:

```bash
# Run tests with coverage
node --test --experimental-test-coverage *.test.js
```

For detailed HTML reports, use c8:

```bash
# Install c8 (optional)
npm install -D c8

# Run with coverage
npx c8 node --test *.test.js

# Generate HTML report
npx c8 report --reporter=html
```

### What to Test

1. **Constructors and initialization** - Verify default values and custom options
2. **Public methods** - All public API methods should have tests
3. **Parsing logic** - Both structured output and text fallback paths
4. **State management** - State updates, persistence, and recovery
5. **Error handling** - Invalid inputs, edge cases, failure scenarios
6. **Integration points** - Agent-to-agent communication, event emission

### Known Issues

#### Severity Sorting Bug

The tester agent has a bug where critical severity (order 0) doesn't sort correctly due to JavaScript falsy value handling:

```javascript
// Bug: 0 || 2 evaluates to 2
severityOrder[a.severity] || 2
```

Tests currently use `major`, `minor`, and `suggestion` severities to avoid this issue.

## Test Naming Conventions

Use descriptive test names that follow the pattern:

```
should [expected behavior] when [condition]
```

Examples:
- `should parse plan from structured output`
- `should detect blocked status from text`
- `should throw when re-registering without allowExisting`
- `should return empty array when no tasks exist`

## Debugging Tests

### Run with Debug Output

```bash
NODE_DEBUG=test node --test agent-planner.test.js
```

### Use console.log in Tests

```javascript
it('should work', () => {
  const result = agent.method();
  console.log('Result:', JSON.stringify(result, null, 2));
  assert.ok(result);
});
```

### Run Single Test in Isolation

```bash
node --test --test-name-pattern "exact test name" file.test.js
```
