/**
 * Tester Agent - Exploratory Testing and Fix Plan Generation
 *
 * The Tester agent is responsible for:
 * 1. Running tests on Coder's implementations
 * 2. Performing exploratory testing to find edge cases
 * 3. Generating detailed fix plans when tests fail
 * 4. Providing structured feedback to the Coder agent for fixes
 * 5. Tracking test coverage and quality metrics
 *
 * Uses Sonnet model for efficient test analysis.
 */

import {
  BaseAgent,
  AgentRole,
  AgentStatus,
  MessageType,
  TestResult,
  AgentMessage,
  FixCycleStatus,
} from './interfaces.js';
import { spawn } from 'child_process';

/**
 * Issue severity levels for prioritization
 */
export const IssueSeverity = {
  CRITICAL: 'critical',  // Breaks core functionality, security vulnerabilities
  MAJOR: 'major',        // Significant bugs, incorrect behavior
  MINOR: 'minor',        // Code quality, style issues
  SUGGESTION: 'suggestion', // Improvements, not required
};

/**
 * Issue categories for classification
 */
export const IssueCategory = {
  LOGIC_ERROR: 'logic_error',
  EDGE_CASE: 'edge_case',
  ERROR_HANDLING: 'error_handling',
  SECURITY: 'security',
  PERFORMANCE: 'performance',
  CODE_QUALITY: 'code_quality',
  TEST_FAILURE: 'test_failure',
  MISSING_TEST: 'missing_test',
};

/**
 * Detailed Fix Plan - Provides structured feedback to Coder agent
 */
