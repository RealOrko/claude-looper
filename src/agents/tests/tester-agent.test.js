/**
 * Tests for tester-agent.js - Testing and fix plan generation
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  TesterAgent,
  TestExecutionResult,
  DetailedFixPlan,
  TestCoverageAnalysis,
  IssueSeverity,
  IssueCategory,
} from '../tester-agent.js';
import { MessageType, AgentRole, AgentMessage, TestResult, PlanStep, FixCycleStatus } from '../interfaces.js';

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

// ===== NEW ENHANCEMENT TESTS =====

describe('IssueSeverity', () => {
  it('should have correct severity levels', () => {
    expect(IssueSeverity.CRITICAL).toBe('critical');
    expect(IssueSeverity.MAJOR).toBe('major');
    expect(IssueSeverity.MINOR).toBe('minor');
    expect(IssueSeverity.SUGGESTION).toBe('suggestion');
  });
});

describe('IssueCategory', () => {
  it('should have correct category values', () => {
    expect(IssueCategory.LOGIC_ERROR).toBe('logic_error');
    expect(IssueCategory.EDGE_CASE).toBe('edge_case');
    expect(IssueCategory.ERROR_HANDLING).toBe('error_handling');
    expect(IssueCategory.SECURITY).toBe('security');
    expect(IssueCategory.PERFORMANCE).toBe('performance');
    expect(IssueCategory.CODE_QUALITY).toBe('code_quality');
    expect(IssueCategory.TEST_FAILURE).toBe('test_failure');
    expect(IssueCategory.MISSING_TEST).toBe('missing_test');
  });
});

describe('DetailedFixPlan', () => {
  let fixPlan;

  beforeEach(() => {
    fixPlan = new DetailedFixPlan('test_result_123');
  });

  describe('Initialization', () => {
    it('should create with unique ID', () => {
      expect(fixPlan.id).toMatch(/^fixplan_\d+_[a-z0-9]+$/);
    });

    it('should have correct initial values', () => {
      expect(fixPlan.testResultId).toBe('test_result_123');
      expect(fixPlan.issues).toEqual([]);
      expect(fixPlan.fixSteps).toEqual([]);
      expect(fixPlan.priority).toBe('minor');
      expect(fixPlan.estimatedComplexity).toBe('simple');
      expect(fixPlan.previousAttempts).toEqual([]);
    });
  });

  describe('Issue Management', () => {
    it('should add issues with enriched context', () => {
      const issue = fixPlan.addIssue({
        severity: IssueSeverity.MAJOR,
        category: IssueCategory.LOGIC_ERROR,
        description: 'Incorrect calculation',
        location: 'src/math.js:42',
        suggestedFix: 'Check the formula',
      });

      expect(issue.id).toBe('issue_1');
      expect(issue.severity).toBe('major');
      expect(issue.category).toBe('logic_error');
      expect(issue.description).toBe('Incorrect calculation');
      expect(issue.location).toBe('src/math.js:42');
      expect(fixPlan.issues).toHaveLength(1);
    });

    it('should use default values for missing fields', () => {
      const issue = fixPlan.addIssue({
        description: 'Some issue',
      });

      expect(issue.severity).toBe(IssueSeverity.MINOR);
      expect(issue.category).toBe(IssueCategory.CODE_QUALITY);
      expect(issue.location).toBeNull();
    });

    it('should update priority based on critical issues', () => {
      fixPlan.addIssue({ severity: IssueSeverity.CRITICAL, description: 'Security flaw' });

      expect(fixPlan.priority).toBe('critical');
      expect(fixPlan.estimatedComplexity).toBe('complex');
    });

    it('should update priority based on major issues', () => {
      fixPlan.addIssue({ severity: IssueSeverity.MAJOR, description: 'Bug' });

      expect(fixPlan.priority).toBe('major');
    });

    it('should adjust complexity for many issues', () => {
      for (let i = 0; i < 4; i++) {
        fixPlan.addIssue({ severity: IssueSeverity.MAJOR, description: `Issue ${i}` });
      }

      expect(fixPlan.estimatedComplexity).toBe('complex');
    });
  });

  describe('Fix Steps', () => {
    it('should add fix steps with all fields', () => {
      fixPlan.addFixStep(1, 'Fix the bug', 'src/app.js', { before: 'bad', after: 'good' });

      expect(fixPlan.fixSteps).toHaveLength(1);
      expect(fixPlan.fixSteps[0].step).toBe(1);
      expect(fixPlan.fixSteps[0].instruction).toBe('Fix the bug');
      expect(fixPlan.fixSteps[0].targetFile).toBe('src/app.js');
      expect(fixPlan.fixSteps[0].codeChange).toEqual({ before: 'bad', after: 'good' });
      expect(fixPlan.fixSteps[0].completed).toBe(false);
    });

    it('should generate fix steps from issues', () => {
      fixPlan.addIssue({
        severity: IssueSeverity.CRITICAL,
        category: IssueCategory.SECURITY,
        description: 'Security issue',
        suggestedFix: 'Add input validation',
        location: 'src/auth.js',
      });
      fixPlan.addIssue({
        severity: IssueSeverity.MINOR,
        category: IssueCategory.CODE_QUALITY,
        description: 'Code style',
        location: 'src/utils.js',
      });

      fixPlan.generateFixSteps();

      expect(fixPlan.fixSteps.length).toBeGreaterThan(0);
      // First step should be from critical issue (with suggestedFix)
      // suggestedFix 'Add input validation' is used directly
      expect(fixPlan.fixSteps[0].instruction).toBe('Add input validation');
      // Last step should be verification
      expect(fixPlan.fixSteps[fixPlan.fixSteps.length - 1].instruction.toLowerCase()).toContain('verify');
    });
  });

  describe('Previous Attempts Tracking', () => {
    it('should record previous fix attempts', () => {
      fixPlan.recordPreviousAttempt({
        approach: 'Try adding null checks',
        result: 'failed',
        remainingIssues: [{ description: 'Still broken' }],
        feedback: 'Did not fix the root cause',
      });

      expect(fixPlan.previousAttempts).toHaveLength(1);
      expect(fixPlan.previousAttempts[0].attemptNumber).toBe(1);
      expect(fixPlan.previousAttempts[0].approach).toBe('Try adding null checks');
      expect(fixPlan.previousAttempts[0].result).toBe('failed');
    });

    it('should increment attempt numbers', () => {
      fixPlan.recordPreviousAttempt({ approach: 'First try', result: 'failed' });
      fixPlan.recordPreviousAttempt({ approach: 'Second try', result: 'partial' });

      expect(fixPlan.previousAttempts[0].attemptNumber).toBe(1);
      expect(fixPlan.previousAttempts[1].attemptNumber).toBe(2);
    });
  });

  describe('Coder Context', () => {
    it('should generate context for Coder agent', () => {
      fixPlan.addIssue({
        severity: IssueSeverity.MAJOR,
        category: IssueCategory.LOGIC_ERROR,
        description: 'Bug in calculation',
        suggestedFix: 'Fix the math',
      });
      fixPlan.recordPreviousAttempt({
        approach: 'Add more tests',
        result: 'failed',
      });
      fixPlan.suggestedApproach = 'Rewrite the function';
      fixPlan.generateFixSteps();

      const context = fixPlan.getCoderContext();

      expect(context.fixPlanId).toBe(fixPlan.id);
      expect(context.priority).toBe('major');
      expect(context.complexity).toBe('medium');
      expect(context.issueCount).toBe(1);
      expect(context.issues).toHaveLength(1);
      expect(context.fixSteps.length).toBeGreaterThan(0);
      expect(context.previousAttempts).toHaveLength(1);
      expect(context.suggestedApproach).toBe('Rewrite the function');
      expect(context.avoidApproaches).toContain('Add more tests');
    });
  });

  describe('Summary', () => {
    it('should generate accurate summary', () => {
      fixPlan.addIssue({ severity: IssueSeverity.CRITICAL, description: 'Critical bug' });
      fixPlan.addIssue({ severity: IssueSeverity.MAJOR, description: 'Major bug' });
      fixPlan.addIssue({ severity: IssueSeverity.MINOR, description: 'Minor issue' });
      fixPlan.generateFixSteps();
      fixPlan.recordPreviousAttempt({ approach: 'test', result: 'failed' });

      const summary = fixPlan.getSummary();

      expect(summary.id).toBe(fixPlan.id);
      expect(summary.priority).toBe('critical');
      expect(summary.issueCount).toBe(3);
      expect(summary.criticalCount).toBe(1);
      expect(summary.majorCount).toBe(1);
      expect(summary.fixStepCount).toBeGreaterThan(0);
      expect(summary.previousAttempts).toBe(1);
    });
  });
});

describe('TestCoverageAnalysis', () => {
  let coverage;

  beforeEach(() => {
    coverage = new TestCoverageAnalysis('step_1');
  });

  describe('Initialization', () => {
    it('should create with correct defaults', () => {
      expect(coverage.stepId).toBe('step_1');
      expect(coverage.overallCoverage).toBe('none');
      expect(coverage.coveragePercent).toBe(0);
      expect(coverage.testedFiles).toEqual([]);
      expect(coverage.untestedFiles).toEqual([]);
      expect(coverage.testQuality).toBe('unknown');
    });
  });

  describe('Coverage Analysis', () => {
    it('should calculate excellent coverage', () => {
      const codeOutput = {
        files: [
          { path: 'src/app.js' },
          { path: 'src/utils.js' },
        ],
        tests: [
          { path: 'test/app.test.js' },
          { path: 'test/utils.test.js' },
        ],
      };
      const testResult = { issues: [] };

      coverage.analyze(codeOutput, testResult);

      expect(coverage.overallCoverage).toBe('excellent');
      expect(coverage.coveragePercent).toBe(100);
      expect(coverage.testedFiles).toContain('src/app.js');
    });

    it('should calculate partial coverage', () => {
      // 2 files with 1 test = 50% coverage = partial
      const codeOutput = {
        files: [
          { path: 'src/app.js' },
          { path: 'src/utils.js' },
        ],
        tests: [
          { path: 'test/app.test.js' },
        ],
      };

      coverage.analyze(codeOutput, null);

      expect(coverage.overallCoverage).toBe('partial');
      expect(coverage.coveragePercent).toBeGreaterThanOrEqual(40);
      expect(coverage.coveragePercent).toBeLessThan(70);
      expect(coverage.untestedFiles.length).toBeGreaterThan(0);
    });

    it('should calculate no coverage when no tests', () => {
      const codeOutput = {
        files: [{ path: 'src/app.js' }],
        tests: [],
      };

      coverage.analyze(codeOutput, null);

      expect(coverage.overallCoverage).toBe('none');
      expect(coverage.coveragePercent).toBe(0);
    });

    it('should assess test quality based on issues', () => {
      const codeOutput = {
        files: [{ path: 'src/app.js' }],
        tests: [{ path: 'test/app.test.js' }],
      };
      const testResultGood = { issues: [] };
      const testResultBad = { issues: [{}, {}, {}] };

      coverage.analyze(codeOutput, testResultGood);
      expect(coverage.testQuality).toBe('good');

      const coverage2 = new TestCoverageAnalysis('step_2');
      coverage2.analyze(codeOutput, testResultBad);
      expect(coverage2.testQuality).toBe('poor');
    });
  });

  describe('Edge Cases', () => {
    it('should track missing edge cases', () => {
      coverage.addMissingEdgeCase('Null input handling', 'high');

      expect(coverage.edgeCasesMissing).toHaveLength(1);
      expect(coverage.edgeCasesMissing[0].description).toBe('Null input handling');
      expect(coverage.edgeCasesMissing[0].severity).toBe('high');
    });

    it('should track covered edge cases', () => {
      coverage.addCoveredEdgeCase('Empty array handling');

      expect(coverage.edgeCasesCovered).toHaveLength(1);
      expect(coverage.edgeCasesCovered[0].description).toBe('Empty array handling');
    });
  });

  describe('Summary', () => {
    it('should provide complete summary', () => {
      const codeOutput = {
        files: [{ path: 'src/a.js' }, { path: 'src/b.js' }],
        tests: [{ path: 'test/a.test.js' }],
      };
      coverage.analyze(codeOutput, { issues: [] });
      coverage.addMissingEdgeCase('Edge 1');
      coverage.addCoveredEdgeCase('Edge 2');

      const summary = coverage.getSummary();

      expect(summary.overall).toBe('partial');
      expect(summary.percent).toBe(50);
      expect(summary.testedFiles).toBe(1);
      expect(summary.untestedFiles).toBe(1);
      expect(summary.edgeCasesCovered).toBe(1);
      expect(summary.edgeCasesMissing).toBe(1);
    });
  });
});

describe('TesterAgent Enhanced Features', () => {
  let tester;
  let mockClient;

  beforeEach(() => {
    mockClient = { sendPrompt: vi.fn() };
    tester = new TesterAgent(mockClient, {
      model: 'sonnet',
      workingDirectory: '/test/project',
      maxFixCycles: 3,
    });
  });

  describe('Fix Cycle Tracking', () => {
    it('should initialize fix cycle for a step', () => {
      const tracker = tester.initializeFixCycle('step_1');

      expect(tracker.attempts).toBe(0);
      expect(tracker.maxAttempts).toBe(3);
      expect(tracker.status).toBe(FixCycleStatus.NOT_STARTED);
    });

    it('should track attempts with previous fix plan', () => {
      tester.initializeFixCycle('step_1');
      const tracker = tester.initializeFixCycle('step_1', { id: 'plan_1', issues: [] });

      expect(tracker.attempts).toBe(1);
      expect(tracker.previousPlans).toHaveLength(1);
    });

    it('should update fix cycle status', () => {
      tester.initializeFixCycle('step_1');

      tester.updateFixCycleStatus('step_1', 'in_progress', ['issue1']);
      expect(tester.fixCycleTracker.get('step_1').status).toBe(FixCycleStatus.IN_PROGRESS);

      tester.updateFixCycleStatus('step_1', 'resolved', []);
      expect(tester.fixCycleTracker.get('step_1').status).toBe(FixCycleStatus.RESOLVED);
    });

    it('should get fix cycle status', () => {
      const initialStatus = tester.getFixCycleStatus('nonexistent');
      expect(initialStatus.status).toBe(FixCycleStatus.NOT_STARTED);
      expect(initialStatus.canRetry).toBe(true);

      tester.initializeFixCycle('step_1');
      tester.initializeFixCycle('step_1', { id: 'plan' }); // 1st attempt
      tester.initializeFixCycle('step_1', { id: 'plan' }); // 2nd attempt
      tester.initializeFixCycle('step_1', { id: 'plan' }); // 3rd attempt (max)

      const status = tester.getFixCycleStatus('step_1');
      expect(status.attempts).toBe(3);
      expect(status.canRetry).toBe(false);
    });
  });

  describe('Learning Context', () => {
    it('should record successful fixes', () => {
      tester.recordSuccessfulFix('step_1', {
        suggestedApproach: 'Add null checks',
        issues: [{ category: 'edge_case' }],
      });

      expect(tester.learningContext.successfulFixes).toHaveLength(1);
      expect(tester.learningContext.successfulFixes[0].approach).toBe('Add null checks');
    });

    it('should record failed approaches', () => {
      tester.recordFailedApproach('step_1', 'Bad approach', 'Did not work');

      expect(tester.learningContext.failedApproaches).toHaveLength(1);
      expect(tester.learningContext.failedApproaches[0].approach).toBe('Bad approach');
      expect(tester.learningContext.failedApproaches[0].reason).toBe('Did not work');
    });

    it('should keep learning context bounded', () => {
      for (let i = 0; i < 25; i++) {
        tester.recordSuccessfulFix(`step_${i}`, { suggestedApproach: `Approach ${i}` });
        tester.recordFailedApproach(`step_${i}`, `Failed ${i}`, 'reason');
      }

      expect(tester.learningContext.successfulFixes.length).toBe(20);
      expect(tester.learningContext.failedApproaches.length).toBe(20);
    });
  });

  describe('Issue Categorization', () => {
    it('should categorize security issues', () => {
      expect(tester.categorizeIssue({ description: 'SQL injection vulnerability' }))
        .toBe(IssueCategory.SECURITY);
      expect(tester.categorizeIssue({ description: 'XSS attack possible' }))
        .toBe(IssueCategory.SECURITY);
    });

    it('should categorize test failures', () => {
      expect(tester.categorizeIssue({ description: 'Test failed for login' }))
        .toBe(IssueCategory.TEST_FAILURE);
    });

    it('should categorize edge cases', () => {
      expect(tester.categorizeIssue({ description: 'Missing null check' }))
        .toBe(IssueCategory.EDGE_CASE);
      expect(tester.categorizeIssue({ description: 'boundary condition not handled' }))
        .toBe(IssueCategory.EDGE_CASE);
    });

    it('should categorize performance issues', () => {
      expect(tester.categorizeIssue({ description: 'Slow database query' }))
        .toBe(IssueCategory.PERFORMANCE);
    });

    it('should default to code quality', () => {
      expect(tester.categorizeIssue({ description: 'Some generic issue' }))
        .toBe(IssueCategory.CODE_QUALITY);
    });
  });

  describe('Suggested Fix Generation', () => {
    it('should generate category-based fixes', () => {
      const fix = tester.generateSuggestedFix(
        { description: 'Missing null check' },
        { files: [] },
      );

      expect(fix).toContain('null');
    });

    it('should use learning context for similar issues', () => {
      tester.learningContext.successfulFixes.push({
        issueTypes: [IssueCategory.EDGE_CASE],
        approach: 'Use optional chaining',
      });

      const fix = tester.generateSuggestedFix(
        { description: 'edge case not handled' },
        { files: [] },
      );

      expect(fix).toContain('optional chaining');
    });
  });

  describe('Edge Case Pattern Detection', () => {
    it('should identify relevant edge case patterns', () => {
      const codeWithNulls = 'if (value === null || value === undefined) {}';
      const patterns = tester.identifyRelevantEdgeCases(codeWithNulls);

      expect(patterns.some(p => p.name === 'null_undefined')).toBe(true);
    });

    it('should identify async patterns', () => {
      const asyncCode = 'async function fetch() { await getData(); }';
      const patterns = tester.identifyRelevantEdgeCases(asyncCode);

      expect(patterns.some(p => p.name === 'async_errors')).toBe(true);
    });
  });

  describe('Reset for New Goal', () => {
    it('should reset fix cycle tracker and history', () => {
      tester.initializeFixCycle('step_1');
      tester.addToHistory(new TestResult('step_1', 'unit'));

      tester.resetForNewGoal();

      expect(tester.fixCycleTracker.size).toBe(0);
      expect(tester.testHistory).toHaveLength(0);
    });

    it('should preserve learning context', () => {
      tester.learningContext.successfulFixes.push({ approach: 'keep this' });

      tester.resetForNewGoal();

      expect(tester.learningContext.successfulFixes).toHaveLength(1);
    });
  });

  describe('Enhanced Statistics', () => {
    it('should provide enhanced stats', () => {
      // Add some history
      const passed = new TestResult('step_1', 'unit');
      passed.passed = true;
      tester.addToHistory(passed);

      const failed = new TestResult('step_2', 'unit');
      failed.passed = false;
      failed.issues = [{ severity: 'major' }];
      tester.addToHistory(failed);

      // Add fix cycle
      tester.initializeFixCycle('step_2');
      tester.updateFixCycleStatus('step_2', 'resolved', []);

      // Add learning
      tester.learningContext.commonIssues.push('Common issue 1');

      const stats = tester.getEnhancedStats();

      expect(stats.passedCount).toBe(1);
      expect(stats.failedCount).toBe(1);
      expect(stats.fixCycleStats.totalCycles).toBe(1);
      expect(stats.fixCycleStats.resolved).toBe(1);
      expect(stats.learningContext.commonIssuesCount).toBe(1);
    });
  });

  describe('Exploratory Testing with Edge Cases', () => {
    it('should include edge case checklist in prompt', () => {
      const step = new PlanStep(1, 'Implement async function', 'medium');
      const codeOutput = {
        files: [{ path: 'src/async.js', content: 'async function fetch() { await api.get(); }' }],
        tests: [],
      };

      const prompt = tester.buildExploratoryTestPrompt(step, codeOutput);

      expect(prompt).toContain('EDGE CASES TO CHECK');
      expect(prompt).toContain('async');
    });

    it('should parse edge cases from exploratory results', () => {
      const result = new TestResult('step_1', 'exploratory');
      const response = `
ANALYSIS: Good

ISSUES:
None found

EDGE_CASES:
- [COVERED] Null input handling
- [MISSING] Empty array handling

SUGGESTIONS:
None

COVERAGE:
GOOD

VERDICT:
PASS`;

      tester.parseExploratoryResults(response, result);

      expect(result.edgeCases.covered).toContain('Null input handling');
      expect(result.edgeCases.missing).toContain('Empty array handling');
      // Missing edge case should add a minor issue
      expect(result.issues.some(i => i.description.includes('Empty array'))).toBe(true);
    });
  });

  describe('Common Issues Learning', () => {
    it('should add critical issues to common issues', () => {
      const result = new TestResult('step_1', 'exploratory');
      const response = `
ANALYSIS: Issues found

ISSUES:
- [CRITICAL] SQL injection vulnerability | db.js:42

SUGGESTIONS:
None

COVERAGE:
POOR

VERDICT:
FAIL`;

      tester.parseExploratoryResults(response, result);

      expect(tester.learningContext.commonIssues.length).toBeGreaterThan(0);
    });

    it('should limit common issues', () => {
      for (let i = 0; i < 15; i++) {
        tester.addToCommonIssues(`Issue pattern ${i}`);
      }

      expect(tester.learningContext.commonIssues.length).toBe(10);
    });

    it('should not add duplicate common issues', () => {
      tester.addToCommonIssues('Same issue');
      tester.addToCommonIssues('Same issue');

      expect(tester.learningContext.commonIssues.length).toBe(1);
    });
  });
});
