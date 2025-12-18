/**
 * Coder Agent - Step-by-Step Implementation with Test Writing
 *
 * The Coder agent is responsible for:
 * 1. Implementing plan steps one at a time
 * 2. Writing tests for each implementation
 * 3. Applying fixes based on Tester feedback
 * 4. Signaling when steps are blocked for re-planning
 *
 * Uses Opus model for intelligent code generation.
 */

import {
  BaseAgent,
  AgentRole,
  AgentStatus,
  MessageType,
  AgentMessage,
  FixCycleStatus,
} from './interfaces.js';

// Configuration
const MAX_FIX_ATTEMPTS = 3;
const REQUIRE_TESTS_DEFAULT = true;

/**
 * Code output structure
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

  /**
   * Request a sub-plan when step is too complex
   */
  requestSubPlan(reason) {
    this.requiresSubPlan = true;
    this.subPlanReason = reason;
    this.blocked = true;
    this.blockReason = `Requires sub-plan: ${reason}`;
  }

  /**
   * Update test coverage tracking
   */
  updateTestCoverage() {
    this.testCoverage.testCount = this.tests.length;
    this.testCoverage.hasTests = this.tests.length > 0;

    // Estimate coverage based on test to file ratio
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

  /**
   * Assess implementation quality
   */
  assessQuality() {
    let score = 100;
    const issues = [];
    const strengths = [];

    // Check for tests
    if (!this.testCoverage.hasTests) {
      score -= 20;
      issues.push('No tests provided');
    } else {
      strengths.push(`${this.testCoverage.testCount} test file(s) created`);
    }

    // Check for files
    if (this.files.length === 0) {
      score -= 30;
      issues.push('No files modified');
    } else {
      strengths.push(`${this.files.length} file(s) modified`);
    }

    // Check for summary
    if (!this.summary || this.summary.length < 20) {
      score -= 10;
      issues.push('Missing or brief summary');
    }

    // Bonus for comprehensive implementation
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

  /**
   * Check if implementation meets minimum quality
   */
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
 * Coder Agent
 */
export class CoderAgent extends BaseAgent {
  constructor(client, config = {}) {
    super(AgentRole.CODER, client, config);

    this.model = config.model || 'opus';
    this.workingDirectory = config.workingDirectory || process.cwd();
    this.sessionId = null; // Persistent session for context
    this.codeHistory = [];
    this.maxCodeHistory = 30;

    // Configuration
    this.requireTests = config.requireTests ?? REQUIRE_TESTS_DEFAULT;
    this.maxFixAttempts = config.maxFixAttempts || MAX_FIX_ATTEMPTS;

    // Track fix cycles per step
    this.fixCycles = new Map(); // stepId -> { attempts, issues, fixes }

    // Track steps that need sub-plans
    this.subPlanRequests = new Map(); // stepId -> { reason, complexity, attempts }

    // Store context for better implementation
    this.implementationContext = {
      projectPatterns: [],
      successfulApproaches: [],
      failedApproaches: [],
    };

    // Register message handlers
    this.registerHandlers();
  }

  /**
   * Register message handlers
   */
  registerHandlers() {
    this.onMessage(MessageType.CODE_REQUEST, (msg) => this.handleCodeRequest(msg));
    this.onMessage(MessageType.CODE_FIX_REQUEST, (msg) => this.handleCodeFixRequest(msg));
  }

  /**
   * Handle code implementation request
   */
  async handleCodeRequest(message) {
    const { step, context, enforceTests } = message.payload;

    this.status = AgentStatus.WORKING;

    try {
      const codeOutput = await this.implementStep(step, context);

      // Update test coverage and quality assessment
      codeOutput.updateTestCoverage();
      codeOutput.assessQuality();

      // Store in history
      this.addToHistory(codeOutput);

      // Check if step needs sub-plan
      if (codeOutput.requiresSubPlan) {
        this.trackSubPlanRequest(step, codeOutput.subPlanReason);

        return message.createResponse(MessageType.CODE_RESPONSE, {
          success: false,
          output: codeOutput,
          blocked: true,
          blockReason: codeOutput.blockReason,
          requiresSubPlan: true,
          subPlanReason: codeOutput.subPlanReason,
        });
      }

      // Check test requirements
      const requireTestsForStep = enforceTests ?? this.requireTests;
      if (requireTestsForStep && !codeOutput.testCoverage.hasTests && !codeOutput.blocked) {
        // Request tests if missing
        const testsOutput = await this.requestTestsForImplementation(step, codeOutput);
        if (testsOutput.tests.length > 0) {
          // Merge test output
          codeOutput.tests.push(...testsOutput.tests);
          codeOutput.updateTestCoverage();
          codeOutput.assessQuality();
        }
      }

      return message.createResponse(MessageType.CODE_RESPONSE, {
        success: !codeOutput.blocked,
        output: codeOutput,
        blocked: codeOutput.blocked,
        blockReason: codeOutput.blockReason,
        quality: codeOutput.implementationQuality,
        testCoverage: codeOutput.testCoverage,
      });

    } catch (error) {
      const errorOutput = new CodeOutput(step.id);
      errorOutput.setBlocked(`Implementation error: ${error.message}`);

      return message.createResponse(MessageType.CODE_RESPONSE, {
        success: false,
        output: errorOutput,
        blocked: true,
        blockReason: error.message,
      });
    } finally {
      this.status = AgentStatus.IDLE;
    }
  }

  /**
   * Track sub-plan request for a step
   */
  trackSubPlanRequest(step, reason) {
    const existing = this.subPlanRequests.get(step.id) || {
      reason: [],
      complexity: step.complexity,
      attempts: 0,
    };

    existing.attempts++;
    existing.reason.push(reason);
    this.subPlanRequests.set(step.id, existing);
  }

  /**
   * Request tests for an implementation that's missing them
   */
  async requestTestsForImplementation(step, codeOutput) {
    const prompt = this.buildTestRequestPrompt(step, codeOutput);

    const result = await this.client.sendPrompt(prompt, {
      model: this.model,
      timeout: 5 * 60 * 1000,
    });

    const testOutput = new CodeOutput(step.id);
    this.parseImplementationResponse(result.response, testOutput);

    return testOutput;
  }

  /**
   * Build prompt to request tests for existing implementation
   */
  buildTestRequestPrompt(step, codeOutput) {
    const filesModified = codeOutput.files.map(f => `- \`${f.path}\``).join('\n');

    return `## TESTS REQUIRED

You implemented Step ${step.number}: "${step.description}" but did not include tests.

## FILES MODIFIED
${filesModified}

## TASK
Write comprehensive unit tests for this implementation. Include:
1. Tests for the main functionality
2. Edge case tests
3. Error handling tests

## OUTPUT FORMAT

### Tests Created
- \`path/to/test.ext\` - [test description]

### Test Code
\`\`\`language
[Test code]
\`\`\`

### Status
COMPLETE

Write the tests now.`;
  }

  /**
   * Handle code fix request (from Tester feedback)
   */
  async handleCodeFixRequest(message) {
    const { step, fixPlan } = message.payload;

    this.status = AgentStatus.WORKING;

    try {
      // Track fix cycle
      const fixCycle = this.trackFixCycle(step.id, fixPlan);

      // Check if max attempts reached
      if (fixCycle.attempts > this.maxFixAttempts) {
        const errorOutput = new CodeOutput(step.id);
        errorOutput.fixAttempt = fixCycle.attempts;
        errorOutput.fixCycleStatus = FixCycleStatus.MAX_ATTEMPTS_REACHED;
        errorOutput.setBlocked(`Max fix attempts (${this.maxFixAttempts}) reached`);

        // Suggest sub-plan instead
        errorOutput.requestSubPlan(
          `Unable to fix after ${this.maxFixAttempts} attempts. Issues: ${fixPlan.issues?.map(i => i.description).join('; ')}`
        );

        return message.createResponse(MessageType.CODE_RESPONSE, {
          success: false,
          output: errorOutput,
          blocked: true,
          blockReason: errorOutput.blockReason,
          fixApplied: false,
          maxAttemptsReached: true,
          requiresSubPlan: true,
          subPlanReason: errorOutput.subPlanReason,
        });
      }

      const codeOutput = await this.applyFix(step, fixPlan, fixCycle);

      // Update tracking
      codeOutput.fixAttempt = fixCycle.attempts;
      codeOutput.fixCycleStatus = codeOutput.blocked
        ? FixCycleStatus.IN_PROGRESS
        : FixCycleStatus.RESOLVED;

      codeOutput.updateTestCoverage();
      codeOutput.assessQuality();

      // Store in history
      this.addToHistory(codeOutput);

      // Record success or failure for learning
      if (!codeOutput.blocked) {
        this.recordSuccessfulFix(step, fixPlan, codeOutput);
      } else {
        this.recordFailedFix(step, fixPlan, codeOutput);
      }

      return message.createResponse(MessageType.CODE_RESPONSE, {
        success: !codeOutput.blocked,
        output: codeOutput,
        blocked: codeOutput.blocked,
        blockReason: codeOutput.blockReason,
        fixApplied: !codeOutput.blocked,
        fixAttempt: fixCycle.attempts,
        remainingAttempts: this.maxFixAttempts - fixCycle.attempts,
        quality: codeOutput.implementationQuality,
      });

    } catch (error) {
      const errorOutput = new CodeOutput(step.id);
      errorOutput.setBlocked(`Fix error: ${error.message}`);
      errorOutput.fixCycleStatus = FixCycleStatus.IN_PROGRESS;

      return message.createResponse(MessageType.CODE_RESPONSE, {
        success: false,
        output: errorOutput,
        blocked: true,
        blockReason: error.message,
      });
    } finally {
      this.status = AgentStatus.IDLE;
    }
  }

  /**
   * Track fix cycle for a step
   */
  trackFixCycle(stepId, fixPlan) {
    const existing = this.fixCycles.get(stepId) || {
      attempts: 0,
      issues: [],
      fixes: [],
      startTime: Date.now(),
    };

    existing.attempts++;
    existing.issues.push({
      attempt: existing.attempts,
      issues: fixPlan.issues || [],
      timestamp: Date.now(),
    });

    this.fixCycles.set(stepId, existing);
    return existing;
  }

  /**
   * Record a successful fix for learning
   */
  recordSuccessfulFix(step, fixPlan, codeOutput) {
    this.implementationContext.successfulApproaches.push({
      stepId: step.id,
      issues: fixPlan.issues?.map(i => i.description) || [],
      approach: codeOutput.summary,
      timestamp: Date.now(),
    });

    // Limit stored approaches
    if (this.implementationContext.successfulApproaches.length > 20) {
      this.implementationContext.successfulApproaches =
        this.implementationContext.successfulApproaches.slice(-20);
    }
  }

  /**
   * Record a failed fix for learning
   */
  recordFailedFix(step, fixPlan, codeOutput) {
    this.implementationContext.failedApproaches.push({
      stepId: step.id,
      issues: fixPlan.issues?.map(i => i.description) || [],
      attempt: codeOutput.summary,
      reason: codeOutput.blockReason,
      timestamp: Date.now(),
    });

    // Limit stored approaches
    if (this.implementationContext.failedApproaches.length > 20) {
      this.implementationContext.failedApproaches =
        this.implementationContext.failedApproaches.slice(-20);
    }
  }

  /**
   * Implement a single plan step
   */
  async implementStep(step, context = {}) {
    const prompt = this.buildImplementationPrompt(step, context);
    const codeOutput = new CodeOutput(step.id);

    // Use persistent session or start new one
    let result;
    if (this.sessionId) {
      result = await this.client.sendPrompt(prompt, {
        model: this.model,
        timeout: 10 * 60 * 1000, // 10 minutes for complex steps
      });
    } else {
      const systemContext = this.buildSystemContext();
      result = await this.client.startSession(systemContext, prompt);
      this.sessionId = result.sessionId;
    }

    // Parse the response
    this.parseImplementationResponse(result.response, codeOutput);

    return codeOutput;
  }

  /**
   * Apply a fix based on Tester feedback
   */
  async applyFix(step, fixPlan, fixCycle = null) {
    const prompt = this.buildFixPrompt(step, fixPlan, fixCycle);
    const codeOutput = new CodeOutput(step.id);

    const result = await this.client.sendPrompt(prompt, {
      model: this.model,
      timeout: 5 * 60 * 1000,
    });

    // Parse the response
    this.parseImplementationResponse(result.response, codeOutput);
    codeOutput.summary = `Fix applied for: ${fixPlan.issues?.map(i => i.description).join(', ') || 'issues'}`;

    return codeOutput;
  }

  /**
   * Build system context for new sessions
   */
  buildSystemContext() {
    return `You are an expert software developer working autonomously on a programming task.

## WORKING DIRECTORY
${this.workingDirectory}

## YOUR ROLE
You are the CODER agent in a multi-agent system. Your responsibilities:
1. Implement code changes step by step
2. Write tests for your implementations
3. Execute commands to verify your work
4. Report clearly what you did and what files you modified

## GUIDELINES

### Code Quality
- Write clean, well-structured code
- Follow existing patterns in the codebase
- Add appropriate error handling
- Include comments for complex logic

### Testing
- Write unit tests for new functions
- Update existing tests when modifying code
- Test edge cases and error conditions

### Communication
- List all files created or modified
- Show key code snippets
- Report any issues or blockers clearly
- Say "STEP BLOCKED: [reason]" if you cannot proceed

## OUTPUT FORMAT
Always structure your response with:
1. Brief summary of what you're implementing
2. Files created/modified (with paths)
3. Key code snippets
4. Tests written
5. Commands executed (if any)
6. Status: COMPLETE or BLOCKED`;
  }

  /**
   * Build implementation prompt for a step
   */
  buildImplementationPrompt(step, context = {}) {
    const planContext = context.plan
      ? `\n## OVERALL PLAN\n${context.plan.analysis || context.plan.goal}`
      : '';

    const previousSteps = context.completedSteps
      ? `\n## COMPLETED STEPS\n${context.completedSteps.map(s => `✓ ${s.description}`).join('\n')}`
      : '';

    return `## CURRENT TASK

Implement Step ${step.number}: ${step.description}
Complexity: ${step.complexity}
${planContext}
${previousSteps}

## INSTRUCTIONS

1. **Analyze** what needs to be done for this step
2. **Implement** the required code changes
3. **Write tests** for your implementation
4. **Verify** your changes work correctly

## REQUIREMENTS

- Create or modify the necessary files
- Write appropriate tests (unit tests preferred)
- Show the actual code you're writing
- List all files you create or modify with their full paths
- If you encounter a blocker, say "STEP BLOCKED: [reason]"

## OUTPUT FORMAT

Provide your implementation with:

### Summary
[Brief description of what you implemented]

### Files Modified
- \`path/to/file.ext\` - [what was changed]

### Implementation
\`\`\`language
[Key code snippets]
\`\`\`

### Tests Created
- \`path/to/test.ext\` - [test description]

### Commands Run
\`\`\`bash
[Any commands you executed]
\`\`\`

### Status
[COMPLETE or BLOCKED: reason]

Begin implementation now.`;
  }

  /**
   * Build fix prompt based on Tester feedback
   */
  buildFixPrompt(step, fixPlan, fixCycle = null) {
    const issues = fixPlan.issues || [];
    const issueList = issues.map((issue, i) =>
      `${i + 1}. [${issue.severity}] ${issue.description}${issue.location ? ` (at ${issue.location})` : ''}`
    ).join('\n');

    // Add context from previous fix attempts
    let previousAttemptsSection = '';
    if (fixCycle && fixCycle.attempts > 1) {
      const previousIssues = fixCycle.issues.slice(0, -1); // Exclude current
      previousAttemptsSection = `
## PREVIOUS FIX ATTEMPTS (${fixCycle.attempts - 1} attempts made)

⚠️ These approaches did NOT work - try something DIFFERENT:
${previousIssues.map((attempt, i) =>
  `Attempt ${i + 1}: Tried to fix: ${attempt.issues.map(iss => iss.description).join(', ')}`
).join('\n')}

You MUST try a different approach this time.
`;
    }

    // Add context from similar successful fixes
    let successfulPatterns = '';
    const similarSuccesses = this.implementationContext.successfulApproaches.slice(-3);
    if (similarSuccesses.length > 0) {
      successfulPatterns = `
## SUCCESSFUL PATTERNS (approaches that worked before)
${similarSuccesses.map(s => `- ${s.approach?.substring(0, 100) || 'Fix applied successfully'}`).join('\n')}
`;
    }

    return `## FIX REQUIRED

The tests for Step ${step.number} ("${step.description}") have failed.

## ISSUES TO FIX

${issueList}

## FIX PRIORITY
${fixPlan.priority || 'normal'}
${previousAttemptsSection}
${successfulPatterns}
## INSTRUCTIONS

1. **Analyze** each issue carefully
2. **Fix** the problems in the code
3. **Update tests** if needed
4. **Verify** the fixes address the issues

## REQUIREMENTS

- Address ALL listed issues
- Don't introduce new problems
- Keep existing functionality working
- Show the fixed code clearly
${fixCycle && fixCycle.attempts > 1 ? '- Try a DIFFERENT approach than previous attempts' : ''}

## OUTPUT FORMAT

### Summary
[Brief description of fixes applied]

### Files Modified
- \`path/to/file.ext\` - [what was fixed]

### Fixes Applied
\`\`\`language
[Fixed code snippets]
\`\`\`

### Status
[COMPLETE or BLOCKED: reason]

Apply the fixes now.`;
  }

  /**
   * Parse Claude's implementation response
   */
  parseImplementationResponse(response, codeOutput) {
    // Check for blocked status
    const blockedMatch = response.match(/STEP\s+BLOCKED[:\s]*(.+?)(?:\n|$)/i);
    if (blockedMatch) {
      codeOutput.setBlocked(blockedMatch[1].trim());
    }

    // Extract summary
    const summaryMatch = response.match(/###?\s*Summary\s*\n([\s\S]*?)(?=###|\n\n\n|$)/i);
    if (summaryMatch) {
      codeOutput.summary = summaryMatch[1].trim().substring(0, 500);
    }

    // Extract files modified
    const filesSection = response.match(/###?\s*Files\s+(?:Modified|Created|Changed)\s*\n([\s\S]*?)(?=###|$)/i);
    if (filesSection) {
      const fileMatches = filesSection[1].matchAll(/[`-]\s*([^\s`]+\.[a-zA-Z]+)[`]?/g);
      for (const match of fileMatches) {
        const path = match[1].trim();
        if (path && !path.startsWith('#')) {
          codeOutput.addFile(path, 'modified', null);
        }
      }
    }

    // Extract code blocks
    const codeBlocks = response.matchAll(/```(\w*)\n([\s\S]*?)```/g);
    for (const match of codeBlocks) {
      const language = match[1] || 'text';
      const content = match[2].trim();

      // Try to identify file path from context
      const pathContext = response.substring(
        Math.max(0, match.index - 200),
        match.index
      );
      const pathMatch = pathContext.match(/[`]([^\s`]+\.[a-zA-Z]+)[`]/);

      if (pathMatch && content.length > 10) {
        const existingFile = codeOutput.files.find(f => f.path === pathMatch[1]);
        if (existingFile) {
          existingFile.content = content;
          existingFile.language = language;
        } else {
          codeOutput.addFile(pathMatch[1], 'created', content, language);
        }
      }
    }

    // Extract test files
    const testsSection = response.match(/###?\s*Tests?\s+(?:Created|Written|Added)\s*\n([\s\S]*?)(?=###|$)/i);
    if (testsSection) {
      const testMatches = testsSection[1].matchAll(/[`-]\s*([^\s`]+(?:test|spec)[^\s`]*\.[a-zA-Z]+)[`]?/gi);
      for (const match of testMatches) {
        const path = match[1].trim();
        if (path) {
          codeOutput.addTest(path, 'unit', null);
        }
      }
    }

    // Extract commands run
    const commandBlocks = response.matchAll(/```(?:bash|sh|shell|console)?\n([\s\S]*?)```/g);
    for (const match of commandBlocks) {
      const content = match[1].trim();
      // Filter to likely commands (not code)
      const lines = content.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('$') || trimmed.startsWith('#')) {
          codeOutput.addCommand(trimmed.replace(/^[$#]\s*/, ''));
        } else if (trimmed.match(/^(npm|yarn|pnpm|node|python|go|cargo|make|git|cd|ls|mkdir|rm|cp|mv|cat|echo)\s/)) {
          codeOutput.addCommand(trimmed);
        }
      }
    }

    // Check for completion status
    const statusMatch = response.match(/###?\s*Status\s*\n\s*(COMPLETE|BLOCKED)/i);
    if (statusMatch && statusMatch[1].toUpperCase() === 'COMPLETE') {
      codeOutput.blocked = false;
    }

    return codeOutput;
  }

  /**
   * Add to code history
   */
  addToHistory(codeOutput) {
    this.codeHistory.push({
      timestamp: Date.now(),
      codeId: codeOutput.id,
      stepId: codeOutput.stepId,
      filesCount: codeOutput.files.length,
      testsCount: codeOutput.tests.length,
      blocked: codeOutput.blocked,
    });

    // Trim history
    if (this.codeHistory.length > this.maxCodeHistory) {
      this.codeHistory = this.codeHistory.slice(-this.maxCodeHistory);
    }
  }

  /**
   * Reset session (for new plan)
   */
  resetSession() {
    this.sessionId = null;
  }

  /**
   * Execute method (for BaseAgent compatibility)
   */
  async execute(task) {
    if (task.type === 'implement') {
      return this.implementStep(task.step, task.context);
    } else if (task.type === 'fix') {
      return this.applyFix(task.step, task.fixPlan);
    }
    throw new Error(`Unknown task type: ${task.type}`);
  }

  /**
   * Get agent statistics
   */
  getStats() {
    // Calculate fix cycle stats
    let totalFixAttempts = 0;
    let resolvedFixes = 0;
    for (const [stepId, cycle] of this.fixCycles) {
      totalFixAttempts += cycle.attempts;
      if (cycle.fixes.some(f => f.resolved)) resolvedFixes++;
    }

    return {
      ...super.getStats(),
      model: this.model,
      sessionActive: !!this.sessionId,
      requireTests: this.requireTests,
      implementationsCount: this.codeHistory.length,
      blockedCount: this.codeHistory.filter(h => h.blocked).length,
      fixCyclesTracked: this.fixCycles.size,
      totalFixAttempts,
      subPlanRequests: this.subPlanRequests.size,
      implementationContext: {
        successfulApproaches: this.implementationContext.successfulApproaches.length,
        failedApproaches: this.implementationContext.failedApproaches.length,
        projectPatterns: this.implementationContext.projectPatterns.length,
      },
      recentImplementations: this.codeHistory.slice(-5).map(h => ({
        stepId: h.stepId,
        files: h.filesCount,
        tests: h.testsCount,
        blocked: h.blocked,
      })),
    };
  }

  /**
   * Reset state for a new goal
   */
  resetForNewGoal() {
    this.sessionId = null;
    this.fixCycles.clear();
    this.subPlanRequests.clear();
    // Keep implementation context for learning across goals
  }

  /**
   * Reset all state
   */
  resetAll() {
    this.resetForNewGoal();
    this.codeHistory = [];
    this.implementationContext = {
      projectPatterns: [],
      successfulApproaches: [],
      failedApproaches: [],
    };
  }

  /**
   * Get fix cycle status for a step
   */
  getFixCycleStatus(stepId) {
    const cycle = this.fixCycles.get(stepId);
    if (!cycle) return null;

    return {
      attempts: cycle.attempts,
      maxAttempts: this.maxFixAttempts,
      remainingAttempts: Math.max(0, this.maxFixAttempts - cycle.attempts),
      canContinue: cycle.attempts < this.maxFixAttempts,
      issues: cycle.issues,
    };
  }

  /**
   * Check if step requires sub-plan
   */
  needsSubPlan(stepId) {
    return this.subPlanRequests.has(stepId);
  }

  /**
   * Get sub-plan request details
   */
  getSubPlanRequest(stepId) {
    return this.subPlanRequests.get(stepId);
  }
}

export default CoderAgent;
