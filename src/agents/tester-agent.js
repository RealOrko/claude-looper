/**
 * Tester Agent - Exploratory Testing and Fix Plan Generation
 *
 * The Tester agent is responsible for:
 * 1. Running tests on Coder's implementations
 * 2. Performing exploratory testing to find edge cases
 * 3. Generating detailed fix plans when tests fail
 * 4. Providing structured feedback to the Coder agent for fixes
 */

import {
  BaseAgent,
  AgentRole,
  AgentStatus,
  MessageType,
  TestResult,
} from './interfaces.js';

import {
  IssueSeverity,
  IssueCategory,
  DetailedFixPlan,
  categorizeIssue,
  generateSuggestedFix,
  generateAttemptFeedback,
  TestCoverageAnalysis,
  detectTestCommands,
  executeCommand,
  parseTestFailures,
  buildExploratoryTestPrompt,
  parseExploratoryResults,
  buildSuggestedApproachPrompt,
  FixCycleTracker,
  TEST_COMMANDS,
} from './tester/index.js';

// Re-export for backwards compatibility
export { IssueSeverity, IssueCategory, DetailedFixPlan };
export { TestCoverageAnalysis, TestExecutionResult } from './tester/index.js';

// Import module functions for delegate methods
import {
  parseTestFailures as _parseTestFailures,
  buildExploratoryTestPrompt as _buildExploratoryTestPrompt,
  parseExploratoryResults as _parseExploratoryResults,
  identifyRelevantEdgeCases as _identifyRelevantEdgeCases,
} from './tester/index.js';

/**
 * Tester Agent
 */
export class TesterAgent extends BaseAgent {
  constructor(client, config = {}) {
    super(AgentRole.TESTER, client, config);

    this.model = config.model || 'sonnet';
    this.workingDirectory = config.workingDirectory || process.cwd();
    this.testTimeout = config.testTimeout || 5 * 60 * 1000;
    this.testHistory = [];
    this.maxTestHistory = 30;

    this.fixCycleTracker = new FixCycleTracker(config.maxFixCycles || 3);

    // Test commands for reference (backwards compatibility)
    this.testCommands = TEST_COMMANDS;

    this.registerHandlers();
  }

  registerHandlers() {
    this.onMessage(MessageType.TEST_REQUEST, (msg) => this.handleTestRequest(msg));
  }

  async handleTestRequest(message) {
    const { step, codeOutput, isRetry = false, previousFixPlan = null } = message.payload;
    this.status = AgentStatus.WORKING;

    try {
      const fixCycleInfo = this.fixCycleTracker.initializeFixCycle(step.id, previousFixPlan);
      const testResult = await this.runTests(step, codeOutput);

      const coverageAnalysis = new TestCoverageAnalysis(step.id);
      coverageAnalysis.analyze(codeOutput, testResult);
      testResult.coverageAnalysis = coverageAnalysis.getSummary();

      this.addToHistory(testResult);

      let detailedFixPlan = null;
      if (!testResult.passed) {
        detailedFixPlan = await this.generateDetailedFixPlan(step, codeOutput, testResult, previousFixPlan, fixCycleInfo);
        testResult.detailedFixPlan = detailedFixPlan;
        this.fixCycleTracker.updateFixCycleStatus(step.id, 'in_progress', testResult.issues);
      } else if (isRetry) {
        this.fixCycleTracker.updateFixCycleStatus(step.id, 'resolved', []);
        this.fixCycleTracker.recordSuccessfulFix(step.id, previousFixPlan);
      }

      return message.createResponse(MessageType.TEST_RESPONSE, {
        success: testResult.passed,
        result: testResult,
        passed: testResult.passed,
        issues: testResult.issues,
        fixPlan: testResult.fixPlan,
        detailedFixPlan: detailedFixPlan?.getCoderContext() || null,
        coverageAnalysis: testResult.coverageAnalysis,
        fixCycleStatus: this.fixCycleTracker.getFixCycleStatus(step.id),
      });

    } catch (error) {
      const errorResult = new TestResult(step.id, 'error');
      errorResult.passed = false;
      errorResult.addIssue('critical', `Test execution failed: ${error.message}`);
      errorResult.generateFixPlan();

      return message.createResponse(MessageType.TEST_RESPONSE, {
        success: false,
        result: errorResult,
        passed: false,
        issues: errorResult.issues,
        fixPlan: errorResult.fixPlan,
        detailedFixPlan: null,
        coverageAnalysis: null,
        fixCycleStatus: this.fixCycleTracker.getFixCycleStatus(step.id),
      });
    } finally {
      this.status = AgentStatus.IDLE;
    }
  }

