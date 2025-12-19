/**
 * Tests for verification-strategies.js
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getDefaultVerificationConfig,
  verifyArtifacts,
  detectAvailableCommands,
  execCommand,
  runValidation,
  generateRejectionPrompt,
} from '../verification-strategies.js';

// Mock fs
vi.mock('fs/promises', () => ({
  stat: vi.fn(),
  readFile: vi.fn(),
}));

// Mock child_process
vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));

import { stat, readFile } from 'fs/promises';
import { spawn } from 'child_process';

describe('getDefaultVerificationConfig', () => {
  it('should return defaults without config', () => {
    const config = getDefaultVerificationConfig();

    expect(config.enabled).toBe(true);
    expect(config.maxAttempts).toBe(3);
    expect(config.minPlanProgress).toBe(70);
    expect(config.requireArtifacts).toBe(true);
    expect(config.runTests).toBe(true);
  });

  it('should merge config values', () => {
    const mockConfig = {
      get: vi.fn().mockReturnValue({
        enabled: false,
        maxAttempts: 5,
        minPlanProgress: 50,
      }),
    };

    const config = getDefaultVerificationConfig(mockConfig);

    expect(config.enabled).toBe(false);
    expect(config.maxAttempts).toBe(5);
    expect(config.minPlanProgress).toBe(50);
  });
});

describe('verifyArtifacts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should verify existing files', async () => {
    stat.mockResolvedValue({ size: 100 });

    const result = await verifyArtifacts(['file1.js', 'file2.js'], '/work');

    expect(result.passed).toBe(true);
    expect(result.verified).toHaveLength(2);
    expect(result.missing).toHaveLength(0);
  });

  it('should detect missing files', async () => {
    stat.mockRejectedValue(new Error('ENOENT'));

    const result = await verifyArtifacts(['missing.js'], '/work');

    expect(result.passed).toBe(false);
    expect(result.missing).toContain('missing.js');
  });

  it('should detect empty files', async () => {
    stat.mockResolvedValue({ size: 0 });

    const result = await verifyArtifacts(['empty.js'], '/work');

    expect(result.empty).toContain('empty.js');
  });

  it('should fail when all files missing', async () => {
    stat.mockRejectedValue(new Error('ENOENT'));

    const result = await verifyArtifacts(['a.js', 'b.js'], '/work');

    expect(result.passed).toBe(false);
  });

  it('should fail when more than half missing', async () => {
    stat.mockImplementation((path) => {
      if (path.includes('exists')) {
        return Promise.resolve({ size: 100 });
      }
      return Promise.reject(new Error('ENOENT'));
    });

    const result = await verifyArtifacts(
      ['missing1.js', 'missing2.js', 'missing3.js', 'exists.js'],
      '/work'
    );

    expect(result.passed).toBe(false);
  });

  it('should fail when more empty than verified', async () => {
    stat.mockImplementation((path) => {
      if (path.includes('valid')) {
        return Promise.resolve({ size: 100 });
      }
      return Promise.resolve({ size: 0 });
    });

    const result = await verifyArtifacts(
      ['empty1.js', 'empty2.js', 'valid.js'],
      '/work'
    );

    expect(result.passed).toBe(false);
  });

  it('should handle absolute paths', async () => {
    stat.mockResolvedValue({ size: 100 });

    await verifyArtifacts(['/absolute/path/file.js'], '/work');

    expect(stat).toHaveBeenCalledWith('/absolute/path/file.js');
  });
});

describe('detectAvailableCommands', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should detect npm test from package.json', async () => {
    readFile.mockImplementation((path) => {
      if (path.includes('package.json')) {
        return Promise.resolve(JSON.stringify({
          scripts: { test: 'vitest run' },
        }));
      }
      return Promise.reject(new Error('Not found'));
    });
    stat.mockRejectedValue(new Error('Not found'));

    const commands = await detectAvailableCommands('/work', {});

    expect(commands).toContain('npm test');
  });

  it('should skip placeholder test script', async () => {
    readFile.mockResolvedValue(JSON.stringify({
      scripts: { test: 'echo "Error: no test specified" && exit 1' },
    }));
    stat.mockRejectedValue(new Error('Not found'));

    const commands = await detectAvailableCommands('/work', {});

    expect(commands).not.toContain('npm test');
  });

  it('should detect pytest from indicators', async () => {
    readFile.mockRejectedValue(new Error('Not found'));
    stat.mockImplementation((path) => {
      if (path.includes('pytest.ini')) {
        return Promise.resolve({});
      }
      return Promise.reject(new Error('Not found'));
    });

    const commands = await detectAvailableCommands('/work', {});

    expect(commands).toContain('pytest');
  });

  it('should detect make test from Makefile', async () => {
    readFile.mockImplementation((path) => {
      if (path.includes('Makefile')) {
        return Promise.resolve('test:\n\tgo test ./...');
      }
      return Promise.reject(new Error('Not found'));
    });
    stat.mockRejectedValue(new Error('Not found'));

    const commands = await detectAvailableCommands('/work', {});

    expect(commands).toContain('make test');
  });

  it('should limit to 2 commands', async () => {
    readFile.mockImplementation((path) => {
      if (path.includes('package.json')) {
        return Promise.resolve(JSON.stringify({ scripts: { test: 'jest' } }));
      }
      if (path.includes('Makefile')) {
        return Promise.resolve('test:\n\ttest');
      }
      return Promise.reject(new Error('Not found'));
    });
    stat.mockResolvedValue({});

    const commands = await detectAvailableCommands('/work', {});

    expect(commands.length).toBeLessThanOrEqual(2);
  });
});

describe('execCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should execute command and return output', async () => {
    const mockProc = {
      stdout: {
        on: vi.fn((event, cb) => {
          if (event === 'data') cb(Buffer.from('output'));
        }),
      },
      stderr: {
        on: vi.fn((event, cb) => {
          if (event === 'data') cb(Buffer.from(''));
        }),
      },
      on: vi.fn((event, cb) => {
        if (event === 'close') {
          setTimeout(() => cb(0), 10);
        }
      }),
      kill: vi.fn(),
    };
    spawn.mockReturnValue(mockProc);

    const result = await execCommand('npm test', '/work', 5000);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('output');
  });
});

describe('runValidation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should skip when no commands available', async () => {
    readFile.mockRejectedValue(new Error('Not found'));
    stat.mockRejectedValue(new Error('Not found'));

    const result = await runValidation(
      { testCommands: [], buildCommands: [] },
      '/work',
      null
    );

    expect(result.passed).toBe(true);
    expect(result.skipped).toBe(true);
  });

  it('should use evidence commands first', async () => {
    const mockProc = {
      stdout: { on: vi.fn((e, cb) => e === 'data' && cb(Buffer.from('pass'))) },
      stderr: { on: vi.fn() },
      on: vi.fn((e, cb) => e === 'close' && setTimeout(() => cb(0), 10)),
      kill: vi.fn(),
    };
    spawn.mockReturnValue(mockProc);

    const result = await runValidation(
      { testCommands: ['npm test'], buildCommands: [] },
      '/work',
      null
    );

    expect(result.testsRun[0].cmd).toBe('npm test');
  });
});

describe('generateRejectionPrompt', () => {
  it('should include failure reasons', () => {
    const result = {
      failures: ['Missing files', 'Tests failed'],
      layers: {},
    };

    const prompt = generateRejectionPrompt(result);

    expect(prompt).toContain('Missing files');
    expect(prompt).toContain('Tests failed');
    expect(prompt).toContain('COMPLETION CLAIM REJECTED');
  });

  it('should include plan progress guidance', () => {
    const result = {
      failures: ['Plan incomplete'],
      layers: {
        planProgress: {
          passed: false,
          completed: 3,
          total: 10,
          percentComplete: 30,
          minRequired: 70,
        },
      },
    };

    const prompt = generateRejectionPrompt(result);

    expect(prompt).toContain('Incomplete Plan');
    expect(prompt).toContain('3 of 10');
  });

  it('should include challenge guidance', () => {
    const result = {
      failures: ['Challenge failed'],
      layers: {
        challenge: { passed: false },
      },
    };

    const prompt = generateRejectionPrompt(result);

    expect(prompt).toContain('Insufficient Evidence');
  });

  it('should include artifacts guidance', () => {
    const result = {
      failures: ['Missing artifacts'],
      layers: {
        artifacts: {
          passed: false,
          missing: ['file1.js', 'file2.js'],
        },
      },
    };

    const prompt = generateRejectionPrompt(result);

    expect(prompt).toContain('Missing Files');
    expect(prompt).toContain('file1.js');
  });

  it('should include validation guidance', () => {
    const result = {
      failures: ['Tests failed'],
      layers: {
        validation: {
          passed: false,
          error: 'npm test exited with code 1',
        },
      },
    };

    const prompt = generateRejectionPrompt(result);

    expect(prompt).toContain('Tests/Validation Failed');
    expect(prompt).toContain('npm test exited with code 1');
  });

  it('should include action steps', () => {
    const result = {
      failures: ['Something failed'],
      layers: {},
    };

    const prompt = generateRejectionPrompt(result);

    expect(prompt).toContain('What you must do now');
    expect(prompt).toContain('Do NOT claim completion');
  });
});