export class DetailedFixPlan {
  constructor(testResultId) {
    this.id = `fixplan_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    this.testResultId = testResultId;
    this.issues = [];
    this.fixSteps = [];
    this.priority = 'minor';
    this.estimatedComplexity = 'simple';
    this.previousAttempts = [];
    this.suggestedApproach = null;
    this.affectedFiles = [];
    this.relatedTests = [];
    this.createdAt = Date.now();
  }

  /**
   * Add an issue to the fix plan with detailed context
   */
  addIssue(issue) {
    const enrichedIssue = {
      id: `issue_${this.issues.length + 1}`,
      severity: issue.severity || IssueSeverity.MINOR,
      category: issue.category || IssueCategory.CODE_QUALITY,
      description: issue.description,
      location: issue.location || null,
      codeSnippet: issue.codeSnippet || null,
      expectedBehavior: issue.expectedBehavior || null,
      actualBehavior: issue.actualBehavior || null,
      rootCause: issue.rootCause || null,
      suggestedFix: issue.suggestedFix || null,
    };
    this.issues.push(enrichedIssue);
    this._updatePriority();
    return enrichedIssue;
  }

  /**
   * Add a step-by-step fix instruction
   */
  addFixStep(stepNumber, instruction, targetFile = null, codeChange = null) {
    this.fixSteps.push({
      step: stepNumber,
      instruction,
      targetFile,
      codeChange, // { before: string, after: string } or null
      completed: false,
    });
  }

  /**
   * Generate fix steps from issues
   */
  generateFixSteps() {
    // Sort issues by severity (critical first)
    const sortedIssues = [...this.issues].sort((a, b) => {
      const order = { critical: 0, major: 1, minor: 2, suggestion: 3 };
      // Use nullish coalescing to handle critical=0 correctly (0 || 4 would incorrectly return 4)
      return (order[a.severity] ?? 4) - (order[b.severity] ?? 4);
    });

    let stepNum = 1;
    for (const issue of sortedIssues) {
      if (issue.suggestedFix) {
        this.addFixStep(stepNum++, issue.suggestedFix, issue.location);
      } else {
        // Generate generic fix step
        this.addFixStep(
          stepNum++,
          `Fix ${issue.category}: ${issue.description}`,
          issue.location,
        );
      }
    }

    // Add verification step at the end
    if (this.fixSteps.length > 0) {
      this.addFixStep(stepNum, 'Run tests to verify all fixes are working');
    }
  }

  /**
   * Record a previous fix attempt for learning
   */
  recordPreviousAttempt(attempt) {
    this.previousAttempts.push({
      attemptNumber: this.previousAttempts.length + 1,
      timestamp: Date.now(),
      approach: attempt.approach,
      result: attempt.result, // 'success', 'partial', 'failed'
      remainingIssues: attempt.remainingIssues || [],
      feedback: attempt.feedback || null,
    });
  }

  /**
   * Get context for Coder agent to avoid repeating failed approaches
   */
  getCoderContext() {
    return {
      fixPlanId: this.id,
      priority: this.priority,
      complexity: this.estimatedComplexity,
      issueCount: this.issues.length,
      issues: this.issues.map(i => ({
        severity: i.severity,
        category: i.category,
        description: i.description,
        location: i.location,
        suggestedFix: i.suggestedFix,
      })),
      fixSteps: this.fixSteps,
      previousAttempts: this.previousAttempts.map(a => ({
        approach: a.approach,
        result: a.result,
        feedback: a.feedback,
      })),
      suggestedApproach: this.suggestedApproach,
      avoidApproaches: this.previousAttempts
        .filter(a => a.result === 'failed')
        .map(a => a.approach),
    };
  }

  /**
   * Update overall priority based on issues
   */
  _updatePriority() {
    if (this.issues.some(i => i.severity === IssueSeverity.CRITICAL)) {
      this.priority = 'critical';
      this.estimatedComplexity = 'complex';
    } else if (this.issues.some(i => i.severity === IssueSeverity.MAJOR)) {
      this.priority = 'major';
      this.estimatedComplexity = this.issues.length > 3 ? 'complex' : 'medium';
    } else {
      this.priority = 'minor';
      this.estimatedComplexity = this.issues.length > 5 ? 'medium' : 'simple';
    }
  }

  /**
   * Get a formatted summary for logging
   */
  getSummary() {
    return {
      id: this.id,
      priority: this.priority,
      complexity: this.estimatedComplexity,
      issueCount: this.issues.length,
      criticalCount: this.issues.filter(i => i.severity === IssueSeverity.CRITICAL).length,
      majorCount: this.issues.filter(i => i.severity === IssueSeverity.MAJOR).length,
      fixStepCount: this.fixSteps.length,
      previousAttempts: this.previousAttempts.length,
    };
  }
}

/**
 * Test Coverage Analysis - Tracks coverage quality and gaps
 */
export class TestCoverageAnalysis {
  constructor(stepId) {
    this.stepId = stepId;
    this.overallCoverage = 'none'; // none, poor, partial, good, excellent
    this.coveragePercent = 0;
    this.testedFiles = [];
    this.untestedFiles = [];
    this.testedFunctions = [];
    this.untestedFunctions = [];
    this.edgeCasesCovered = [];
    this.edgeCasesMissing = [];
    this.testQuality = 'unknown'; // unknown, poor, acceptable, good, excellent
  }

  /**
   * Analyze coverage from code output and test results
   */
  analyze(codeOutput, testResult) {
    // Track which files have tests
    const modifiedFiles = (codeOutput.files || []).map(f => f.path);
    const testFiles = (codeOutput.tests || []).map(t => t.path);

    for (const file of modifiedFiles) {
      // Simple heuristic: check if there's a corresponding test file
      const hasTest = testFiles.some(t =>
        t.includes(file.replace(/\.\w+$/, '')) ||
        t.includes(file.replace(/^src\//, 'test/').replace(/\.\w+$/, '')),
      );

      if (hasTest) {
        this.testedFiles.push(file);
      } else {
        this.untestedFiles.push(file);
      }
    }

    // Estimate coverage
    const totalFiles = modifiedFiles.length;
    const testedCount = this.testedFiles.length;

    if (totalFiles === 0) {
      this.overallCoverage = 'none';
      this.coveragePercent = 0;
    } else {
      this.coveragePercent = Math.round((testedCount / totalFiles) * 100);

      if (this.coveragePercent >= 90) {
        this.overallCoverage = 'excellent';
      } else if (this.coveragePercent >= 70) {
        this.overallCoverage = 'good';
      } else if (this.coveragePercent >= 40) {
        this.overallCoverage = 'partial';
      } else if (this.coveragePercent > 0) {
        this.overallCoverage = 'poor';
      } else {
        this.overallCoverage = 'none';
      }
    }

    // Assess test quality based on issues found
    if (testResult) {
      const issueCount = testResult.issues?.length || 0;
      if (issueCount === 0 && this.overallCoverage !== 'none') {
        this.testQuality = 'good';
      } else if (issueCount <= 2) {
        this.testQuality = 'acceptable';
      } else {
        this.testQuality = 'poor';
      }
    }
  }

  /**
   * Add missing edge case
   */
  addMissingEdgeCase(description, severity = 'medium') {
    this.edgeCasesMissing.push({ description, severity });
  }

  /**
   * Add covered edge case
   */
  addCoveredEdgeCase(description) {
    this.edgeCasesCovered.push({ description });
  }

  /**
   * Get coverage summary
   */
  getSummary() {
    return {
      overall: this.overallCoverage,
      percent: this.coveragePercent,
      quality: this.testQuality,
      testedFiles: this.testedFiles.length,
      untestedFiles: this.untestedFiles.length,
      edgeCasesCovered: this.edgeCasesCovered.length,
      edgeCasesMissing: this.edgeCasesMissing.length,
    };
  }
}

/**
 * Test execution result
 */
export class TestExecutionResult {
  constructor(command) {
    this.command = command;
    this.exitCode = null;
    this.stdout = '';
    this.stderr = '';
    this.duration = 0;
    this.passed = false;
    this.timedOut = false;
    this.failureDetails = [];
  }

  /**
   * Add failure detail from parsing
   */
  addFailureDetail(testName, message, stack = null) {
    this.failureDetails.push({
      testName,
      message,
      stack,
    });
  }
}

/**
 * Tester Agent
 */
export class TesterAgent extends BaseAgent {
  constructor(client, config = {}) {
    super(AgentRole.TESTER, client, config);

    this.model = config.model || 'sonnet';
    this.workingDirectory = config.workingDirectory || process.cwd();
    this.testTimeout = config.testTimeout || 5 * 60 * 1000; // 5 minutes
    this.testHistory = [];
    this.maxTestHistory = 30;

    // Test commands by project type
    this.testCommands = {
      node: ['npm test', 'npm run test', 'yarn test'],
      python: ['pytest', 'python -m pytest', 'python -m unittest'],
      go: ['go test ./...'],
      rust: ['cargo test'],
      make: ['make test'],
    };

    // Fix cycle tracking per step
    this.fixCycleTracker = new Map(); // stepId -> { attempts, maxAttempts, issues, status }
    this.maxFixCycles = config.maxFixCycles || 3;

    // Learning context from previous test runs
    this.learningContext = {
      commonIssues: [], // Patterns of issues seen across tests
      successfulFixes: [], // What worked before
      failedApproaches: [], // What didn't work
    };

    // Edge case patterns to check during exploratory testing
    this.edgeCasePatterns = [
      { name: 'null_undefined', description: 'null/undefined handling', keywords: ['null', 'undefined', 'optional'] },
      { name: 'empty_values', description: 'empty arrays/strings/objects', keywords: ['length', 'size', 'empty', 'forEach', 'map'] },
      { name: 'boundary_values', description: 'boundary conditions', keywords: ['max', 'min', 'limit', 'range', '0', '-1'] },
      { name: 'type_coercion', description: 'type coercion issues', keywords: ['==', 'parseInt', 'Number', 'String'] },
      { name: 'async_errors', description: 'async error handling', keywords: ['async', 'await', 'Promise', 'catch'] },
      { name: 'concurrent_access', description: 'race conditions', keywords: ['Promise.all', 'concurrent', 'parallel', 'race'] },
    ];

    // Register message handlers
    this.registerHandlers();
  }

  /**
   * Register message handlers
   */
  registerHandlers() {
    this.onMessage(MessageType.TEST_REQUEST, (msg) => this.handleTestRequest(msg));
  }

  /**
   * Handle test request from orchestrator
   */
  async handleTestRequest(message) {
    const { step, codeOutput, isRetry = false, previousFixPlan = null } = message.payload;

    this.status = AgentStatus.WORKING;

    try {
      // Initialize or update fix cycle tracking
      const fixCycleInfo = this.initializeFixCycle(step.id, previousFixPlan);

      const testResult = await this.runTests(step, codeOutput);

      // Perform coverage analysis
      const coverageAnalysis = new TestCoverageAnalysis(step.id);
      coverageAnalysis.analyze(codeOutput, testResult);
      testResult.coverageAnalysis = coverageAnalysis.getSummary();

      // Store in history
      this.addToHistory(testResult);

      // Generate detailed fix plan if tests failed
      let detailedFixPlan = null;
      if (!testResult.passed) {
        detailedFixPlan = await this.generateDetailedFixPlan(
          step,
          codeOutput,
          testResult,
          previousFixPlan,
          fixCycleInfo,
        );
        testResult.detailedFixPlan = detailedFixPlan;

        // Update fix cycle status
        this.updateFixCycleStatus(step.id, 'in_progress', testResult.issues);
      } else {
        // Mark fix cycle as resolved if this was a retry
        if (isRetry) {
          this.updateFixCycleStatus(step.id, 'resolved', []);
          this.recordSuccessfulFix(step.id, previousFixPlan);
        }
      }

      return message.createResponse(MessageType.TEST_RESPONSE, {
        success: testResult.passed,
        result: testResult,
        passed: testResult.passed,
        issues: testResult.issues,
        fixPlan: testResult.fixPlan,
        detailedFixPlan: detailedFixPlan?.getCoderContext() || null,
        coverageAnalysis: testResult.coverageAnalysis,
        fixCycleStatus: this.getFixCycleStatus(step.id),
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
        fixCycleStatus: this.getFixCycleStatus(step.id),
      });
    } finally {
      this.status = AgentStatus.IDLE;
    }
  }

  /**
   * Initialize fix cycle tracking for a step
   */
  initializeFixCycle(stepId, previousFixPlan = null) {
    if (!this.fixCycleTracker.has(stepId)) {
      this.fixCycleTracker.set(stepId, {
        attempts: 0,
        maxAttempts: this.maxFixCycles,
        issues: [],
        status: FixCycleStatus.NOT_STARTED,
        previousPlans: [],
      });
    }

    const tracker = this.fixCycleTracker.get(stepId);

    if (previousFixPlan) {
      tracker.attempts++;
      tracker.previousPlans.push({
        planId: previousFixPlan.id || `plan_${tracker.attempts}`,
        timestamp: Date.now(),
        issueCount: previousFixPlan.issues?.length || 0,
      });
    }

    return tracker;
  }

  /**
   * Update fix cycle status
   */
  updateFixCycleStatus(stepId, status, issues = []) {
    const tracker = this.fixCycleTracker.get(stepId);
    if (tracker) {
      tracker.status = status === 'resolved' ? FixCycleStatus.RESOLVED :
                       status === 'in_progress' ? FixCycleStatus.IN_PROGRESS :
                       tracker.attempts >= tracker.maxAttempts ? FixCycleStatus.MAX_ATTEMPTS_REACHED :
                       FixCycleStatus.IN_PROGRESS;
      tracker.issues = issues;
    }
  }

  /**
   * Get fix cycle status for a step
   */
  getFixCycleStatus(stepId) {
    const tracker = this.fixCycleTracker.get(stepId);
    if (!tracker) {
      return {
        status: FixCycleStatus.NOT_STARTED,
        attempts: 0,
        maxAttempts: this.maxFixCycles,
        canRetry: true,
      };
    }

    return {
      status: tracker.status,
      attempts: tracker.attempts,
      maxAttempts: tracker.maxAttempts,
      canRetry: tracker.attempts < tracker.maxAttempts &&
                tracker.status !== FixCycleStatus.RESOLVED,
      previousPlanCount: tracker.previousPlans.length,
    };
  }

  /**
   * Record a successful fix for learning
   */
  recordSuccessfulFix(stepId, fixPlan) {
    if (!fixPlan) return;

    this.learningContext.successfulFixes.push({
      stepId,
      timestamp: Date.now(),
      approach: fixPlan.suggestedApproach,
      issueTypes: fixPlan.issues?.map(i => i.category) || [],
    });

    // Keep learning context bounded
    if (this.learningContext.successfulFixes.length > 20) {
      this.learningContext.successfulFixes =
        this.learningContext.successfulFixes.slice(-20);
    }
  }

  /**
   * Record a failed fix approach for learning
   */
  recordFailedApproach(stepId, approach, reason) {
    this.learningContext.failedApproaches.push({
      stepId,
      timestamp: Date.now(),
      approach,
      reason,
    });

    // Keep learning context bounded
    if (this.learningContext.failedApproaches.length > 20) {
      this.learningContext.failedApproaches =
        this.learningContext.failedApproaches.slice(-20);
    }
  }

  /**
   * Generate a detailed fix plan with structured feedback for Coder
   */
  async generateDetailedFixPlan(step, codeOutput, testResult, previousFixPlan, fixCycleInfo) {
    const fixPlan = new DetailedFixPlan(testResult.id);

    // Add all issues from test result with enriched context
    for (const issue of testResult.issues) {
      fixPlan.addIssue({
        severity: issue.severity,
        category: this.categorizeIssue(issue),
        description: issue.description,
        location: issue.location,
        suggestedFix: this.generateSuggestedFix(issue, codeOutput),
      });
    }

    // Add issues from coverage analysis
    const coverageAnalysis = testResult.coverageAnalysis;
    if (coverageAnalysis?.untestedFiles > 0) {
      fixPlan.addIssue({
        severity: IssueSeverity.MINOR,
        category: IssueCategory.MISSING_TEST,
        description: `${coverageAnalysis.untestedFiles} files lack test coverage`,
        suggestedFix: 'Add unit tests for untested files',
      });
    }

    // Record previous attempt if this is a retry
    if (previousFixPlan) {
      fixPlan.recordPreviousAttempt({
        approach: previousFixPlan.suggestedApproach || 'unknown',
        result: testResult.passed ? 'success' : 'failed',
        remainingIssues: testResult.issues,
        feedback: this.generateAttemptFeedback(previousFixPlan, testResult),
      });
    }

    // Generate suggested approach based on learning context
    fixPlan.suggestedApproach = await this.generateSuggestedApproach(
      step,
      testResult,
      fixCycleInfo,
    );

    // Collect affected files
    fixPlan.affectedFiles = [
      ...(codeOutput.files || []).map(f => f.path),
    ];

    // Generate fix steps
    fixPlan.generateFixSteps();

    return fixPlan;
  }

  /**
   * Categorize an issue based on its description
   */
  categorizeIssue(issue) {
    const desc = (issue.description || '').toLowerCase();

    if (desc.includes('security') || desc.includes('injection') || desc.includes('xss')) {
      return IssueCategory.SECURITY;
    }
    if (desc.includes('test') && (desc.includes('fail') || desc.includes('error'))) {
      return IssueCategory.TEST_FAILURE;
    }
    if (desc.includes('edge case') || desc.includes('boundary') || desc.includes('null')) {
      return IssueCategory.EDGE_CASE;
    }
    if (desc.includes('error') && desc.includes('handle')) {
      return IssueCategory.ERROR_HANDLING;
    }
    if (desc.includes('performance') || desc.includes('slow') || desc.includes('memory')) {
      return IssueCategory.PERFORMANCE;
    }
    if (desc.includes('logic') || desc.includes('incorrect') || desc.includes('wrong')) {
      return IssueCategory.LOGIC_ERROR;
    }

    return IssueCategory.CODE_QUALITY;
  }

  /**
   * Generate a suggested fix for an issue
   */
  generateSuggestedFix(issue, codeOutput) {
    const category = this.categorizeIssue(issue);

    // Check learning context for similar issues
    const similarSuccess = this.learningContext.successfulFixes.find(f =>
      f.issueTypes.includes(category),
    );

    if (similarSuccess) {
      return `Previously successful approach: ${similarSuccess.approach}`;
    }

    // Generate based on category
    const fixTemplates = {
      [IssueCategory.TEST_FAILURE]: 'Fix the failing test by ensuring the implementation matches expected behavior',
      [IssueCategory.EDGE_CASE]: 'Add null/boundary checks before the problematic operation',
      [IssueCategory.ERROR_HANDLING]: 'Wrap the operation in try-catch and handle the specific error type',
      [IssueCategory.SECURITY]: 'Sanitize input and validate before use',
      [IssueCategory.PERFORMANCE]: 'Optimize the identified bottleneck or add caching',
      [IssueCategory.LOGIC_ERROR]: 'Review the algorithm logic and correct the condition/calculation',
      [IssueCategory.MISSING_TEST]: 'Add comprehensive tests covering the new functionality',
    };

    return fixTemplates[category] || `Address the ${category} issue: ${issue.description}`;
  }

  /**
   * Generate feedback about a previous fix attempt
   */
  generateAttemptFeedback(previousPlan, currentResult) {
    const previousIssueCount = previousPlan.issues?.length || 0;
    const currentIssueCount = currentResult.issues.length;

    if (currentIssueCount === 0) {
      return 'All issues resolved successfully';
    } else if (currentIssueCount < previousIssueCount) {
      return `Partial success: ${previousIssueCount - currentIssueCount} issues fixed, ${currentIssueCount} remaining`;
    } else if (currentIssueCount === previousIssueCount) {
      return 'No progress: same number of issues. Try a different approach';
    } else {
      return `Regression: ${currentIssueCount - previousIssueCount} new issues introduced`;
    }
  }

  /**
   * Generate a suggested approach based on context
   */
  async generateSuggestedApproach(step, testResult, fixCycleInfo) {
    // Build context for LLM
    const prompt = `Based on the following test failures, suggest the best approach to fix them.

Step: ${step.description}
Attempt: ${fixCycleInfo.attempts + 1} of ${fixCycleInfo.maxAttempts}

Issues found:
${testResult.issues.map(i => `- [${i.severity}] ${i.description}`).join('\n')}

${fixCycleInfo.previousPlans.length > 0 ? `
Previous attempts: ${fixCycleInfo.previousPlans.length}
Issues have persisted through previous fixes.
` : ''}

${this.learningContext.failedApproaches.length > 0 ? `
Approaches to avoid (failed before):
${this.learningContext.failedApproaches.slice(-3).map(a => `- ${a.approach}`).join('\n')}
` : ''}

Respond with a single sentence describing the recommended fix approach.`;

    try {
      const response = await this.client.sendPrompt(prompt, {
        newSession: true,
        timeout: 30000,
        model: this.model,
      });

      return response.response.trim().substring(0, 200);
    } catch (error) {
      // Fallback to generic approach
      const criticalCount = testResult.issues.filter(i => i.severity === 'critical').length;
      if (criticalCount > 0) {
        return 'Focus on fixing critical issues first, then address remaining issues';
      }
      return 'Address issues in order of severity, starting with the most impactful';
    }
  }

  /**
   * Run tests on code output
   */
  async runTests(step, codeOutput) {
    const testResult = new TestResult(step.id, 'combined');

    // Phase 1: Run automated tests if available
    const automatedResults = await this.runAutomatedTests(codeOutput);
    this.mergeTestResults(testResult, automatedResults);

    // Phase 2: Perform LLM-based exploratory testing
    const exploratoryResults = await this.runExploratoryTesting(step, codeOutput);
    this.mergeTestResults(testResult, exploratoryResults);

    // Determine overall pass/fail
    testResult.passed = testResult.issues.filter(i =>
      i.severity === 'critical' || i.severity === 'major'
    ).length === 0;

    // Generate fix plan if tests failed
    if (!testResult.passed) {
      testResult.generateFixPlan();
    }

    return testResult;
  }

  /**
   * Run automated test commands
   */
  async runAutomatedTests(codeOutput) {
    const result = new TestResult(null, 'automated');

    // Detect project type and get appropriate test commands
    const testCommands = await this.detectTestCommands();

    if (testCommands.length === 0) {
      result.addSuggestion('No test framework detected. Consider adding tests.', 'medium');
      result.passed = true; // No tests to fail
      return result;
    }

    // Run each test command
    for (const command of testCommands) {
      const execResult = await this.executeCommand(command);

      if (!execResult.passed) {
        // Parse test output for specific failures
        const failures = this.parseTestFailures(execResult);

        for (const failure of failures) {
          result.addIssue(failure.severity, failure.description, failure.location);
        }

        // If command completely failed
        if (execResult.exitCode !== 0 && failures.length === 0) {
          result.addIssue('major', `Test command failed: ${command}`, null);
        }
      }

      result.output += `\n=== ${command} ===\n${execResult.stdout}\n${execResult.stderr}`;
    }

    result.passed = result.issues.filter(i =>
      i.severity === 'critical' || i.severity === 'major'
    ).length === 0;

    return result;
  }

  /**
   * Run LLM-based exploratory testing
   */
  async runExploratoryTesting(step, codeOutput) {
    const result = new TestResult(step.id, 'exploratory');

    const prompt = this.buildExploratoryTestPrompt(step, codeOutput);

    try {
      const response = await this.client.sendPrompt(prompt, {
        newSession: true,
        timeout: 3 * 60 * 1000, // 3 minutes
        model: this.model,
      });

      // Parse exploratory test results
      this.parseExploratoryResults(response.response, result);

    } catch (error) {
      result.addSuggestion(`Exploratory testing unavailable: ${error.message}`, 'low');
    }

    result.passed = result.issues.filter(i =>
      i.severity === 'critical' || i.severity === 'major'
    ).length === 0;

    return result;
  }

  /**
   * Build prompt for exploratory testing
   */
  buildExploratoryTestPrompt(step, codeOutput) {
    const filesInfo = codeOutput.files?.map(f =>
      `- ${f.path} (${f.action}): ${f.content?.substring(0, 500) || 'content not available'}`
    ).join('\n') || 'No files available';

    const testsInfo = codeOutput.tests?.map(t =>
      `- ${t.path}: ${t.content?.substring(0, 300) || 'test content not available'}`
    ).join('\n') || 'No tests created';

    // Identify relevant edge case patterns based on code
    const codeContent = codeOutput.files?.map(f => f.content || '').join('\n') || '';
    const relevantPatterns = this.identifyRelevantEdgeCases(codeContent);
    const edgeCaseChecklist = relevantPatterns.length > 0
      ? `\n## EDGE CASES TO CHECK\n${relevantPatterns.map(p => `- ${p.description}`).join('\n')}`
      : '';

    // Include learning context if available
    const learningInfo = this.learningContext.commonIssues.length > 0
      ? `\n## COMMON ISSUES IN THIS CODEBASE\n${this.learningContext.commonIssues.slice(-5).map(i => `- ${i}`).join('\n')}`
      : '';

    return `You are a thorough QA engineer performing exploratory testing on new code.

## STEP BEING TESTED
Step ${step.number}: ${step.description}
Complexity: ${step.complexity}

## CODE CHANGES
${filesInfo}

## TESTS WRITTEN
${testsInfo}
${edgeCaseChecklist}
${learningInfo}

## YOUR TASK

Perform exploratory testing by analyzing the code for:

1. **Logic Errors**: Bugs, incorrect algorithms, wrong conditions
2. **Edge Cases**: Null/undefined handling, empty arrays, boundary values
3. **Error Handling**: Missing try/catch, unhandled promises, bad error messages
4. **Security Issues**: Input validation, injection risks, sensitive data exposure
5. **Performance**: Inefficient loops, memory leaks, blocking operations
6. **Code Quality**: Missing types, unclear names, code duplication

For each issue found, provide:
- Severity level (CRITICAL for security/data loss, MAJOR for broken functionality, MINOR for quality)
- Specific location in the code if identifiable
- Root cause if you can determine it
- Suggested fix

## OUTPUT FORMAT

Respond in EXACTLY this format:

ANALYSIS:
[Brief analysis of the code quality and test coverage]

ISSUES:
- [CRITICAL/MAJOR/MINOR] [Description] | [Location] | [Root cause] | [Suggested fix]
- [CRITICAL/MAJOR/MINOR] [Description] | [Location] | [Root cause] | [Suggested fix]
(or "None found" if no issues)

EDGE_CASES:
- [COVERED/MISSING] [Edge case description]
(List edge cases and whether they are tested)

SUGGESTIONS:
- [HIGH/MEDIUM/LOW] [Suggestion for improvement]
(or "None" if no suggestions)

COVERAGE:
[Estimate of test coverage: EXCELLENT/GOOD/PARTIAL/POOR/NONE]
[List any untested code paths]

VERDICT:
[PASS/FAIL] - [One sentence summary]`;
  }

