/**
 * Test Command Executor
 * Detects and executes test commands for various project types
 */

import { spawn } from 'child_process';
import { TestExecutionResult } from './coverage-analysis.js';

/**
 * Test commands by project type
 */
export const TEST_COMMANDS = {
  node: ['npm test', 'npm run test', 'yarn test'],
  python: ['pytest', 'python -m pytest', 'python -m unittest'],
  go: ['go test ./...'],
  rust: ['cargo test'],
  make: ['make test'],
};

/**
 * Detect available test commands for the project
 */
export async function detectTestCommands(workingDirectory) {
  const commands = [];

  // Check for package.json (Node.js)
  try {
    const { readFile } = await import('fs/promises');
    const packageJson = JSON.parse(
      await readFile(`${workingDirectory}/package.json`, 'utf8'),
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
    await stat(`${workingDirectory}/pytest.ini`);
    commands.push('pytest');
  } catch (e) {
    try {
      const { stat } = await import('fs/promises');
      await stat(`${workingDirectory}/setup.py`);
      commands.push('pytest');
    } catch (e2) {
      // Not a Python project
    }
  }

  // Check for go.mod (Go)
  try {
    const { stat } = await import('fs/promises');
    await stat(`${workingDirectory}/go.mod`);
    commands.push('go test ./...');
  } catch (e) {
    // Not a Go project
  }

  // Check for Cargo.toml (Rust)
  try {
    const { stat } = await import('fs/promises');
    await stat(`${workingDirectory}/Cargo.toml`);
    commands.push('cargo test');
  } catch (e) {
    // Not a Rust project
  }

  // Check for Makefile with test target
  try {
    const { readFile } = await import('fs/promises');
    const makefile = await readFile(`${workingDirectory}/Makefile`, 'utf8');
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
export function executeCommand(command, workingDirectory, timeout = 5 * 60 * 1000) {
  const result = new TestExecutionResult(command);
  const startTime = Date.now();

  return new Promise((resolve) => {
    const [cmd, ...args] = command.split(/\s+/);

    const proc = spawn(cmd, args, {
      cwd: workingDirectory,
      shell: true,
      timeout: timeout,
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
    }, timeout);
  });
}

/**
 * Parse test failures from command output
 */
export function parseTestFailures(execResult) {
  const failures = [];
  const output = execResult.stdout + execResult.stderr;

  const patterns = [
    // Jest/Node
    /FAIL\s+(.+?)\n.*?●\s+(.+?)(?:\n|$)/g,
    /Error:\s+(.+?)(?:\n|$)/g,
    /AssertionError:\s+(.+?)(?:\n|$)/g,

    // Pytest
    /FAILED\s+(.+?)::\w+\s+-\s+(.+?)(?:\n|$)/g,

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

  return failures.slice(0, 10);
}
