/**
 * Completion Verifier - Multi-layer verification of completion claims
 * Prevents Claude from falsely claiming task completion
 */

import { spawn } from 'child_process';
import { stat, readFile } from 'fs/promises';
import { join, isAbsolute } from 'path';

// Memory limits
const MAX_VERIFICATION_HISTORY = 20;

export class CompletionVerifier {
  constructor(client, goalTracker, config) {
    this.client = client;
    this.goalTracker = goalTracker;
    this.config = config;
    this.verificationHistory = [];
  }

  /**
   * Add to verification history with bounds check
   */
  addToHistory(result) {
    this.verificationHistory.push(result);
    if (this.verificationHistory.length > MAX_VERIFICATION_HISTORY) {
      this.verificationHistory = this.verificationHistory.slice(-MAX_VERIFICATION_HISTORY);
    }
  }

  /**
   * Run a command and return success/output
   */
  async runCommand(cmd, cwd, timeout = 60000) {
    try {
      const result = await this.execCommand(cmd, cwd, timeout);
      return {
        success: result.exitCode === 0,
        output: result.stdout + result.stderr,
        exitCode: result.exitCode,
      };
    } catch (error) {
      return {
        success: false,
        output: error.message,
        exitCode: -1,
      };
    }
  }

  /**
   * Get verification config with defaults
   */
  getVerificationConfig() {
    const config = this.config?.get('verification') || {};
    return {
      enabled: config.enabled ?? true,
      maxAttempts: config.maxAttempts ?? 3,
      challengeTimeout: config.challengeTimeout ?? 5 * 60 * 1000,
      testTimeout: config.testTimeout ?? 5 * 60 * 1000,
      requireArtifacts: config.requireArtifacts ?? true,
      runTests: config.runTests ?? true,
      testCommands: config.testCommands || ['npm test', 'pytest', 'go test ./...'],
      buildCommands: config.buildCommands || ['npm run build', 'make'],
    };
  }

  /**
   * Main verification entry point
   * Returns verification result with pass/fail for each layer
   */
  async verify(completionClaim, workingDirectory) {
    const result = {
      passed: false,
      layers: {
        challenge: null,
        artifacts: null,
        validation: null,
      },
      evidence: null,
      failures: [],
      timestamp: Date.now(),
    };

    const verifyConfig = this.getVerificationConfig();

    // Layer 1: LLM Challenge - ask for concrete evidence
    result.layers.challenge = await this.challengeCompletion(completionClaim);
    if (!result.layers.challenge.passed) {
      result.failures.push('Failed LLM challenge - insufficient or vague evidence provided');
      this.addToHistory(result);
      return result;
    }
    result.evidence = result.layers.challenge.evidence;

    // Layer 2: Artifact Inspection - verify files exist
    if (result.evidence.files.length > 0) {
      result.layers.artifacts = await this.verifyArtifacts(
        result.evidence.files,
        workingDirectory
      );
      if (!result.layers.artifacts.passed) {
        const missing = result.layers.artifacts.missing;
        const empty = result.layers.artifacts.empty;
        if (missing.length > 0) {
          result.failures.push(`Missing files: ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? '...' : ''}`);
        }
        if (empty.length > 0) {
          result.failures.push(`Empty files: ${empty.join(', ')}`);
        }
        this.addToHistory(result);
        return result;
      }
    } else if (verifyConfig.requireArtifacts && !this.isReadOnlyTask(result.evidence)) {
      // No files mentioned but artifacts required (and not a read-only task)
      result.layers.artifacts = { passed: false, verified: [], missing: [], empty: [] };
      result.failures.push('No file artifacts mentioned - completion claim lacks evidence');
      this.addToHistory(result);
      return result;
    } else {
      result.layers.artifacts = { passed: true, verified: [], missing: [], empty: [], skipped: true };
    }

    // Layer 3: Test Validation - run tests if available
    if (verifyConfig.runTests) {
      result.layers.validation = await this.runValidation(
        result.evidence,
        workingDirectory
      );
      if (!result.layers.validation.passed) {
        result.failures.push(`Validation failed: ${result.layers.validation.error || 'Tests did not pass'}`);
        this.addToHistory(result);
        return result;
      }
    } else {
      result.layers.validation = { passed: true, skipped: true, testsRun: [], testsFailed: [] };
    }

    // All layers passed
    result.passed = true;
    this.addToHistory(result);
    return result;
  }