  /**
   * Identify relevant edge case patterns based on code content
   */
  identifyRelevantEdgeCases(codeContent) {
    const relevant = [];

    for (const pattern of this.edgeCasePatterns) {
      const hasKeyword = pattern.keywords.some(keyword =>
        codeContent.toLowerCase().includes(keyword.toLowerCase()),
      );

      if (hasKeyword) {
        relevant.push(pattern);
      }
    }

    return relevant;
  }

  /**
   * Parse exploratory testing results
   */
  parseExploratoryResults(response, result) {
    // Parse issues with enhanced format (includes root cause and suggested fix)
    const issuesSection = response.match(/ISSUES:\s*\n([\s\S]*?)(?=EDGE_CASES:|SUGGESTIONS:|COVERAGE:|VERDICT:|$)/i);
    if (issuesSection && !issuesSection[1].toLowerCase().includes('none found')) {
      const issueLines = issuesSection[1].split('\n').filter(l => l.trim().startsWith('-'));

      for (const line of issueLines) {
        // Enhanced format: - [SEVERITY] Description | Location | Root cause | Suggested fix
        const enhancedMatch = line.match(/-\s*\[(CRITICAL|MAJOR|MINOR)\]\s*([^|]+?)(?:\s*\|\s*([^|]+?))?(?:\s*\|\s*([^|]+?))?(?:\s*\|\s*(.+))?$/i);
        if (enhancedMatch) {
          const severity = enhancedMatch[1].toLowerCase();
          const description = enhancedMatch[2].trim();
          const location = enhancedMatch[3]?.trim() || null;
          const rootCause = enhancedMatch[4]?.trim() || null;
          const suggestedFix = enhancedMatch[5]?.trim() || null;

          result.addIssue(severity, description, location);

          // Store enriched data for later use in fix plans
          const issue = result.issues[result.issues.length - 1];
          issue.rootCause = rootCause;
          issue.suggestedFix = suggestedFix;

          // Add to learning context if it's a new pattern
          if (severity === 'critical' || severity === 'major') {
            this.addToCommonIssues(description);
          }
        } else {
          // Fallback to simpler format
          const simpleMatch = line.match(/-\s*\[(CRITICAL|MAJOR|MINOR)\]\s*(.+?)(?:\s*\|\s*(.+))?$/i);
          if (simpleMatch) {
            result.addIssue(
              simpleMatch[1].toLowerCase(),
              simpleMatch[2].trim(),
              simpleMatch[3]?.trim() || null,
            );
          }
        }
      }
    }

    // Parse edge cases section
    const edgeCasesSection = response.match(/EDGE_CASES:\s*\n([\s\S]*?)(?=SUGGESTIONS:|COVERAGE:|VERDICT:|$)/i);
    if (edgeCasesSection) {
      const edgeCaseLines = edgeCasesSection[1].split('\n').filter(l => l.trim().startsWith('-'));
      result.edgeCases = { covered: [], missing: [] };

      for (const line of edgeCaseLines) {
        const match = line.match(/-\s*\[(COVERED|MISSING)\]\s*(.+)$/i);
        if (match) {
          const status = match[1].toUpperCase();
          const description = match[2].trim();

          if (status === 'COVERED') {
            result.edgeCases.covered.push(description);
          } else {
            result.edgeCases.missing.push(description);
            // Add minor issue for missing edge case
            result.addIssue('minor', `Missing edge case test: ${description}`);
          }
        }
      }
    }

    // Parse suggestions
    const suggestionsSection = response.match(/SUGGESTIONS:\s*\n([\s\S]*?)(?=COVERAGE:|VERDICT:|$)/i);
    if (suggestionsSection && !suggestionsSection[1].toLowerCase().includes('none')) {
      const suggestionLines = suggestionsSection[1].split('\n').filter(l => l.trim().startsWith('-'));

      for (const line of suggestionLines) {
        const match = line.match(/-\s*\[(HIGH|MEDIUM|LOW)\]\s*(.+)$/i);
        if (match) {
          result.addSuggestion(match[2].trim(), match[1].toLowerCase());
        }
      }
    }

    // Parse coverage (enhanced to include EXCELLENT)
    const coverageMatch = response.match(/COVERAGE:\s*\n?\s*(EXCELLENT|GOOD|PARTIAL|POOR|NONE)/i);
    if (coverageMatch) {
      result.coverage = coverageMatch[1].toUpperCase();
    }

    // Parse verdict
    const verdictMatch = response.match(/VERDICT:\s*\n?\s*(PASS|FAIL)/i);
    if (verdictMatch) {
      result.passed = verdictMatch[1].toUpperCase() === 'PASS';
    }
  }

