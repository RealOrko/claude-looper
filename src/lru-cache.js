/**
 * LRU Cache - Least Recently Used cache implementation
 *
 * Features:
 * - Size-limited cache with automatic eviction
 * - TTL-based expiration support
 * - Access order tracking (most recently used)
 */

export class LRUCache {
  constructor(maxSize = 100) {
    this.maxSize = maxSize;
    this.cache = new Map();
  }

  /**
   * Get a value from the cache
   * Moves the entry to the end (most recently used)
   */
  get(key) {
    if (!this.cache.has(key)) return undefined;

    // Move to end (most recently used)
    const entry = this.cache.get(key);
    this.cache.delete(key);
    this.cache.set(key, entry);

    // Check expiration
    if (entry.expires > 0 && Date.now() > entry.expires) {
      this.cache.delete(key);
      return undefined;
    }

    return entry.value;
  }

  /**
   * Set a value in the cache
   * @param {string} key - Cache key
   * @param {*} value - Value to cache
   * @param {number} ttlMs - Time-to-live in milliseconds (0 = no expiration)
   */
  set(key, value, ttlMs = 0) {
    // Remove oldest if at capacity
    if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }

    const entry = {
      value,
      expires: ttlMs > 0 ? Date.now() + ttlMs : 0,
      createdAt: Date.now(),
    };
    this.cache.set(key, entry);
  }

  /**
   * Check if key exists and is not expired
   */
  has(key) {
    if (!this.cache.has(key)) return false;

    const entry = this.cache.get(key);
    if (entry.expires > 0 && Date.now() > entry.expires) {
      this.cache.delete(key);
      return false;
    }
    return true;
  }

  /**
   * Delete a key from the cache
   */
  delete(key) {
    return this.cache.delete(key);
  }

  /**
   * Clear all entries
   */
  clear() {
    this.cache.clear();
  }

  /**
   * Get current cache size
   */
  size() {
    return this.cache.size;
  }

  /**
   * Get all keys
   */
  keys() {
    return this.cache.keys();
  }

  /**
   * Get all entries (for iteration)
   */
  entries() {
    return this.cache.entries();
  }

  /**
   * Prune expired entries
   * @returns {number} Number of entries removed
   */
  pruneExpired() {
    const now = Date.now();
    let pruned = 0;

    for (const [key, entry] of this.cache.entries()) {
      if (entry.expires > 0 && now > entry.expires) {
        this.cache.delete(key);
        pruned++;
      }
    }

    return pruned;
  }

  /**
   * Get cache statistics
   */
  getStats() {
    let expired = 0;
    let active = 0;
    const now = Date.now();

    for (const [, entry] of this.cache.entries()) {
      if (entry.expires > 0 && now > entry.expires) {
        expired++;
      } else {
        active++;
      }
    }

    return {
      total: this.cache.size,
      active,
      expired,
      maxSize: this.maxSize,
      utilization: Math.round((this.cache.size / this.maxSize) * 100),
    };
  }
}

export default LRUCache;