  /**
   * Layer 1: Challenge Claude to provide concrete evidence
   */
  async challengeCompletion(completionClaim) {
    const result = {
      passed: false,
      evidence: null,
      response: null,
    };

    try {
      const challengePrompt = this.buildChallengePrompt(completionClaim);

      // Send challenge to Claude (using same session to maintain context)
      const response = await this.client.continueConversation(challengePrompt);
      result.response = response.response;

      // Parse the evidence from Claude's response
      const evidence = this.parseEvidence(response.response);
      result.evidence = evidence;

      // Evaluate if evidence is sufficient
      result.passed = this.evaluateEvidence(evidence);

    } catch (error) {
      result.error = error.message;
      result.passed = false;
    }

    return result;
  }

  /**
   * Build the challenge prompt for verification
   */
  buildChallengePrompt(completionClaim) {
    const goal = this.goalTracker.primaryGoal;
    const subGoals = this.goalTracker.subGoals;

    return `## COMPLETION VERIFICATION REQUIRED

You claimed the task is complete. Before this can be accepted, you must provide concrete, verifiable evidence.

**Original Goal:** ${goal}

**Your Completion Claim:**
${completionClaim.substring(0, 800)}

---

**REQUIRED EVIDENCE - Respond with ALL of the following:**

### 1. FILES CREATED OR MODIFIED
List every file you created or modified. Use exact paths (relative to working directory or absolute).
Format each as: \`path/to/file.ext\`

### 2. KEY IMPLEMENTATION
Show the most critical piece of code you wrote. Include:
- File path
- The actual code (not a description)

### 3. VERIFICATION METHOD
How can this be tested? Provide ONE of:
- Test command to run (e.g., \`npm test\`, \`pytest\`)
- Build command (e.g., \`npm run build\`)
- Manual verification steps

### 4. SUB-GOAL CHECKLIST
Confirm each sub-goal is complete:
${subGoals.length > 0
  ? subGoals.map(g => `- [ ] ${g.description}`).join('\n')
  : '- [ ] Primary goal completed'}

---

**IMPORTANT:**
- Be specific. Vague responses will be REJECTED.
- List actual file paths, not descriptions.
- If you cannot provide evidence, admit it and continue working.

Provide your evidence now:`;
  }