  async generateDetailedFixPlan(step, codeOutput, testResult, previousFixPlan, fixCycleInfo) {
    const fixPlan = new DetailedFixPlan(testResult.id);
    const learningContext = this.fixCycleTracker.getLearningContext();

    for (const issue of testResult.issues) {
      fixPlan.addIssue({
        severity: issue.severity,
        category: categorizeIssue(issue),
        description: issue.description,
        location: issue.location,
        suggestedFix: generateSuggestedFix(issue, learningContext),
      });
    }

    const coverageAnalysis = testResult.coverageAnalysis;
    if (coverageAnalysis?.untestedFiles > 0) {
      fixPlan.addIssue({
        severity: IssueSeverity.MINOR,
        category: IssueCategory.MISSING_TEST,
        description: `${coverageAnalysis.untestedFiles} files lack test coverage`,
        suggestedFix: 'Add unit tests for untested files',
      });
    }

    if (previousFixPlan) {
      fixPlan.recordPreviousAttempt({
        approach: previousFixPlan.suggestedApproach || 'unknown',
        result: testResult.passed ? 'success' : 'failed',
        remainingIssues: testResult.issues,
        feedback: generateAttemptFeedback(previousFixPlan, testResult),
      });
    }

    fixPlan.suggestedApproach = await this.generateSuggestedApproach(step, testResult, fixCycleInfo);
    fixPlan.affectedFiles = [...(codeOutput.files || []).map(f => f.path)];
    fixPlan.generateFixSteps();

    return fixPlan;
  }

  async generateSuggestedApproach(step, testResult, fixCycleInfo) {
    const learningContext = this.fixCycleTracker.getLearningContext();
    const prompt = buildSuggestedApproachPrompt(step, testResult, fixCycleInfo, learningContext.failedApproaches);

    try {
      const response = await this.client.sendPrompt(prompt, {
        newSession: true,
        timeout: 30000,
        model: this.model,
      });
      return response.response.trim().substring(0, 200);
    } catch (error) {
      const criticalCount = testResult.issues.filter(i => i.severity === 'critical').length;
      return criticalCount > 0
        ? 'Focus on fixing critical issues first, then address remaining issues'
        : 'Address issues in order of severity, starting with the most impactful';
    }
  }

  async runTests(step, codeOutput) {
    const testResult = new TestResult(step.id, 'combined');

    const automatedResults = await this.runAutomatedTests(codeOutput);
    this.mergeTestResults(testResult, automatedResults);

    const exploratoryResults = await this.runExploratoryTesting(step, codeOutput);
    this.mergeTestResults(testResult, exploratoryResults);

    testResult.passed = testResult.issues.filter(i => i.severity === 'critical' || i.severity === 'major').length === 0;

    if (!testResult.passed) {
      testResult.generateFixPlan();
    }

    return testResult;
  }

  async runAutomatedTests(codeOutput) {
    const result = new TestResult(null, 'automated');
    const testCommands = await detectTestCommands(this.workingDirectory);

    if (testCommands.length === 0) {
      result.addSuggestion('No test framework detected. Consider adding tests.', 'medium');
      result.passed = true;
      return result;
    }

    for (const command of testCommands) {
      const execResult = await executeCommand(command, this.workingDirectory, this.testTimeout);

      if (!execResult.passed) {
        const failures = parseTestFailures(execResult);
        for (const failure of failures) {
          result.addIssue(failure.severity, failure.description, failure.location);
        }
        if (execResult.exitCode !== 0 && failures.length === 0) {
          result.addIssue('major', `Test command failed: ${command}`, null);
        }
      }
      result.output += `\n=== ${command} ===\n${execResult.stdout}\n${execResult.stderr}`;
    }

    result.passed = result.issues.filter(i => i.severity === 'critical' || i.severity === 'major').length === 0;
    return result;
  }

  async runExploratoryTesting(step, codeOutput) {
    const result = new TestResult(step.id, 'exploratory');
    const learningContext = this.fixCycleTracker.getLearningContext();
    const prompt = buildExploratoryTestPrompt(step, codeOutput, learningContext);

    try {
      const response = await this.client.sendPrompt(prompt, {
        newSession: true,
        timeout: 3 * 60 * 1000,
        model: this.model,
      });

      parseExploratoryResults(response.response, result, (desc) => this.fixCycleTracker.addToCommonIssues(desc));
    } catch (error) {
      result.addSuggestion(`Exploratory testing unavailable: ${error.message}`, 'low');
    }

    result.passed = result.issues.filter(i => i.severity === 'critical' || i.severity === 'major').length === 0;
    return result;
  }