  /**
   * Add an issue pattern to the learning context
   */
  addToCommonIssues(description) {
    // Extract key pattern from description
    const pattern = description.substring(0, 100);

    // Don't add duplicates
    if (!this.learningContext.commonIssues.includes(pattern)) {
      this.learningContext.commonIssues.push(pattern);

      // Keep bounded
      if (this.learningContext.commonIssues.length > 10) {
        this.learningContext.commonIssues =
          this.learningContext.commonIssues.slice(-10);
      }
    }
  }

  /**
   * Reset tester state for a new goal
   */
  resetForNewGoal() {
    this.fixCycleTracker.clear();
    this.testHistory = [];
    // Keep learning context as it's valuable across goals
  }

  /**
   * Get enhanced statistics
   */
  getEnhancedStats() {
    const passedCount = this.testHistory.filter(h => h.passed).length;
    const failedCount = this.testHistory.length - passedCount;

    // Calculate average issues per failed test
    const failedTests = this.testHistory.filter(h => !h.passed);
    const avgIssuesPerFailure = failedTests.length > 0
      ? Math.round(failedTests.reduce((sum, t) => sum + t.issueCount, 0) / failedTests.length)
      : 0;

    // Get fix cycle stats
    const fixCycleStats = {
      totalCycles: this.fixCycleTracker.size,
      resolved: 0,
      inProgress: 0,
      maxAttemptsReached: 0,
    };

    for (const tracker of this.fixCycleTracker.values()) {
      if (tracker.status === FixCycleStatus.RESOLVED) {
        fixCycleStats.resolved++;
      } else if (tracker.status === FixCycleStatus.MAX_ATTEMPTS_REACHED) {
        fixCycleStats.maxAttemptsReached++;
      } else if (tracker.status === FixCycleStatus.IN_PROGRESS) {
        fixCycleStats.inProgress++;
      }
    }

    return {
      ...this.getStats(),
      passedCount,
      failedCount,
      avgIssuesPerFailure,
      fixCycleStats,
      learningContext: {
        commonIssuesCount: this.learningContext.commonIssues.length,
        successfulFixesCount: this.learningContext.successfulFixes.length,
        failedApproachesCount: this.learningContext.failedApproaches.length,
      },
    };
  }

