/**
 * Tests for execution-cache.js
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ExecutionCache } from '../execution-cache.js';

// Mock fs
vi.mock('fs', () => ({
  promises: {
    readFile: vi.fn(),
    writeFile: vi.fn(),
    readdir: vi.fn(),
    unlink: vi.fn(),
  },
}));

import { promises as fs } from 'fs';

describe('ExecutionCache', () => {
  let cache;

  beforeEach(() => {
    vi.clearAllMocks();
    cache = new ExecutionCache({
      persistencePath: '/test/path',
      maxSize: 5,
      ttl: 60000, // 1 minute
    });
  });

  describe('constructor', () => {
    it('should initialize with options', () => {
      expect(cache.persistencePath).toBe('/test/path');
      expect(cache.maxSize).toBe(5);
      expect(cache.ttl).toBe(60000);
    });

    it('should use defaults', () => {
      const c = new ExecutionCache({ persistencePath: '/path' });
      expect(c.maxSize).toBe(100);
      expect(c.ttl).toBe(3600000);
    });
  });

  describe('generateCacheKey', () => {
    it('should generate consistent keys', () => {
      const key1 = cache.generateCacheKey('test prompt', { stepNumber: 1 });
      const key2 = cache.generateCacheKey('test prompt', { stepNumber: 1 });
      expect(key1).toBe(key2);
    });

    it('should generate different keys for different inputs', () => {
      const key1 = cache.generateCacheKey('prompt 1', { stepNumber: 1 });
      const key2 = cache.generateCacheKey('prompt 2', { stepNumber: 1 });
      expect(key1).not.toBe(key2);
    });

    it('should truncate long prompts', () => {
      const longPrompt = 'x'.repeat(1000);
      const key = cache.generateCacheKey(longPrompt);
      expect(key.length).toBe(16);
    });
  });

  describe('getCachedResult', () => {
    it('should return null for missing cache', async () => {
      fs.readFile.mockRejectedValue(new Error('Not found'));

      const result = await cache.getCachedResult('prompt', {});

      expect(result).toBeNull();
    });

    it('should return cached result from memory', async () => {
      // First cache a result
      fs.writeFile.mockResolvedValue();
      await cache.cacheResult('test prompt', { response: 'cached response' });

      const result = await cache.getCachedResult('test prompt');

      expect(result.response).toBe('cached response');
      expect(result.fromCache).toBe(true);
    });

    it('should return cached result from disk', async () => {
      const cacheEntry = {
        timestamp: Date.now(),
        result: { response: 'disk cached' },
      };
      fs.readFile.mockResolvedValue(JSON.stringify(cacheEntry));

      const result = await cache.getCachedResult('prompt');

      expect(result.response).toBe('disk cached');
      expect(result.fromCache).toBe(true);
    });

    it('should delete expired memory cache', async () => {
      // Manually add expired entry to memory cache
      const key = cache.generateCacheKey('prompt');
      cache.cache.set(key, {
        timestamp: Date.now() - 120000, // 2 minutes ago (past TTL)
        result: { response: 'expired' },
      });

      fs.readFile.mockRejectedValue(new Error('Not found'));

      const result = await cache.getCachedResult('prompt');

      expect(result).toBeNull();
      expect(cache.cache.has(key)).toBe(false);
    });

    it('should delete expired disk cache', async () => {
      fs.readFile.mockResolvedValue(JSON.stringify({
        timestamp: Date.now() - 120000,
        result: { response: 'expired' },
      }));
      fs.unlink.mockResolvedValue();

      const result = await cache.getCachedResult('prompt');

      expect(result).toBeNull();
      expect(fs.unlink).toHaveBeenCalled();
    });
  });

  describe('summarizeResult', () => {
    it('should return null for null input', () => {
      expect(cache.summarizeResult(null)).toBeNull();
    });

    it('should include short responses', () => {
      const result = cache.summarizeResult({ response: 'short response' });

      expect(result.response).toBe('short response');
      expect(result.hasResponse).toBe(true);
      expect(result.responseLength).toBe(14);
    });

    it('should truncate long responses', () => {
      const longResponse = 'x'.repeat(3000);
      const result = cache.summarizeResult({ response: longResponse });

      expect(result.responseSummary).toBeDefined();
      expect(result.response).toBeUndefined();
    });

    it('should preserve metadata', () => {
      const result = cache.summarizeResult({
        response: 'test',
        sessionId: 'sess123',
        escalated: true,
        error: 'some error',
      });

      expect(result.sessionId).toBe('sess123');
      expect(result.escalated).toBe(true);
      expect(result.error).toBe('some error');
    });
  });

  describe('cacheResult', () => {
    beforeEach(() => {
      fs.writeFile.mockResolvedValue();
    });

    it('should store in memory cache', async () => {
      await cache.cacheResult('test prompt', { response: 'test' });

      expect(cache.cache.size).toBe(1);
    });

    it('should return cache key', async () => {
      const key = await cache.cacheResult('test', { response: 'x' });

      expect(key).toBeDefined();
      expect(key.length).toBe(16);
    });

    it('should prune oldest when at capacity', async () => {
      // Fill cache to capacity
      for (let i = 0; i < 5; i++) {
        await cache.cacheResult(`prompt ${i}`, { response: `resp ${i}` });
      }
      expect(cache.cache.size).toBe(5);

      // Add one more
      await cache.cacheResult('prompt new', { response: 'new' });

      // Should still be at max size
      expect(cache.cache.size).toBe(5);
    });

    it('should write to disk asynchronously', async () => {
      await cache.cacheResult('test', { response: 'x' });

      // Give async write time to complete
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(fs.writeFile).toHaveBeenCalled();
    });
  });

  describe('clear', () => {
    it('should clear memory cache', async () => {
      fs.writeFile.mockResolvedValue();
      await cache.cacheResult('test', { response: 'x' });
      expect(cache.cache.size).toBe(1);

      fs.readdir.mockResolvedValue(['abc.json', 'def.json']);
      fs.unlink.mockResolvedValue();

      await cache.clear();

      expect(cache.cache.size).toBe(0);
    });

    it('should clear disk cache', async () => {
      fs.readdir.mockResolvedValue(['abc.json', 'def.json']);
      fs.unlink.mockResolvedValue();

      await cache.clear();

      expect(fs.unlink).toHaveBeenCalledTimes(2);
    });

    it('should handle readdir errors', async () => {
      fs.readdir.mockRejectedValue(new Error('Not found'));

      await cache.clear();

      // Should not throw
      expect(cache.cache.size).toBe(0);
    });
  });

  describe('size', () => {
    it('should return cache size', async () => {
      expect(cache.size()).toBe(0);

      fs.writeFile.mockResolvedValue();
      await cache.cacheResult('test1', { response: 'x' });
      await cache.cacheResult('test2', { response: 'y' });

      expect(cache.size()).toBe(2);
    });
  });

  describe('has', () => {
    it('should check if entry exists', async () => {
      expect(cache.has('missing')).toBe(false);

      fs.writeFile.mockResolvedValue();
      await cache.cacheResult('existing', { response: 'x' });

      expect(cache.has('existing')).toBe(true);
    });
  });
});
