/**
 * Test Coverage Analysis
 * Tracks coverage quality, gaps, and test execution results
 */

/**
 * Test Coverage Analysis - Tracks coverage quality and gaps
 */
export class TestCoverageAnalysis {
  constructor(stepId) {
    this.stepId = stepId;
    this.overallCoverage = 'none';
    this.coveragePercent = 0;
    this.testedFiles = [];
    this.untestedFiles = [];
    this.testedFunctions = [];
    this.untestedFunctions = [];
    this.edgeCasesCovered = [];
    this.edgeCasesMissing = [];
    this.testQuality = 'unknown';
  }

  /**
   * Analyze coverage from code output and test results
   */
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
      this.overallCoverage = this._determineCoverageLevel(this.coveragePercent);
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

  _determineCoverageLevel(percent) {
    if (percent >= 90) return 'excellent';
    if (percent >= 70) return 'good';
    if (percent >= 40) return 'partial';
    if (percent > 0) return 'poor';
    return 'none';
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

  addFailureDetail(testName, message, stack = null) {
    this.failureDetails.push({ testName, message, stack });
  }
}

/**
 * Edge case patterns to check during exploratory testing
 */
export const EDGE_CASE_PATTERNS = [
  { name: 'null_undefined', description: 'null/undefined handling', keywords: ['null', 'undefined', 'optional'] },
  { name: 'empty_values', description: 'empty arrays/strings/objects', keywords: ['length', 'size', 'empty', 'forEach', 'map'] },
  { name: 'boundary_values', description: 'boundary conditions', keywords: ['max', 'min', 'limit', 'range', '0', '-1'] },
  { name: 'type_coercion', description: 'type coercion issues', keywords: ['==', 'parseInt', 'Number', 'String'] },
  { name: 'async_errors', description: 'async error handling', keywords: ['async', 'await', 'Promise', 'catch'] },
  { name: 'concurrent_access', description: 'race conditions', keywords: ['Promise.all', 'concurrent', 'parallel', 'race'] },
];

/**
 * Identify relevant edge case patterns based on code content
 */
export function identifyRelevantEdgeCases(codeContent) {
  const relevant = [];

  for (const pattern of EDGE_CASE_PATTERNS) {
    const hasKeyword = pattern.keywords.some(keyword =>
      codeContent.toLowerCase().includes(keyword.toLowerCase()),
    );

    if (hasKeyword) {
      relevant.push(pattern);
    }
  }

  return relevant;
}