  /**
   * Detect available test commands for the project
   */
  async detectTestCommands() {
    const commands = [];

    // Check for package.json (Node.js)
    try {
      const { readFile } = await import('fs/promises');
      const packageJson = JSON.parse(
        await readFile(`${this.workingDirectory}/package.json`, 'utf8')
      );

      if (packageJson.scripts?.test &&
          packageJson.scripts.test !== 'echo "Error: no test specified" && exit 1') {
        commands.push('npm test');
      }
    } catch (e) {
      // Not a Node.js project
    }

    // Check for pytest.ini or setup.py (Python)
    try {
      const { stat } = await import('fs/promises');
      await stat(`${this.workingDirectory}/pytest.ini`);
      commands.push('pytest');
    } catch (e) {
      try {
        const { stat } = await import('fs/promises');
        await stat(`${this.workingDirectory}/setup.py`);
        commands.push('pytest');
      } catch (e2) {
        // Not a Python project
      }
    }

    // Check for go.mod (Go)
    try {
      const { stat } = await import('fs/promises');
      await stat(`${this.workingDirectory}/go.mod`);
      commands.push('go test ./...');
    } catch (e) {
      // Not a Go project
    }

    // Check for Cargo.toml (Rust)
    try {
      const { stat } = await import('fs/promises');
      await stat(`${this.workingDirectory}/Cargo.toml`);
      commands.push('cargo test');
    } catch (e) {
      // Not a Rust project
    }

    // Check for Makefile with test target
    try {
      const { readFile } = await import('fs/promises');
      const makefile = await readFile(`${this.workingDirectory}/Makefile`, 'utf8');
      if (makefile.includes('test:')) {
        commands.push('make test');
      }
    } catch (e) {
      // No Makefile
    }

    return commands;
  }

