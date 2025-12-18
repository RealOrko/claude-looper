/**
 * Tests for tester-agent.js - Testing and fix plan generation
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TesterAgent, TestExecutionResult } from '../tester-agent.js';
import { MessageType, AgentRole, AgentMessage, TestResult, PlanStep } from '../interfaces.js';

// Mock Claude client
function createMockClient() {
  return {
    sendPrompt: vi.fn(),
  };
}

describe('TestExecutionResult', () => {
  it('should create with default values', () => {
    const result = new TestExecutionResult('npm test');

    expect(result.command).toBe('npm test');
    expect(result.exitCode).toBeNull();
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('');
    expect(result.passed).toBe(false);
    expect(result.timedOut).toBe(false);
  });
});

describe('TesterAgent', () => {
  let tester;
  let mockClient;

  beforeEach(() => {
    mockClient = createMockClient();
    tester = new TesterAgent(mockClient, {
      model: 'sonnet',
      workingDirectory: '/test/project',
      testTimeout: 30000,
    });
  });

  describe('Initialization', () => {
    it('should initialize with correct role', () => {
      expect(tester.role).toBe(AgentRole.TESTER);
    });

    it('should use configured model', () => {
      expect(tester.model).toBe('sonnet');
    });

    it('should have test command mappings', () => {
      expect(tester.testCommands.node).toContain('npm test');
      expect(tester.testCommands.python).toContain('pytest');
      expect(tester.testCommands.go).toContain('go test ./...');
    });
  });

  describe('Exploratory Testing', () => {
    it('should perform LLM-based exploratory testing', async () => {
      mockClient.sendPrompt.mockResolvedValue({
        response: `
ANALYSIS:
The code looks generally well-structured.

ISSUES:
- [MAJOR] Missing input validation in login function | src/auth.js:25
- [MINOR] Variable could have a clearer name | src/auth.js:30

SUGGESTIONS:
- [MEDIUM] Consider adding rate limiting

COVERAGE:
PARTIAL

VERDICT:
FAIL - Missing critical input validation
`,
      });

      const step = new PlanStep(1, 'Implement login', 'medium');
      const codeOutput = {
        files: [{ path: 'src/auth.js', content: 'function login() {}' }],
        tests: [{ path: 'test/auth.test.js', content: '' }],
      };

      const result = await tester.runExploratoryTesting(step, codeOutput);

      expect(result.issues.length).toBe(2);
      expect(result.issues[0].severity).toBe('major');
      expect(result.suggestions.length).toBe(1);
      expect(result.coverage).toBe('PARTIAL');
      expect(result.passed).toBe(false);
    });

    it('should parse passing verdict', async () => {
      mockClient.sendPrompt.mockResolvedValue({
        response: `
ANALYSIS:
Code is well-written.

ISSUES:
None found

SUGGESTIONS:
None

COVERAGE:
GOOD

VERDICT:
PASS - All checks passed
`,
      });

      const step = new PlanStep(1, 'Good code', 'low');
      const result = await tester.runExploratoryTesting(step, { files: [], tests: [] });

      expect(result.passed).toBe(true);
      expect(result.issues.length).toBe(0);
    });
  });

  describe('Test Failure Parsing', () => {
    it('should parse Jest-style failures', () => {
      const execResult = {
        stdout: `FAIL src/app.test.js
  ● should handle user login
    expect(received).toBe(expected)`,
        stderr: '',
        exitCode: 1,
      };

      const failures = tester.parseTestFailures(execResult);

      expect(failures.length).toBeGreaterThan(0);
    });

    it('should parse pytest-style failures', () => {
      const execResult = {
        stdout: '',
        stderr: `FAILED test_auth.py::test_login - AssertionError: Expected True`,
        exitCode: 1,
      };

      const failures = tester.parseTestFailures(execResult);

      expect(failures.length).toBeGreaterThan(0);
    });

    it('should parse generic error messages', () => {
      const execResult = {
        stdout: '',
        stderr: `Error: Connection refused`,
        exitCode: 1,
      };

      const failures = tester.parseTestFailures(execResult);

      expect(failures.length).toBeGreaterThan(0);
    });

    it('should limit number of failures returned', () => {
      const manyErrors = Array(20).fill('Error: failure\n').join('');
      const execResult = {
        stdout: manyErrors,
        stderr: '',
        exitCode: 1,
      };

      const failures = tester.parseTestFailures(execResult);

      expect(failures.length).toBeLessThanOrEqual(10);
    });
  });

  describe('Test Result Merging', () => {
    it('should merge issues from multiple test results', () => {
      const target = new TestResult('step_1', 'combined');
      const source = new TestResult('step_1', 'exploratory');

      source.addIssue('major', 'Issue 1');
      source.addIssue('minor', 'Issue 2');

      tester.mergeTestResults(target, source);

      expect(target.issues.length).toBe(2);
    });

    it('should merge suggestions', () => {
      const target = new TestResult('step_1', 'combined');
      const source = new TestResult('step_1', 'exploratory');

      source.addSuggestion('Add tests', 'high');

      tester.mergeTestResults(target, source);

      expect(target.suggestions.length).toBe(1);
    });

    it('should merge output', () => {
      const target = new TestResult('step_1', 'combined');
      target.output = 'Initial output';

      const source = new TestResult('step_1', 'automated');
      source.output = 'More output';

      tester.mergeTestResults(target, source);

      expect(target.output).toContain('Initial output');
      expect(target.output).toContain('More output');
    });
  });

  describe('Message Handling', () => {
    it('should handle TEST_REQUEST message', async () => {
      // Mock to skip automated tests
      vi.spyOn(tester, 'runAutomatedTests').mockResolvedValue(new TestResult(null, 'auto'));

      mockClient.sendPrompt.mockResolvedValue({
        response: `
ANALYSIS: Good
ISSUES: None found
SUGGESTIONS: None
COVERAGE: GOOD
VERDICT: PASS
`,
      });

      const request = new AgentMessage(
        MessageType.TEST_REQUEST,
        AgentRole.ORCHESTRATOR,
        AgentRole.TESTER,
        {
          step: new PlanStep(1, 'Test step', 'low'),
          codeOutput: { files: [], tests: [] },
        }
      );

      const response = await tester.handleMessage(request);

      expect(response.type).toBe(MessageType.TEST_RESPONSE);
      expect(response.payload.passed).toBe(true);
    });

    it('should generate fix plan for failures', async () => {
      vi.spyOn(tester, 'runAutomatedTests').mockResolvedValue(new TestResult(null, 'auto'));

      mockClient.sendPrompt.mockResolvedValue({
        response: `
ANALYSIS: Issues found
ISSUES:
- [CRITICAL] Security vulnerability | auth.js:50
SUGGESTIONS: None
COVERAGE: POOR
VERDICT: FAIL - Security issue
`,
      });

      const request = new AgentMessage(
        MessageType.TEST_REQUEST,
        AgentRole.ORCHESTRATOR,
        AgentRole.TESTER,
        {
          step: new PlanStep(1, 'Insecure code', 'high'),
          codeOutput: { files: [], tests: [] },
        }
      );

      const response = await tester.handleMessage(request);

      expect(response.payload.passed).toBe(false);
      expect(response.payload.fixPlan).toBeDefined();
    });
  });

  describe('Prompt Building', () => {
    it('should build comprehensive exploratory test prompt', () => {
      const step = new PlanStep(1, 'Implement feature', 'medium');
      const codeOutput = {
        files: [{ path: 'src/feature.js', content: 'function feature() {}' }],
        tests: [{ path: 'test/feature.test.js', content: 'test()' }],
      };

      const prompt = tester.buildExploratoryTestPrompt(step, codeOutput);

      expect(prompt).toContain('Implement feature');
      expect(prompt).toContain('src/feature.js');
      expect(prompt).toContain('Logic Errors');
      expect(prompt).toContain('Edge Cases');
      expect(prompt).toContain('Security Issues');
      expect(prompt).toContain('VERDICT');
    });
  });

  describe('Test History', () => {
    it('should track test history', async () => {
      const result = new TestResult('step_1', 'unit');
      result.passed = true;
      result.coverage = 'GOOD';

      tester.addToHistory(result);

      expect(tester.testHistory.length).toBe(1);
      expect(tester.testHistory[0].passed).toBe(true);
    });

    it('should limit history size', () => {
      for (let i = 0; i < 50; i++) {
        const result = new TestResult(`step_${i}`, 'unit');
        tester.addToHistory(result);
      }

      expect(tester.testHistory.length).toBe(30); // maxTestHistory
    });
  });

  describe('Statistics', () => {
    it('should calculate pass rate', () => {
      // Add some test history
      for (let i = 0; i < 10; i++) {
        const result = new TestResult(`step_${i}`, 'unit');
        result.passed = i % 2 === 0; // 5 pass, 5 fail
        tester.addToHistory(result);
      }

      const stats = tester.getStats();

      expect(stats.testsRun).toBe(10);
      expect(stats.passRate).toBe(50);
    });

    it('should return null pass rate with no tests', () => {
      const stats = tester.getStats();

      expect(stats.passRate).toBeNull();
    });
  });
});
