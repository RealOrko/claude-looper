/**
 * Tests for error-utils.js
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  AutonomousRunnerError,
  FileOperationError,
  APIError,
  ParseError,
  VerificationError,
  TimeoutError,
  withDefault,
  withResult,
  withRetry,
  withVerificationFallback,
  existsCheck,
  safeCall,
  logError,
  logWarning,
  categorizeError,
  createErrorResponse,
} from '../error-utils.js';

describe('Error Classes', () => {
  describe('AutonomousRunnerError', () => {
    it('should create error with default properties', () => {
      const error = new AutonomousRunnerError('Test error');
      expect(error.message).toBe('Test error');
      expect(error.name).toBe('AutonomousRunnerError');
      expect(error.code).toBe('UNKNOWN_ERROR');
      expect(error.recoverable).toBe(true);
      expect(error.context).toEqual({});
      expect(error.timestamp).toBeDefined();
    });

    it('should accept custom options', () => {
      const error = new AutonomousRunnerError('Test', {
        code: 'CUSTOM_CODE',
        recoverable: false,
        context: { foo: 'bar' },
      });
      expect(error.code).toBe('CUSTOM_CODE');
      expect(error.recoverable).toBe(false);
      expect(error.context).toEqual({ foo: 'bar' });
    });

    it('should serialize to JSON', () => {
      const error = new AutonomousRunnerError('Test', { code: 'TEST' });
      const json = error.toJSON();
      expect(json.name).toBe('AutonomousRunnerError');
      expect(json.message).toBe('Test');
      expect(json.code).toBe('TEST');
      expect(json.timestamp).toBeDefined();
    });
  });

  describe('FileOperationError', () => {
    it('should include file-specific properties', () => {
      const error = new FileOperationError('File not found', {
        path: '/test/file.txt',
        operation: 'read',
      });
      expect(error.name).toBe('FileOperationError');
      expect(error.code).toBe('FILE_ERROR');
      expect(error.path).toBe('/test/file.txt');
      expect(error.operation).toBe('read');
    });

    it('should accept custom code', () => {
      const error = new FileOperationError('Permission denied', {
        code: 'EACCES',
      });
      expect(error.code).toBe('EACCES');
    });
  });

  describe('APIError', () => {
    it('should include API-specific properties', () => {
      const error = new APIError('Request failed', {
        statusCode: 500,
        endpoint: '/api/test',
        retryable: false,
      });
      expect(error.name).toBe('APIError');
      expect(error.code).toBe('API_ERROR');
      expect(error.statusCode).toBe(500);
      expect(error.endpoint).toBe('/api/test');
      expect(error.retryable).toBe(false);
    });

    it('should default retryable to true', () => {
      const error = new APIError('Request failed');
      expect(error.retryable).toBe(true);
    });
  });

  describe('ParseError', () => {
    it('should include truncated input', () => {
      const longInput = 'x'.repeat(300);
      const error = new ParseError('Invalid JSON', { input: longInput });
      expect(error.name).toBe('ParseError');
      expect(error.code).toBe('PARSE_ERROR');
      expect(error.input).toHaveLength(200);
    });

    it('should handle missing input', () => {
      const error = new ParseError('Invalid JSON');
      expect(error.input).toBeUndefined();
    });
  });

  describe('VerificationError', () => {
    it('should include verification properties', () => {
      const error = new VerificationError('Verification failed', {
        verificationType: 'step',
        evidence: { found: false },
      });
      expect(error.name).toBe('VerificationError');
      expect(error.verificationType).toBe('step');
      expect(error.evidence).toEqual({ found: false });
    });
  });

  describe('TimeoutError', () => {
    it('should include timeout properties', () => {
      const error = new TimeoutError('Operation timed out', {
        timeoutMs: 5000,
        operation: 'LLM call',
      });
      expect(error.name).toBe('TimeoutError');
      expect(error.code).toBe('TIMEOUT_ERROR');
      expect(error.timeoutMs).toBe(5000);
      expect(error.operation).toBe('LLM call');
      expect(error.recoverable).toBe(true);
    });
  });
});

describe('Wrapper Functions', () => {
  describe('withDefault', () => {
    it('should return function result on success', async () => {
      const result = await withDefault(async () => 'success', 'default');
      expect(result).toBe('success');
    });

    it('should return default on error', async () => {
      const result = await withDefault(
        async () => { throw new Error('fail'); },
        'default',
        { silent: true }
      );
      expect(result).toBe('default');
    });

    it('should log error by default', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      await withDefault(
        async () => { throw new Error('test error'); },
        null,
        { logPrefix: '[Test]' }
      );
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('should call onError callback', async () => {
      const onError = vi.fn();
      await withDefault(
        async () => { throw new Error('fail'); },
        null,
        { silent: true, onError }
      );
      expect(onError).toHaveBeenCalled();
    });
  });

  describe('withResult', () => {
    it('should return success result', async () => {
      const result = await withResult(async () => 'data');
      expect(result).toEqual({ success: true, data: 'data' });
    });

    it('should return error result', async () => {
      const error = new Error('fail');
      const result = await withResult(async () => { throw error; });
      expect(result.success).toBe(false);
      expect(result.error).toBe(error);
    });
  });

  describe('existsCheck', () => {
    it('should return true on success', () => {
      expect(existsCheck(() => true)).toBe(true);
    });

    it('should return false on error', () => {
      expect(existsCheck(() => { throw new Error(); })).toBe(false);
    });
  });

  describe('withVerificationFallback', () => {
    beforeEach(() => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should return function result on success', async () => {
      const result = await withVerificationFallback(
        async () => ({ verified: true }),
        { verified: false }
      );
      expect(result).toEqual({ verified: true });
    });

    it('should return fallback with error on failure', async () => {
      const result = await withVerificationFallback(
        async () => { throw new Error('fail'); },
        { verified: false, confidence: 50 }
      );
      expect(result.verified).toBe(false);
      expect(result.confidence).toBe(50);
      expect(result.error).toBe('fail');
      expect(result.fallbackUsed).toBe(true);
    });

    it('should call onError callback', async () => {
      const onError = vi.fn();
      await withVerificationFallback(
        async () => { throw new Error('fail'); },
        {},
        { onError }
      );
      expect(onError).toHaveBeenCalled();
    });
  });

  describe('withRetry', () => {
    beforeEach(() => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should return on first success', async () => {
      const fn = vi.fn().mockResolvedValue('success');
      const result = await withRetry(fn, { maxAttempts: 3 });
      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should retry on failure', async () => {
      const fn = vi.fn()
        .mockRejectedValueOnce(new Error('fail 1'))
        .mockResolvedValueOnce('success');
      const result = await withRetry(fn, { maxAttempts: 3, delayMs: 10, silent: true });
      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('should throw after max attempts', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('always fails'));
      await expect(
        withRetry(fn, { maxAttempts: 2, delayMs: 10, silent: true })
      ).rejects.toThrow('always fails');
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('should respect shouldRetry predicate', async () => {
      let callCount = 0;
      const fn = vi.fn().mockImplementation(() => {
        callCount++;
        throw new Error('fatal');
      });
      await expect(
        withRetry(fn, {
          maxAttempts: 3,
          delayMs: 10,
          shouldRetry: () => false,
          silent: true,
        })
      ).rejects.toThrow('fatal');
      // Should only call once because shouldRetry returns false after first failure
      expect(callCount).toBe(1);
    });

    it('should call onRetry callback', async () => {
      const onRetry = vi.fn();
      const fn = vi.fn()
        .mockRejectedValueOnce(new Error('fail'))
        .mockResolvedValueOnce('ok');
      await withRetry(fn, { maxAttempts: 2, delayMs: 10, onRetry, silent: true });
      expect(onRetry).toHaveBeenCalledWith(expect.any(Error), 1);
    });

    it('should apply exponential backoff', async () => {
      const fn = vi.fn()
        .mockRejectedValueOnce(new Error('1'))
        .mockRejectedValueOnce(new Error('2'))
        .mockResolvedValueOnce('ok');
      const start = Date.now();
      await withRetry(fn, { maxAttempts: 3, delayMs: 20, backoff: 2, silent: true });
      const elapsed = Date.now() - start;
      // First retry: 20ms, second retry: 40ms = 60ms minimum
      expect(elapsed).toBeGreaterThanOrEqual(50);
    });
  });

  describe('safeCall', () => {
    it('should return result on sync success', () => {
      expect(safeCall(() => 'value')).toBe('value');
    });

    it('should return default on sync error', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      expect(safeCall(() => { throw new Error(); })).toBe(null);
      consoleSpy.mockRestore();
    });

    it('should return custom default on error', () => {
      expect(safeCall(() => { throw new Error(); }, { defaultValue: 'custom' })).toBe('custom');
    });

    it('should handle async functions', async () => {
      const result = await safeCall(async () => 'async value');
      expect(result).toBe('async value');
    });

    it('should handle async errors', async () => {
      const result = await safeCall(async () => { throw new Error(); });
      expect(result).toBe(null);
    });
  });
});

describe('Logging Helpers', () => {
  let consoleSpy;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  describe('logError', () => {
    it('should log with prefix', () => {
      logError('[Test]', new Error('test message'));
      expect(consoleSpy).toHaveBeenCalledWith('[Test] test message');
    });

    it('should include context', () => {
      logError('[Test]', new Error('msg'), { attempt: 1 });
      expect(consoleSpy).toHaveBeenCalledWith('[Test] msg {"attempt":1}');
    });

    it('should handle string errors', () => {
      logError('[Test]', 'string error');
      expect(consoleSpy).toHaveBeenCalledWith('[Test] string error');
    });
  });

  describe('logWarning', () => {
    let warnSpy;

    beforeEach(() => {
      warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
      warnSpy.mockRestore();
    });

    it('should log warning with prefix', () => {
      logWarning('[Test]', 'warning message');
      expect(warnSpy).toHaveBeenCalledWith('[Test] warning message');
    });

    it('should include context', () => {
      logWarning('[Test]', 'msg', { count: 5 });
      expect(warnSpy).toHaveBeenCalledWith('[Test] msg {"count":5}');
    });
  });
});

describe('categorizeError', () => {
  it('should categorize network errors', () => {
    const result = categorizeError(new Error('ECONNREFUSED'));
    expect(result.category).toBe('network');
    expect(result.retryable).toBe(true);
    expect(result.severity).toBe('warning');
  });

  it('should categorize rate limit errors', () => {
    const result = categorizeError(new Error('429 Too Many Requests'));
    expect(result.category).toBe('rate_limit');
    expect(result.retryable).toBe(true);
  });

  it('should categorize auth errors', () => {
    const result = categorizeError(new Error('401 Unauthorized'));
    expect(result.category).toBe('auth');
    expect(result.retryable).toBe(false);
    expect(result.severity).toBe('critical');
  });

  it('should categorize timeout errors', () => {
    const result = categorizeError(new Error('Request timed out'));
    expect(result.category).toBe('timeout');
    expect(result.retryable).toBe(true);
  });

  it('should categorize parse errors', () => {
    const result = categorizeError(new Error('Unexpected token in JSON'));
    expect(result.category).toBe('parse');
    expect(result.retryable).toBe(false);
  });

  it('should categorize file errors', () => {
    const result = categorizeError(new Error('ENOENT: no such file'));
    expect(result.category).toBe('file');
    expect(result.retryable).toBe(false);
  });

  it('should return unknown for unrecognized errors', () => {
    const result = categorizeError(new Error('Something weird happened'));
    expect(result.category).toBe('unknown');
  });

  it('should handle errors without message', () => {
    const result = categorizeError({});
    expect(result.category).toBe('unknown');
  });
});

describe('createErrorResponse', () => {
  it('should create standard error response', () => {
    const error = new Error('Test error');
    const response = createErrorResponse(error);
    expect(response.success).toBe(false);
    expect(response.error.message).toBe('Test error');
    expect(response.error.category).toBeDefined();
    expect(response.error.retryable).toBeDefined();
  });

  it('should include code from error', () => {
    const error = new APIError('API failed', { code: 'API_500' });
    const response = createErrorResponse(error);
    expect(response.error.code).toBe('API_500');
  });

  it('should include stack when requested', () => {
    const error = new Error('Test');
    const response = createErrorResponse(error, { includeStack: true });
    expect(response.error.stack).toBeDefined();
  });

  it('should not include stack by default', () => {
    const error = new Error('Test');
    const response = createErrorResponse(error);
    expect(response.error.stack).toBeUndefined();
  });
});