  /**
   * Execute a shell command
   */
  async executeCommand(command) {
    const result = new TestExecutionResult(command);
    const startTime = Date.now();

    return new Promise((resolve) => {
      const [cmd, ...args] = command.split(/\s+/);

      const proc = spawn(cmd, args, {
        cwd: this.workingDirectory,
        shell: true,
        timeout: this.testTimeout,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      proc.stdout.on('data', (data) => {
        result.stdout += data.toString();
      });

      proc.stderr.on('data', (data) => {
        result.stderr += data.toString();
      });

      proc.on('close', (code) => {
        result.exitCode = code ?? 0;
        result.duration = Date.now() - startTime;
        result.passed = code === 0;
        resolve(result);
      });

      proc.on('error', (err) => {
        result.exitCode = -1;
        result.stderr += err.message;
        result.duration = Date.now() - startTime;
        result.passed = false;
        resolve(result);
      });

      // Timeout handling
      setTimeout(() => {
        proc.kill('SIGTERM');
        result.timedOut = true;
        result.passed = false;
        resolve(result);
      }, this.testTimeout);
    });
  }

  /**
   * Parse test failures from command output
   */
  parseTestFailures(execResult) {
    const failures = [];
    const output = execResult.stdout + execResult.stderr;

    // Common test failure patterns
    const patterns = [
      // Jest/Node
      /FAIL\s+(.+?)\n.*?●\s+(.+?)(?:\n|$)/g,
      /Error:\s+(.+?)(?:\n|$)/g,
      /AssertionError:\s+(.+?)(?:\n|$)/g,

      // Pytest
      /FAILED\s+(.+?)::\w+\s+-\s+(.+?)(?:\n|$)/g,
      /AssertionError:\s+(.+?)(?:\n|$)/g,

      // Go
      /---\s+FAIL:\s+(\w+)\s+\([\d.]+s\)\n\s+(.+?)(?:\n|$)/g,

      // Generic
      /(?:error|failed|failure):\s*(.+?)(?:\n|$)/gi,
    ];

    for (const pattern of patterns) {
      const matches = output.matchAll(pattern);
      for (const match of matches) {
        const description = match[2] || match[1];
        const location = match[2] ? match[1] : null;

        if (description && !failures.some(f => f.description === description)) {
          failures.push({
            severity: 'major',
            description: description.trim().substring(0, 200),
            location: location?.trim(),
          });
        }
      }
    }

    return failures.slice(0, 10); // Limit to 10 failures
  }

  /**
   * Merge test results
   */
  mergeTestResults(target, source) {
    // Merge issues
    for (const issue of source.issues || []) {
      target.addIssue(issue.severity, issue.description, issue.location);
    }

    // Merge suggestions
    for (const suggestion of source.suggestions || []) {
      target.addSuggestion(suggestion.description, suggestion.priority);
    }

    // Merge output
    if (source.output) {
      target.output = (target.output || '') + '\n' + source.output;
    }

    // Update coverage if better info available
    if (source.coverage && (!target.coverage || source.coverage !== 'NONE')) {
      target.coverage = source.coverage;
    }
  }

  /**
   * Add to test history
   */
  addToHistory(testResult) {
    this.testHistory.push({
      timestamp: Date.now(),
      testId: testResult.id,
      stepId: testResult.stepId,
      passed: testResult.passed,
      issueCount: testResult.issues.length,
      coverage: testResult.coverage,
    });

    // Trim history
    if (this.testHistory.length > this.maxTestHistory) {
      this.testHistory = this.testHistory.slice(-this.maxTestHistory);
    }
  }

  /**
   * Execute method (for BaseAgent compatibility)
   */
  async execute(task) {
    if (task.type === 'test') {
      return this.runTests(task.step, task.codeOutput);
    }
    throw new Error(`Unknown task type: ${task.type}`);
  }

  /**
   * Get agent statistics
   */
  getStats() {
    const passedCount = this.testHistory.filter(h => h.passed).length;

    return {
      ...super.getStats(),
      model: this.model,
      testsRun: this.testHistory.length,
      passRate: this.testHistory.length > 0
        ? Math.round((passedCount / this.testHistory.length) * 100)
        : null,
      recentTests: this.testHistory.slice(-5).map(h => ({
        stepId: h.stepId,
        passed: h.passed,
        issues: h.issueCount,
        coverage: h.coverage,
      })),
    };
  }
}

export default TesterAgent;
