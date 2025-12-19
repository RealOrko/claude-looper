/**
 * Verification Strategies - Verification layer implementations
 *
 * Handles:
 * - Artifact verification (file existence)
 * - Test/build validation
 * - Command detection and execution
 * - Rejection prompt generation
 */

import { spawn } from 'child_process';
import { stat, readFile } from 'fs/promises';
import { join, isAbsolute } from 'path';

/**
 * Default verification configuration
 */
export function getDefaultVerificationConfig(config = null) {
  const verifyConfig = config?.get?.('verification') || {};
  return {
    enabled: verifyConfig.enabled ?? true,
    maxAttempts: verifyConfig.maxAttempts ?? 3,
    challengeTimeout: verifyConfig.challengeTimeout ?? 5 * 60 * 1000,
    testTimeout: verifyConfig.testTimeout ?? 5 * 60 * 1000,
    requireArtifacts: verifyConfig.requireArtifacts ?? true,
    runTests: verifyConfig.runTests ?? true,
    testCommands: verifyConfig.testCommands || ['npm test', 'pytest', 'go test ./...'],
    buildCommands: verifyConfig.buildCommands || ['npm run build', 'make'],
    minPlanProgress: verifyConfig.minPlanProgress ?? 70,
  };
}

/**
 * Verify that claimed artifacts exist on disk
 */
export async function verifyArtifacts(files, workingDirectory) {
  const result = {
    passed: true,
    verified: [],
    missing: [],
    empty: [],
  };

  for (const file of files) {
    const fullPath = isAbsolute(file) ? file : join(workingDirectory, file);

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
  const totalClaimed = files.length;
  const totalVerified = result.verified.length;
  const missingRatio = result.missing.length / totalClaimed;

  if (totalVerified === 0 && totalClaimed > 0) {
    result.passed = false;
  } else if (missingRatio > 0.5) {
    result.passed = false;
  } else if (result.empty.length > result.verified.length) {
    result.passed = false;
  }

  return result;
}

/**
 * Detect available test/build commands in the working directory
 */
export async function detectAvailableCommands(workingDirectory, config) {
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

  return commands.slice(0, 2);
}

/**
 * Execute a shell command
 */
export function execCommand(cmd, cwd, timeout = 5 * 60 * 1000) {
  return new Promise((resolve, reject) => {
    const [command, ...args] = cmd.split(/\s+/);

    const proc = spawn(command, args, {
      cwd,
      shell: true,
      timeout,
      stdio: ['ignore', 'pipe', 'pipe'],
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

    setTimeout(() => {
      proc.kill('SIGTERM');
      reject(new Error(`Command timed out after ${timeout}ms`));
    }, timeout);
  });
}

/**
 * Run validation tests/builds
 */
export async function runValidation(evidence, workingDirectory, config) {
  const result = {
    passed: true,
    testsRun: [],
    testsFailed: [],
    error: null,
  };

  const verifyConfig = getDefaultVerificationConfig(config);

  // Determine which commands to run
  let commandsToRun = [];

  if (evidence.testCommands.length > 0) {
    commandsToRun = evidence.testCommands.slice(0, 2);
  } else {
    commandsToRun = await detectAvailableCommands(workingDirectory, verifyConfig);
  }

  if (commandsToRun.length === 0) {
    result.skipped = true;
    return result;
  }

  for (const cmd of commandsToRun) {
    try {
      const execResult = await execCommand(cmd, workingDirectory, verifyConfig.testTimeout);
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
        break;
      }
    } catch (e) {
      if (evidence.testCommands.includes(cmd)) {
        result.passed = false;
        result.error = `Claimed command failed to execute: ${cmd}`;
        break;
      }
    }
  }

  return result;
}

/**
 * Generate rejection prompt when verification fails
 */
export function generateRejectionPrompt(verificationResult) {
  const failures = verificationResult.failures;

  let prompt = `## COMPLETION CLAIM REJECTED

Your completion claim could not be verified. The following issues were found:

${failures.map((f, i) => `${i + 1}. ${f}`).join('\n')}

`;

  if (verificationResult.layers.planProgress && !verificationResult.layers.planProgress.passed) {
    const progress = verificationResult.layers.planProgress;
    prompt += `
**Issue: Incomplete Plan**
You have only completed ${progress.completed} of ${progress.total} planned steps (${progress.percentComplete}%).
At least ${progress.minRequired}% of steps must be completed before claiming task completion.

**Remaining steps to complete:**
Continue working through the planned steps. Do not claim completion until you have addressed the remaining work.
`;
  }

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

export default {
  getDefaultVerificationConfig,
  verifyArtifacts,
  detectAvailableCommands,
  execCommand,
  runValidation,
  generateRejectionPrompt,
};