  mergeTestResults(target, source) {
    for (const issue of source.issues || []) {
      target.addIssue(issue.severity, issue.description, issue.location);
    }
    for (const suggestion of source.suggestions || []) {
      target.addSuggestion(suggestion.description, suggestion.priority);
    }
    if (source.output) {
      target.output = (target.output || '') + '\n' + source.output;
    }
    if (source.coverage && (!target.coverage || source.coverage !== 'NONE')) {
      target.coverage = source.coverage;
    }
  }

  addToHistory(testResult) {
    this.testHistory.push({
      timestamp: Date.now(),
      testId: testResult.id,
      stepId: testResult.stepId,
      passed: testResult.passed,
      issueCount: testResult.issues.length,
      coverage: testResult.coverage,
    });

    if (this.testHistory.length > this.maxTestHistory) {
      this.testHistory = this.testHistory.slice(-this.maxTestHistory);
    }
  }

  resetForNewGoal() {
    this.fixCycleTracker.reset();
    this.testHistory = [];
  }

  // Delegate methods for backwards compatibility
  get learningContext() {
    return this.fixCycleTracker.getLearningContext();
  }

  addToCommonIssues(description) {
    return this.fixCycleTracker.addToCommonIssues(description);
  }

  recordSuccessfulFix(stepId, fixPlan) {
    return this.fixCycleTracker.recordSuccessfulFix(stepId, fixPlan);
  }

  recordFailedApproach(stepId, approach, reason) {
    return this.fixCycleTracker.recordFailedApproach(stepId, approach, reason);
  }

  initializeFixCycle(stepId, previousFixPlan) {
    return this.fixCycleTracker.initializeFixCycle(stepId, previousFixPlan);
  }

  updateFixCycleStatus(stepId, status, issues) {
    return this.fixCycleTracker.updateFixCycleStatus(stepId, status, issues);
  }

  getFixCycleStatus(stepId) {
    return this.fixCycleTracker.getFixCycleStatus(stepId);
  }

  // Delegate methods for module functions (backwards compatibility for tests)
  parseTestFailures(execResult) {
    return _parseTestFailures(execResult);
  }

  buildExploratoryTestPrompt(step, codeOutput) {
    return _buildExploratoryTestPrompt(step, codeOutput, this.learningContext);
  }

  parseExploratoryResults(response, result) {
    return _parseExploratoryResults(response, result, (desc) => this.addToCommonIssues(desc));
  }

  identifyRelevantEdgeCases(codeContent) {
    return _identifyRelevantEdgeCases(codeContent);
  }

  categorizeIssue(issue) {
    return categorizeIssue(issue);
  }

  generateSuggestedFix(issue) {
    return generateSuggestedFix(issue, this.learningContext);
  }

  async execute(task) {
    if (task.type === 'test') {
      return this.runTests(task.step, task.codeOutput);
    }
    throw new Error(`Unknown task type: ${task.type}`);
  }

  getStats() {
    const passedCount = this.testHistory.filter(h => h.passed).length;
    return {
      ...super.getStats(),
      model: this.model,
      testsRun: this.testHistory.length,
      passRate: this.testHistory.length > 0 ? Math.round((passedCount / this.testHistory.length) * 100) : null,
      recentTests: this.testHistory.slice(-5).map(h => ({
        stepId: h.stepId,
        passed: h.passed,
        issues: h.issueCount,
        coverage: h.coverage,
      })),
    };
  }

  getEnhancedStats() {
    const passedCount = this.testHistory.filter(h => h.passed).length;
    const failedCount = this.testHistory.length - passedCount;
    const failedTests = this.testHistory.filter(h => !h.passed);
    const avgIssuesPerFailure = failedTests.length > 0
      ? Math.round(failedTests.reduce((sum, t) => sum + t.issueCount, 0) / failedTests.length)
      : 0;

    const learningContext = this.fixCycleTracker.getLearningContext();

    return {
      ...this.getStats(),
      passedCount,
      failedCount,
      avgIssuesPerFailure,
      fixCycleStats: this.fixCycleTracker.getStats(),
      learningContext: {
        commonIssuesCount: learningContext.commonIssues.length,
        successfulFixesCount: learningContext.successfulFixes.length,
        failedApproachesCount: learningContext.failedApproaches.length,
      },
    };
  }
}

export default TesterAgent;
