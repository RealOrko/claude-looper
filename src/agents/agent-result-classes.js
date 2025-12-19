/**
 * agent-result-classes.js - Common result classes for agent outputs
 *
 * Contains data structures for capturing code output, test execution results,
 * and test coverage analysis. These classes are shared across multiple agents.
 */

import { FixCycleStatus } from './interfaces.js';

/**
 * Code output structure - captures implementation results from Coder agent
 */
export class CodeOutput {
  constructor(stepId) {
    this.id = `code_${Date.now()}`;
    this.stepId = stepId;
    this.files = []; // { path, action, content, language }
    this.commands = []; // Shell commands executed
    this.tests = []; // Test files created
    this.summary = '';
    this.blocked = false;
    this.blockReason = null;
    this.timestamp = Date.now();

    // Enhanced tracking
    this.requiresSubPlan = false;
    this.subPlanReason = null;
    this.testCoverage = {
      hasTests: false,
      testCount: 0,
      coverageEstimate: 'none', // none, partial, good, excellent
    };
    this.implementationQuality = {
      score: 0,
      issues: [],
      strengths: [],
    };
    this.fixAttempt = 0;
    this.fixCycleStatus = FixCycleStatus.NOT_STARTED;
  }

  addFile(path, action, content, language = null) {
    this.files.push({
      path,
      action, // created, modified, deleted
      content: content?.substring(0, 5000), // Limit stored content
      language: language || this.detectLanguage(path),
    });
  }

  addCommand(command, output = '', exitCode = 0) {
    this.commands.push({
      command,
      output: output?.substring(0, 2000),
      exitCode,
      timestamp: Date.now(),
    });
  }

  addTest(path, testType, content) {
    this.tests.push({
      path,
      testType, // unit, integration, e2e
      content: content?.substring(0, 3000),
    });
  }

  detectLanguage(path) {
    const ext = path.split('.').pop()?.toLowerCase();
    const langMap = {
      js: 'javascript',
      ts: 'typescript',
      py: 'python',
      go: 'go',
      rs: 'rust',
      java: 'java',
      rb: 'ruby',
      php: 'php',
      c: 'c',
      cpp: 'cpp',
      h: 'c',
      hpp: 'cpp',
      cs: 'csharp',
      swift: 'swift',
      kt: 'kotlin',
      sh: 'bash',
      yaml: 'yaml',
      yml: 'yaml',
      json: 'json',
      md: 'markdown',
      sql: 'sql',
    };
    return langMap[ext] || 'text';
  }

  setBlocked(reason) {
    this.blocked = true;
    this.blockReason = reason;
  }

  requestSubPlan(reason) {
    this.requiresSubPlan = true;
    this.subPlanReason = reason;
    this.blocked = true;
    this.blockReason = `Requires sub-plan: ${reason}`;
  }

  updateTestCoverage() {
    this.testCoverage.testCount = this.tests.length;
    this.testCoverage.hasTests = this.tests.length > 0;

    const sourceFiles = this.files.filter(f =>
      !f.path.includes('test') && !f.path.includes('spec')
    ).length;

    if (sourceFiles === 0 || this.tests.length === 0) {
      this.testCoverage.coverageEstimate = 'none';
    } else if (this.tests.length >= sourceFiles) {
      this.testCoverage.coverageEstimate = 'good';
    } else if (this.tests.length >= sourceFiles * 0.5) {
      this.testCoverage.coverageEstimate = 'partial';
    } else {
      this.testCoverage.coverageEstimate = 'minimal';
    }
  }

  assessQuality() {
    let score = 100;
    const issues = [];
    const strengths = [];

    if (!this.testCoverage.hasTests) {
      score -= 20;
      issues.push('No tests provided');
    } else {
      strengths.push(`${this.testCoverage.testCount} test file(s) created`);
    }

    if (this.files.length === 0) {
      score -= 30;
      issues.push('No files modified');
    } else {
      strengths.push(`${this.files.length} file(s) modified`);
    }

    if (!this.summary || this.summary.length < 20) {
      score -= 10;
      issues.push('Missing or brief summary');
    }

    if (this.files.length > 0 && this.tests.length > 0 && this.summary.length > 50) {
      score += 10;
      strengths.push('Comprehensive implementation with tests and documentation');
    }

    this.implementationQuality = {
      score: Math.max(0, Math.min(100, score)),
      issues,
      strengths,
    };

    return this.implementationQuality;
  }

  meetsMinimumQuality(requireTests = true) {
    this.updateTestCoverage();
    this.assessQuality();

    if (this.blocked) return false;
    if (this.files.length === 0) return false;
    if (requireTests && !this.testCoverage.hasTests) return false;

    return this.implementationQuality.score >= 50;
  }

  getArtifacts() {
    return {
      filesCreated: this.files.filter(f => f.action === 'created').map(f => f.path),
      filesModified: this.files.filter(f => f.action === 'modified').map(f => f.path),
      testsCreated: this.tests.map(t => t.path),
      commandsRun: this.commands.length,
      testCoverage: this.testCoverage,
      quality: this.implementationQuality,
    };
  }
}

/**
 * Test execution result - captures results of running a test command
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

  addFailureDetail(testName, message, stack = null) {
    this.failureDetails.push({
      testName,
      message,
      stack,
    });
  }
}

/**
 * Test coverage analysis - tracks coverage quality and gaps
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

  analyze(codeOutput, testResult) {
    const modifiedFiles = (codeOutput.files || []).map(f => f.path);
    const testFiles = (codeOutput.tests || []).map(t => t.path);

    for (const file of modifiedFiles) {
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

  addMissingEdgeCase(description, severity = 'medium') {
    this.edgeCasesMissing.push({ description, severity });
  }

  addCoveredEdgeCase(description) {
    this.edgeCasesCovered.push({ description });
  }

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

export default { CodeOutput, TestExecutionResult, TestCoverageAnalysis };
