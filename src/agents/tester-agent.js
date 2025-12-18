/**
 * Tester Agent - Exploratory Testing and Fix Plan Generation
 *
 * The Tester agent is responsible for:
 * 1. Running tests on Coder's implementations
 * 2. Performing exploratory testing to find edge cases
 * 3. Generating fix plans when tests fail
 * 4. Providing feedback to the Coder agent for fixes
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
} from './interfaces.js';
import { spawn } from 'child_process';

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
    const { step, codeOutput } = message.payload;

    this.status = AgentStatus.WORKING;

    try {
      const testResult = await this.runTests(step, codeOutput);

      // Store in history
      this.addToHistory(testResult);

      return message.createResponse(MessageType.TEST_RESPONSE, {
        success: testResult.passed,
        result: testResult,
        passed: testResult.passed,
        issues: testResult.issues,
        fixPlan: testResult.fixPlan,
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
      });
    } finally {
      this.status = AgentStatus.IDLE;
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

    return `You are a thorough QA engineer performing exploratory testing on new code.

## STEP BEING TESTED
Step ${step.number}: ${step.description}
Complexity: ${step.complexity}

## CODE CHANGES
${filesInfo}

## TESTS WRITTEN
${testsInfo}

## YOUR TASK

Perform exploratory testing by analyzing the code for:

1. **Logic Errors**: Bugs, incorrect algorithms, wrong conditions
2. **Edge Cases**: Null/undefined handling, empty arrays, boundary values
3. **Error Handling**: Missing try/catch, unhandled promises, bad error messages
4. **Security Issues**: Input validation, injection risks, sensitive data exposure
5. **Performance**: Inefficient loops, memory leaks, blocking operations
6. **Code Quality**: Missing types, unclear names, code duplication

## OUTPUT FORMAT

Respond in EXACTLY this format:

ANALYSIS:
[Brief analysis of the code quality and test coverage]

ISSUES:
- [CRITICAL/MAJOR/MINOR] [Description] | [Location if known]
- [CRITICAL/MAJOR/MINOR] [Description] | [Location if known]
(or "None found" if no issues)

SUGGESTIONS:
- [HIGH/MEDIUM/LOW] [Suggestion for improvement]
(or "None" if no suggestions)

COVERAGE:
[Estimate of test coverage: GOOD/PARTIAL/POOR/NONE]

VERDICT:
[PASS/FAIL] - [One sentence summary]`;
  }

  /**
   * Parse exploratory testing results
   */
  parseExploratoryResults(response, result) {
    // Parse issues
    const issuesSection = response.match(/ISSUES:\s*\n([\s\S]*?)(?=SUGGESTIONS:|COVERAGE:|VERDICT:|$)/i);
    if (issuesSection && !issuesSection[1].toLowerCase().includes('none found')) {
      const issueLines = issuesSection[1].split('\n').filter(l => l.trim().startsWith('-'));

      for (const line of issueLines) {
        const match = line.match(/-\s*\[(CRITICAL|MAJOR|MINOR)\]\s*(.+?)(?:\s*\|\s*(.+))?$/i);
        if (match) {
          const severity = match[1].toLowerCase();
          const description = match[2].trim();
          const location = match[3]?.trim() || null;
          result.addIssue(severity, description, location);
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

    // Parse coverage
    const coverageMatch = response.match(/COVERAGE:\s*\n?\s*(GOOD|PARTIAL|POOR|NONE)/i);
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
