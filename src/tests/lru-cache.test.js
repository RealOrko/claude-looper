/**
 * Tests for lru-cache.js
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { LRUCache } from '../lru-cache.js';

describe('LRUCache', () => {
  let cache;

  beforeEach(() => {
    vi.useFakeTimers();
    cache = new LRUCache(3);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('constructor', () => {
    it('should initialize with maxSize', () => {
      expect(cache.maxSize).toBe(3);
      expect(cache.cache.size).toBe(0);
    });

    it('should use default maxSize', () => {
      const c = new LRUCache();
      expect(c.maxSize).toBe(100);
    });
  });

  describe('set and get', () => {
    it('should store and retrieve values', () => {
      cache.set('key1', 'value1');
      expect(cache.get('key1')).toBe('value1');
    });

    it('should return undefined for missing keys', () => {
      expect(cache.get('missing')).toBeUndefined();
    });

    it('should update existing keys', () => {
      cache.set('key1', 'first');
      cache.set('key1', 'second');
      expect(cache.get('key1')).toBe('second');
    });

    it('should evict oldest when at capacity', () => {
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);
      cache.set('d', 4); // Should evict 'a'

      expect(cache.get('a')).toBeUndefined();
      expect(cache.get('b')).toBe(2);
      expect(cache.get('d')).toBe(4);
    });

    it('should move accessed items to end', () => {
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);

      // Access 'a' to make it recent
      cache.get('a');

      // Add new item, should evict 'b' not 'a'
      cache.set('d', 4);

      expect(cache.get('a')).toBe(1);
      expect(cache.get('b')).toBeUndefined();
    });
  });

  describe('TTL support', () => {
    it('should expire entries after TTL', () => {
      cache.set('key', 'value', 1000); // 1 second TTL

      expect(cache.get('key')).toBe('value');

      vi.advanceTimersByTime(1500);

      expect(cache.get('key')).toBeUndefined();
    });

    it('should not expire entries without TTL', () => {
      cache.set('key', 'value', 0); // No TTL

      vi.advanceTimersByTime(100000);

      expect(cache.get('key')).toBe('value');
    });
  });

  describe('has', () => {
    it('should return true for existing keys', () => {
      cache.set('key', 'value');
      expect(cache.has('key')).toBe(true);
    });

    it('should return false for missing keys', () => {
      expect(cache.has('missing')).toBe(false);
    });

    it('should return false for expired keys', () => {
      cache.set('key', 'value', 1000);

      vi.advanceTimersByTime(1500);

      expect(cache.has('key')).toBe(false);
    });

    it('should delete expired keys when checking', () => {
      cache.set('key', 'value', 1000);

      vi.advanceTimersByTime(1500);
      cache.has('key');

      expect(cache.cache.has('key')).toBe(false);
    });
  });

  describe('delete', () => {
    it('should remove key', () => {
      cache.set('key', 'value');
      expect(cache.delete('key')).toBe(true);
      expect(cache.get('key')).toBeUndefined();
    });

    it('should return false for missing key', () => {
      expect(cache.delete('missing')).toBe(false);
    });
  });

  describe('clear', () => {
    it('should remove all entries', () => {
      cache.set('a', 1);
      cache.set('b', 2);
      cache.clear();

      expect(cache.size()).toBe(0);
      expect(cache.get('a')).toBeUndefined();
    });
  });

  describe('size', () => {
    it('should return current size', () => {
      expect(cache.size()).toBe(0);

      cache.set('a', 1);
      expect(cache.size()).toBe(1);

      cache.set('b', 2);
      expect(cache.size()).toBe(2);
    });
  });

  describe('keys', () => {
    it('should return iterator of keys', () => {
      cache.set('a', 1);
      cache.set('b', 2);

      const keys = [...cache.keys()];

      expect(keys).toContain('a');
      expect(keys).toContain('b');
    });
  });

  describe('entries', () => {
    it('should return iterator of entries', () => {
      cache.set('a', 1);
      cache.set('b', 2);

      const entries = [...cache.entries()];

      expect(entries).toHaveLength(2);
    });
  });

  describe('pruneExpired', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should remove expired entries', () => {
      cache.set('expired1', 'a', 1000);
      cache.set('expired2', 'b', 2000);
      cache.set('valid', 'c', 10000);

      vi.advanceTimersByTime(3000);

      const pruned = cache.pruneExpired();

      expect(pruned).toBe(2);
      expect(cache.size()).toBe(1);
      expect(cache.get('valid')).toBe('c');
    });

    it('should return 0 when nothing expired', () => {
      cache.set('a', 1, 10000);
      cache.set('b', 2, 0); // No expiration

      const pruned = cache.pruneExpired();

      expect(pruned).toBe(0);
    });
  });

  describe('getStats', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should return cache statistics', () => {
      cache.set('a', 1);
      cache.set('b', 2);

      const stats = cache.getStats();

      expect(stats.total).toBe(2);
      expect(stats.active).toBe(2);
      expect(stats.expired).toBe(0);
      expect(stats.maxSize).toBe(3);
      expect(stats.utilization).toBe(67); // 2/3 * 100
    });

    it('should count expired entries', () => {
      cache.set('expired', 'a', 1000);
      cache.set('valid', 'b', 10000);

      vi.advanceTimersByTime(2000);

      const stats = cache.getStats();

      expect(stats.total).toBe(2);
      expect(stats.active).toBe(1);
      expect(stats.expired).toBe(1);
    });
  });
});
