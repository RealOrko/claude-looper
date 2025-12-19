/**
 * Fix Plan Classes
 * Provides structured feedback to Coder agent for fixing issues
 */

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
      codeChange,
      completed: false,
    });
  }

  /**
   * Generate fix steps from issues
   */
  generateFixSteps() {
    const sortedIssues = [...this.issues].sort((a, b) => {
      const order = { critical: 0, major: 1, minor: 2, suggestion: 3 };
      return (order[a.severity] ?? 4) - (order[b.severity] ?? 4);
    });

    let stepNum = 1;
    for (const issue of sortedIssues) {
      if (issue.suggestedFix) {
        this.addFixStep(stepNum++, issue.suggestedFix, issue.location);
      } else {
        this.addFixStep(stepNum++, `Fix ${issue.category}: ${issue.description}`, issue.location);
      }
    }

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
      result: attempt.result,
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
 * Categorize an issue based on its description
 */
export function categorizeIssue(issue) {
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
 * Generate a suggested fix for an issue based on category
 */
export function generateSuggestedFix(issue, learningContext = null) {
  const category = categorizeIssue(issue);

  if (learningContext?.successfulFixes) {
    const similarSuccess = learningContext.successfulFixes.find(f =>
      f.issueTypes.includes(category),
    );
    if (similarSuccess) {
      return `Previously successful approach: ${similarSuccess.approach}`;
    }
  }

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
export function generateAttemptFeedback(previousPlan, currentResult) {
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
