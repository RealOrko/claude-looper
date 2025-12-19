/**
 * Execution Cache - Caches execution results to avoid redundant work
 *
 * Handles:
 * - In-memory caching with size limits
 * - Disk-based cache persistence
 * - Cache key generation
 * - TTL-based expiration
 */

import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';

export class ExecutionCache {
  constructor(options = {}) {
    this.persistencePath = options.persistencePath;
    this.maxSize = options.maxSize || 100;
    this.ttl = options.ttl || 3600000; // 1 hour default
    this.cache = new Map();
  }

  /**
   * Generate cache key for a prompt/step
   */
  generateCacheKey(prompt, context = {}) {
    const keyData = {
      prompt: prompt.substring(0, 500),
      step: context.stepNumber,
      goal: context.goal?.substring(0, 200),
    };
    return createHash('sha256').update(JSON.stringify(keyData)).digest('hex').substring(0, 16);
  }

  /**
   * Get cached result for a prompt
   */
  async getCachedResult(prompt, context = {}) {
    const cacheKey = this.generateCacheKey(prompt, context);

    // Check in-memory cache first
    if (this.cache.has(cacheKey)) {
      const cached = this.cache.get(cacheKey);
      if (Date.now() - cached.timestamp < this.ttl) {
        return { ...cached.result, fromCache: true };
      }
      this.cache.delete(cacheKey);
    }

    // Check disk cache
    try {
      const cachePath = path.join(this.persistencePath, 'cache', `${cacheKey}.json`);
      const data = await fs.readFile(cachePath, 'utf-8');
      const cached = JSON.parse(data);

      if (Date.now() - cached.timestamp < this.ttl) {
        // Restore to memory cache
        this.cache.set(cacheKey, cached);
        return { ...cached.result, fromCache: true };
      }

      // Expired - delete
      await fs.unlink(cachePath);
    } catch {
      // Not cached
    }

    return null;
  }

  /**
   * Summarize a result for storage
   */
  summarizeResult(result) {
    if (!result) return null;

    const summary = {
      hasResponse: !!result.response,
      responseLength: result.response?.length || 0,
    };

    if (result.response && result.response.length < 2000) {
      summary.response = result.response;
    } else if (result.response) {
      summary.responseSummary = result.response.substring(0, 500) + '...';
    }

    if (result.sessionId) summary.sessionId = result.sessionId;
    if (result.escalated) summary.escalated = result.escalated;
    if (result.error) summary.error = result.error;

    return summary;
  }

  /**
   * Cache a result
   */
  async cacheResult(prompt, result, context = {}) {
    const cacheKey = this.generateCacheKey(prompt, context);

    const cacheEntry = {
      key: cacheKey,
      timestamp: Date.now(),
      context: {
        stepNumber: context.stepNumber,
        goal: context.goal?.substring(0, 200),
      },
      result: this.summarizeResult(result),
    };

    // Store in memory
    this.cache.set(cacheKey, cacheEntry);

    // Prune memory cache if too large
    if (this.cache.size > this.maxSize) {
      const oldestKey = this.cache.keys().next().value;
      this.cache.delete(oldestKey);
    }

    // Store on disk (async, don't block)
    const cachePath = path.join(this.persistencePath, 'cache', `${cacheKey}.json`);
    fs.writeFile(cachePath, JSON.stringify(cacheEntry, null, 2)).catch(() => {});

    return cacheKey;
  }

  /**
   * Clear all cache entries
   */
  async clear() {
    this.cache.clear();

    try {
      const cacheDir = path.join(this.persistencePath, 'cache');
      const files = await fs.readdir(cacheDir);
      for (const file of files) {
        if (file.endsWith('.json')) {
          await fs.unlink(path.join(cacheDir, file)).catch(() => {});
        }
      }
    } catch {
      // Ignore errors
    }
  }

  /**
   * Get cache size
   */
  size() {
    return this.cache.size;
  }

  /**
   * Check if cache has entry
   */
  has(prompt, context = {}) {
    const cacheKey = this.generateCacheKey(prompt, context);
    return this.cache.has(cacheKey);
  }
}

export default ExecutionCache;