  /**
   * Parse evidence from Claude's challenge response
   */
  parseEvidence(response) {
    const evidence = {
      files: [],
      testCommands: [],
      buildCommands: [],
      codeSnippets: [],
      subGoalConfirmations: 0,
      raw: response,
    };

    if (!response) return evidence;

    // Extract file paths (various formats)
    const filePatterns = [
      /`([^`\s]+\.\w+)`/g,                                    // `file.ext` in backticks
      /`([^`\s]+\/[^`\s]+)`/g,                                // `path/to/file` in backticks
      /(?:^|\s)(\.\/[\w\-\/\.]+\.\w+)/gm,                     // ./relative/path.ext
      /(?:^|\s)(src\/[\w\-\/\.]+\.\w+)/gm,                    // src/path.ext
      /(?:created?|modified?|wrote|edited?|updated?)\s+[`"]?([^\s`"]+\.\w+)[`"]?/gi,
      /(?:file|path):\s*[`"]?([^\s`"]+\.\w+)[`"]?/gi,
    ];

    const seenFiles = new Set();
    for (const pattern of filePatterns) {
      const matches = response.matchAll(pattern);
      for (const match of matches) {
        let filePath = match[1]?.trim();
        if (filePath && !seenFiles.has(filePath)) {
          // Filter out common false positives
          if (!this.isLikelyFalsePositive(filePath)) {
            seenFiles.add(filePath);
            evidence.files.push(filePath);
          }
        }
      }
    }

    // Extract test commands
    const testPatterns = [
      /`(npm\s+(?:test|run\s+test)[^`]*)`/gi,
      /`(pytest[^`]*)`/gi,
      /`(go\s+test[^`]*)`/gi,
      /`(cargo\s+test[^`]*)`/gi,
      /`(make\s+test[^`]*)`/gi,
      /(?:run|execute|test):\s*`([^`]+)`/gi,
    ];

    for (const pattern of testPatterns) {
      const matches = response.matchAll(pattern);
      for (const match of matches) {
        const cmd = match[1]?.trim();
        if (cmd && !evidence.testCommands.includes(cmd)) {
          evidence.testCommands.push(cmd);
        }
      }
    }

    // Extract build commands
    const buildPatterns = [
      /`(npm\s+run\s+build[^`]*)`/gi,
      /`(go\s+build[^`]*)`/gi,
      /`(cargo\s+build[^`]*)`/gi,
      /`(make(?:\s+\w+)?)`/gi,
    ];

    for (const pattern of buildPatterns) {
      const matches = response.matchAll(pattern);
      for (const match of matches) {
        const cmd = match[1]?.trim();
        if (cmd && !evidence.buildCommands.includes(cmd)) {
          evidence.buildCommands.push(cmd);
        }
      }
    }

    // Count sub-goal confirmations (checked boxes)
    const checkboxMatches = response.match(/- \[x\]/gi);
    evidence.subGoalConfirmations = checkboxMatches ? checkboxMatches.length : 0;

    // Extract code snippets (content in code blocks)
    const codeBlockPattern = /```[\w]*\n([\s\S]*?)```/g;
    const codeMatches = response.matchAll(codeBlockPattern);
    for (const match of codeMatches) {
      const code = match[1]?.trim();
      if (code && code.length > 20) {
        evidence.codeSnippets.push(code.substring(0, 500));
      }
    }

    return evidence;
  }

  /**
   * Check if a file path is likely a false positive
   */
  isLikelyFalsePositive(filePath) {
    const falsePositives = [
      /^https?:/i,           // URLs
      /^mailto:/i,           // Email links
      /^\d+\.\d+/,           // Version numbers
      /^[A-Z]+:/,            // Windows drive letters or labels
      /example\./i,          // Example files
      /placeholder/i,        // Placeholder text
    ];

    return falsePositives.some(pattern => pattern.test(filePath));
  }

  /**
   * Detect if this is a read-only/analysis task based on evidence response
   */
  isReadOnlyTask(evidence) {
    const raw = (evidence.raw || '').toLowerCase();
    const readOnlyIndicators = [
      'no files were created',
      'no files were modified',
      'read-only',
      'analysis task',
      'counting task',
      'none - this was',
      '**none**',
      'none.',
      'did not create',
      'did not modify',
      'only ran commands',
      'only executed',
    ];
    return readOnlyIndicators.some(indicator => raw.includes(indicator));
  }

  /**
   * Evaluate if evidence is sufficient
   */
  evaluateEvidence(evidence) {
    // Check if this is a read-only/analysis task
    const isReadOnly = this.isReadOnlyTask(evidence);

    if (isReadOnly) {
      // For read-only tasks, require code snippets showing commands/output OR sub-goal confirmations
      const hasEvidence =
        evidence.codeSnippets.length > 0 ||
        evidence.subGoalConfirmations > 0;
      return hasEvidence;
    }

    // For file-creating tasks, must have files mentioned
    if (evidence.files.length === 0) {
      return false;
    }

    // Should have either code snippets or test/build commands
    const hasVerificationMethod =
      evidence.codeSnippets.length > 0 ||
      evidence.testCommands.length > 0 ||
      evidence.buildCommands.length > 0;

    if (!hasVerificationMethod) {
      return false;
    }

    return true;
  }

  /**
   * Layer 2: Verify that claimed artifacts exist on disk
   */
  async verifyArtifacts(files, workingDirectory) {
    const result = {
      passed: true,
      verified: [],
      missing: [],
      empty: [],
    };

    for (const file of files) {
      const fullPath = isAbsolute(file)
        ? file
        : join(workingDirectory, file);

      try {
        const stats = await stat(fullPath);
        if (stats.size === 0) {
          result.empty.push(file);
        } else {
          result.verified.push(file);
        }
      } catch (e) {
        result.missing.push(file);
      }
    }

    // Fail if significant artifacts are missing
    // Allow some slack - not every mentioned file needs to exist
    const totalClaimed = files.length;
    const totalVerified = result.verified.length;
    const missingRatio = result.missing.length / totalClaimed;

    if (totalVerified === 0 && totalClaimed > 0) {
      result.passed = false;
    } else if (missingRatio > 0.5) {
      // More than half of claimed files are missing
      result.passed = false;
    } else if (result.empty.length > result.verified.length) {
      // More empty files than verified ones
      result.passed = false;
    }

    return result;
  }

  /**
   * Layer 3: Run validation tests/builds
   */
  async runValidation(evidence, workingDirectory) {
    const result = {
      passed: true,
      testsRun: [],
      testsFailed: [],
      error: null,
    };

    const verifyConfig = this.getVerificationConfig();

    // Determine which commands to run
    let commandsToRun = [];

    // Prefer commands from evidence (Claude's claim)
    if (evidence.testCommands.length > 0) {
      commandsToRun = evidence.testCommands.slice(0, 2);
    } else {
      // Try to detect available test commands
      commandsToRun = await this.detectAvailableCommands(workingDirectory, verifyConfig);
    }

    // If no commands available, skip validation (pass by default)
    if (commandsToRun.length === 0) {
      result.skipped = true;
      return result;
    }

    // Run each command
    for (const cmd of commandsToRun) {
      try {
        const execResult = await this.execCommand(cmd, workingDirectory, verifyConfig.testTimeout);
        result.testsRun.push({
          cmd,
          exitCode: execResult.exitCode,
          stdout: execResult.stdout.substring(0, 1000),
          stderr: execResult.stderr.substring(0, 500),
        });

        if (execResult.exitCode !== 0) {
          result.testsFailed.push(cmd);
          result.passed = false;
          result.error = `Command failed: ${cmd} (exit code ${execResult.exitCode})`;
          // Don't run more commands if one fails
          break;
        }
      } catch (e) {
        // Command not found or execution error
        // Only fail if this was a command Claude claimed would work
        if (evidence.testCommands.includes(cmd)) {
          result.passed = false;
          result.error = `Claimed command failed to execute: ${cmd}`;
          break;
        }
        // Otherwise, just skip this command
      }
    }

    return result;
  }

  /**
   * Detect available test/build commands in the working directory
   */
  async detectAvailableCommands(workingDirectory, config) {
    const commands = [];

    // Check for package.json with test script
    try {
      const packageJsonPath = join(workingDirectory, 'package.json');
      const content = await readFile(packageJsonPath, 'utf8');
      const pkg = JSON.parse(content);
      if (pkg.scripts?.test && pkg.scripts.test !== 'echo "Error: no test specified" && exit 1') {
        commands.push('npm test');
      }
    } catch (e) {
      // No package.json or invalid
    }

    // Check for pytest (Python)
    try {
      const hasSetupPy = await stat(join(workingDirectory, 'setup.py')).then(() => true).catch(() => false);
      const hasPytestIni = await stat(join(workingDirectory, 'pytest.ini')).then(() => true).catch(() => false);
      const hasTestDir = await stat(join(workingDirectory, 'tests')).then(() => true).catch(() => false);

      if (hasPytestIni || hasSetupPy || hasTestDir) {
        commands.push('pytest');
      }
    } catch (e) {
      // No Python project indicators
    }

    // Check for Makefile with test target
    try {
      const makefilePath = join(workingDirectory, 'Makefile');
      const content = await readFile(makefilePath, 'utf8');
      if (content.includes('test:')) {
        commands.push('make test');
      }
    } catch (e) {
      // No Makefile
    }

    return commands.slice(0, 2); // Max 2 commands
  }

  /**
   * Execute a shell command
   */
  execCommand(cmd, cwd, timeout = 5 * 60 * 1000) {
    return new Promise((resolve, reject) => {
      const [command, ...args] = cmd.split(/\s+/);

      const proc = spawn(command, args, {
        cwd,
        shell: true,
        timeout,
        stdio: ['ignore', 'pipe', 'pipe'], // Close stdin to prevent blocking on prompts
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        resolve({
          exitCode: code ?? 0,
          stdout,
          stderr,
        });
      });

      proc.on('error', (err) => {
        reject(err);
      });

      // Timeout handling
      setTimeout(() => {
        proc.kill('SIGTERM');
        reject(new Error(`Command timed out after ${timeout}ms`));
      }, timeout);
    });
  }

  /**
   * Generate rejection prompt when verification fails
   */
  generateRejectionPrompt(verificationResult) {
    const failures = verificationResult.failures;

    let prompt = `## COMPLETION CLAIM REJECTED

Your completion claim could not be verified. The following issues were found:

${failures.map((f, i) => `${i + 1}. ${f}`).join('\n')}

`;

    // Add specific guidance based on what failed
    if (verificationResult.layers.challenge && !verificationResult.layers.challenge.passed) {
      prompt += `
**Issue: Insufficient Evidence**
You did not provide clear, specific evidence of completion. Please:
- List actual file paths you created/modified
- Show real code, not descriptions
- Provide runnable test or verification commands
`;
    }

    if (verificationResult.layers.artifacts && !verificationResult.layers.artifacts.passed) {
      const missing = verificationResult.layers.artifacts.missing || [];
      prompt += `
**Issue: Missing Files**
The following files you claimed to create do not exist:
${missing.slice(0, 5).map(f => `- ${f}`).join('\n')}

Please create these files or correct your claim.
`;
    }

    if (verificationResult.layers.validation && !verificationResult.layers.validation.passed) {
      prompt += `
**Issue: Tests/Validation Failed**
${verificationResult.layers.validation.error || 'The test or build command did not succeed.'}

Please fix the failing tests or build errors before claiming completion.
`;
    }

    prompt += `
**What you must do now:**

1. Review the issues above carefully
2. Complete any missing work
3. Fix any failing tests or builds
4. Only claim completion again when the work is genuinely done and verifiable

**Do NOT claim completion until you have addressed these issues.**

Continue working on the task now.`;

    return prompt;
  }

  /**
   * Run smoke tests based on goal type
   * Attempts to actually run/test the result
   */
  async runSmokeTests(goal, workingDirectory) {
    const result = {
      passed: false,
      tests: [],
      errors: [],
    };

    const goalLower = goal.toLowerCase();

    try {
      // Detect what type of project/goal this is and run appropriate tests

      // 1. If it's a Node.js project, try npm test or npm run build
      const packageJsonPath = join(workingDirectory, 'package.json');
      try {
        const content = await readFile(packageJsonPath, 'utf8');
        const pkg = JSON.parse(content);

        // Try npm test if available
        if (pkg.scripts?.test && pkg.scripts.test !== 'echo "Error: no test specified" && exit 1') {
          const testResult = await this.runCommand('npm test', workingDirectory, 60000);
          result.tests.push({
            name: 'npm test',
            passed: testResult.success,
            output: testResult.output?.substring(0, 500),
          });
        }

        // Try npm run build if goal mentions build
        if (pkg.scripts?.build && (goalLower.includes('build') || goalLower.includes('compile'))) {
          const buildResult = await this.runCommand('npm run build', workingDirectory, 60000);
          result.tests.push({
            name: 'npm run build',
            passed: buildResult.success,
            output: buildResult.output?.substring(0, 500),
          });
        }

        // Try npm start briefly if goal mentions server/API
        if (pkg.scripts?.start && (goalLower.includes('server') || goalLower.includes('api'))) {
          const startResult = await this.runCommand('timeout 5 npm start || true', workingDirectory, 10000);
          // Server starting without immediate crash is a pass
          const crashed = startResult.output?.toLowerCase().includes('error') &&
                         !startResult.output?.toLowerCase().includes('listening');
          result.tests.push({
            name: 'Server starts',
            passed: !crashed,
            output: startResult.output?.substring(0, 500),
          });
        }
      } catch (e) {
        // Not a Node.js project
      }

      // 2. Python projects
      try {
        const hasTestDir = await stat(join(workingDirectory, 'tests')).then(() => true).catch(() => false);
        const hasPytest = await stat(join(workingDirectory, 'pytest.ini')).then(() => true).catch(() => false);

        if (hasTestDir || hasPytest) {
          const testResult = await this.runCommand('python -m pytest -v --tb=short 2>&1 || pytest -v --tb=short 2>&1', workingDirectory, 60000);
          result.tests.push({
            name: 'pytest',
            passed: testResult.success || testResult.output?.includes('passed'),
            output: testResult.output?.substring(0, 500),
          });
        }
      } catch (e) {
        // Not a Python project
      }

      // 3. Go projects
      if (goalLower.includes('go') || goalLower.includes('golang')) {
        try {
          const hasGoMod = await stat(join(workingDirectory, 'go.mod')).then(() => true).catch(() => false);
          if (hasGoMod) {
            const testResult = await this.runCommand('go test ./...', workingDirectory, 60000);
            result.tests.push({
              name: 'go test',
              passed: testResult.success,
              output: testResult.output?.substring(0, 500),
            });

            const buildResult = await this.runCommand('go build ./...', workingDirectory, 60000);
            result.tests.push({
              name: 'go build',
              passed: buildResult.success,
              output: buildResult.output?.substring(0, 500),
            });
          }
        } catch (e) {
          // Not a Go project
        }
      }

      // 4. Makefile-based projects
      try {
        const makefilePath = join(workingDirectory, 'Makefile');
        const content = await readFile(makefilePath, 'utf8');

        if (content.includes('test:')) {
          const testResult = await this.runCommand('make test', workingDirectory, 60000);
          result.tests.push({
            name: 'make test',
            passed: testResult.success,
            output: testResult.output?.substring(0, 500),
          });
        }

        if (content.includes('build:') && (goalLower.includes('build') || goalLower.includes('compile'))) {
          const buildResult = await this.runCommand('make build', workingDirectory, 60000);
          result.tests.push({
            name: 'make build',
            passed: buildResult.success,
            output: buildResult.output?.substring(0, 500),
          });
        }
      } catch (e) {
        // No Makefile
      }

      // Determine overall pass/fail
      if (result.tests.length > 0) {
        const passedTests = result.tests.filter(t => t.passed).length;
        result.passed = passedTests === result.tests.length;
        result.summary = `${passedTests}/${result.tests.length} smoke tests passed`;
      } else {
        // No tests to run - consider it a pass (no way to verify)
        result.passed = true;
        result.summary = 'No smoke tests applicable';
      }

    } catch (error) {
      result.errors.push(error.message);
      result.summary = `Smoke test error: ${error.message}`;
    }

    return result;
  }

  /**
   * Get verification statistics
   */
  getStats() {
    const total = this.verificationHistory.length;
    const passed = this.verificationHistory.filter(v => v.passed).length;
    const failed = total - passed;

    return {
      totalVerifications: total,
      passed,
      failed,
      passRate: total > 0 ? Math.round((passed / total) * 100) : null,
      recentResults: this.verificationHistory.slice(-5).map(v => ({
        passed: v.passed,
        failures: v.failures,
        timestamp: v.timestamp,
      })),
    };
  }
}

export default CompletionVerifier;
