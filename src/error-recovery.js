/**
 * Smart Error Recovery Module
 *
 * Provides intelligent error handling with:
 * - Error classification and context awareness
 * - Exponential backoff with jitter
 * - Circuit breaker pattern
 * - Recovery strategy selection based on error type and context
 * - Automatic recovery actions
 */

// Error categories with retry strategies
export const ErrorCategory = {
  TRANSIENT: 'transient',      // Network issues, overload - retry with backoff
  RATE_LIMIT: 'rate_limit',    // API rate limits - exponential backoff
  TIMEOUT: 'timeout',          // Operation timed out - may need longer timeout
  CONTEXT: 'context',          // Context issues - needs context reset/trim
  PERMISSION: 'permission',    // Permission denied - may need user intervention
  VALIDATION: 'validation',    // Invalid input - needs correction
  RESOURCE: 'resource',        // Resource not found - needs different approach
  INTERNAL: 'internal',        // Internal errors - retry with caution
  PERMANENT: 'permanent',      // Unrecoverable - do not retry
};

// Recovery strategies
export const RecoveryStrategy = {
  RETRY_IMMEDIATE: 'retry_immediate',     // Retry right away
  RETRY_BACKOFF: 'retry_backoff',         // Exponential backoff
  RETRY_EXTENDED: 'retry_extended',       // Longer timeout, then retry
  RESET_CONTEXT: 'reset_context',         // Clear context and retry
  TRIM_CONTEXT: 'trim_context',           // Reduce context size and retry
  SIMPLIFY_REQUEST: 'simplify_request',   // Simplify the request
  SKIP_STEP: 'skip_step',                 // Skip and move on
  ESCALATE: 'escalate',                   // Needs human intervention
  ABORT: 'abort',                         // Stop execution
};

// Error patterns for classification
const ERROR_PATTERNS = {
  [ErrorCategory.TRANSIENT]: [
    /ECONNRESET/i,
    /ETIMEDOUT/i,
    /ENOTFOUND/i,
    /ECONNREFUSED/i,
    /network/i,
    /connection/i,
    /socket hang up/i,
    /503/,
    /502/,
    /temporary/i,
  ],
  [ErrorCategory.RATE_LIMIT]: [
    /rate.?limit/i,
    /too many requests/i,
    /429/,
    /overloaded/i,
    /capacity/i,
    /throttl/i,
  ],
  [ErrorCategory.TIMEOUT]: [
    /timed?\s*out/i,
    /timeout/i,
    /deadline/i,
    /took too long/i,
  ],
  [ErrorCategory.CONTEXT]: [
    /context.*(too|length|long|large|size)/i,
    /token.*(limit|exceed|max)/i,
    /conversation.*too.*long/i,
    /input.*too.*large/i,
    /maximum.*context/i,
  ],
  [ErrorCategory.PERMISSION]: [
    /permission/i,
    /unauthorized/i,
    /forbidden/i,
    /access.?denied/i,
    /401/,
    /403/,
  ],
  [ErrorCategory.VALIDATION]: [
    /invalid/i,
    /malformed/i,
    /parse.*error/i,
    /syntax.*error/i,
    /schema/i,
  ],
  [ErrorCategory.RESOURCE]: [
    /not.?found/i,
    /404/,
    /does.?not.?exist/i,
    /missing/i,
    /no.?such/i,
  ],
  [ErrorCategory.INTERNAL]: [
    /internal.*error/i,
    /500/,
    /unexpected/i,
    /unknown.*error/i,
  ],
  [ErrorCategory.PERMANENT]: [
    /invalid.?api.?key/i,
    /authentication.*failed/i,
    /account.*suspended/i,
    /billing/i,
  ],
};

// Recovery strategy mapping
const RECOVERY_STRATEGIES = {
  [ErrorCategory.TRANSIENT]: [
    RecoveryStrategy.RETRY_BACKOFF,
    RecoveryStrategy.RETRY_BACKOFF,
    RecoveryStrategy.RETRY_EXTENDED,
    RecoveryStrategy.ESCALATE,
  ],
  [ErrorCategory.RATE_LIMIT]: [
    RecoveryStrategy.RETRY_BACKOFF,
    RecoveryStrategy.RETRY_BACKOFF,
    RecoveryStrategy.RETRY_EXTENDED,
    RecoveryStrategy.ESCALATE,
  ],
  [ErrorCategory.TIMEOUT]: [
    RecoveryStrategy.RETRY_EXTENDED,
    RecoveryStrategy.SIMPLIFY_REQUEST,
    RecoveryStrategy.SKIP_STEP,
    RecoveryStrategy.ESCALATE,
  ],
  [ErrorCategory.CONTEXT]: [
    RecoveryStrategy.TRIM_CONTEXT,
    RecoveryStrategy.RESET_CONTEXT,
    RecoveryStrategy.SIMPLIFY_REQUEST,
    RecoveryStrategy.ESCALATE,
  ],
  [ErrorCategory.PERMISSION]: [
    RecoveryStrategy.ESCALATE,
  ],
  [ErrorCategory.VALIDATION]: [
    RecoveryStrategy.SIMPLIFY_REQUEST,
    RecoveryStrategy.RETRY_IMMEDIATE,
    RecoveryStrategy.SKIP_STEP,
    RecoveryStrategy.ESCALATE,
  ],
  [ErrorCategory.RESOURCE]: [
    RecoveryStrategy.RETRY_IMMEDIATE,
    RecoveryStrategy.SKIP_STEP,
    RecoveryStrategy.ESCALATE,
  ],
  [ErrorCategory.INTERNAL]: [
    RecoveryStrategy.RETRY_BACKOFF,
    RecoveryStrategy.RETRY_BACKOFF,
    RecoveryStrategy.ESCALATE,
  ],
  [ErrorCategory.PERMANENT]: [
    RecoveryStrategy.ABORT,
  ],
};

export class ErrorRecovery {
  constructor(options = {}) {
    this.options = {
      baseDelay: options.baseDelay || 1000,
      maxDelay: options.maxDelay || 60000,
      maxRetries: options.maxRetries || 5,
      jitterFactor: options.jitterFactor || 0.3,
      circuitBreakerThreshold: options.circuitBreakerThreshold || 5,
      circuitBreakerResetTime: options.circuitBreakerResetTime || 60000,
      ...options,
    };

    // Error history for pattern detection
    this.errorHistory = [];
    this.maxHistorySize = 50;

    // Circuit breaker state
    this.circuitBreaker = {
      failures: 0,
      lastFailure: null,
      isOpen: false,
      openedAt: null,
    };

    // Per-operation retry counts
    this.retryCounters = new Map();
  }

  /**
   * Classify an error into a category
   * Checks PERMANENT errors first to avoid false positives from generic patterns
   */
  classifyError(error) {
    const errorStr = this.normalizeError(error);

    // Check PERMANENT errors first (most specific, should not retry)
    const permanentPatterns = ERROR_PATTERNS[ErrorCategory.PERMANENT];
    for (const pattern of permanentPatterns) {
      if (pattern.test(errorStr)) {
        return ErrorCategory.PERMANENT;
      }
    }

    // Then check other categories in order
    for (const [category, patterns] of Object.entries(ERROR_PATTERNS)) {
      if (category === ErrorCategory.PERMANENT) continue; // Already checked
      for (const pattern of patterns) {
        if (pattern.test(errorStr)) {
          return category;
        }
      }
    }

    return ErrorCategory.INTERNAL;
  }

  /**
   * Normalize error to string for pattern matching
   */
  normalizeError(error) {
    if (typeof error === 'string') return error;
    if (error instanceof Error) {
      return `${error.name}: ${error.message} ${error.stack || ''}`;
    }
    return JSON.stringify(error);
  }

  /**
   * Get recovery strategy for an error
   */
  getRecoveryStrategy(error, context = {}) {
    const category = this.classifyError(error);
    const operationId = context.operationId || 'default';
    const retryCount = this.getRetryCount(operationId);

    // Check circuit breaker
    if (this.isCircuitOpen()) {
      return {
        strategy: RecoveryStrategy.ABORT,
        category,
        reason: 'Circuit breaker is open - too many recent failures',
        retryCount,
        shouldRetry: false,
        delay: 0,
      };
    }

    // Get strategies for this category
    const strategies = RECOVERY_STRATEGIES[category] || [RecoveryStrategy.ESCALATE];

    // Select strategy based on retry count
    const strategyIndex = Math.min(retryCount, strategies.length - 1);
    const strategy = strategies[strategyIndex];

    // Calculate delay based on strategy
    const delay = this.calculateDelay(strategy, retryCount, category);

    // Determine if we should retry
    const shouldRetry = this.shouldRetry(strategy, retryCount, category);

    return {
      strategy,
      category,
      retryCount,
      shouldRetry,
      delay,
      maxRetries: this.getMaxRetries(category),
      contextAction: this.getContextAction(strategy, context),
    };
  }

  /**
   * Calculate delay for a retry
   */
  calculateDelay(strategy, retryCount, category) {
    switch (strategy) {
      case RecoveryStrategy.RETRY_IMMEDIATE:
        return 0;

      case RecoveryStrategy.RETRY_BACKOFF: {
        // Exponential backoff with jitter
        const baseDelay = this.options.baseDelay;
        const exponentialDelay = baseDelay * Math.pow(2, retryCount);
        const jitter = exponentialDelay * this.options.jitterFactor * Math.random();
        return Math.min(exponentialDelay + jitter, this.options.maxDelay);
      }

      case RecoveryStrategy.RETRY_EXTENDED: {
        // Extended timeout - longer delays
        const extendedBase = this.options.baseDelay * 3;
        const exponentialDelay = extendedBase * Math.pow(2, retryCount);
        const jitter = exponentialDelay * this.options.jitterFactor * Math.random();
        return Math.min(exponentialDelay + jitter, this.options.maxDelay * 2);
      }

      case RecoveryStrategy.RESET_CONTEXT:
      case RecoveryStrategy.TRIM_CONTEXT:
        // Context operations need minimal delay
        return 500;

      case RecoveryStrategy.SIMPLIFY_REQUEST:
        return 1000;

      default:
        return 0;
    }
  }

  /**
   * Determine if we should retry based on strategy and count
   */
  shouldRetry(strategy, retryCount, category) {
    // Never retry permanent errors
    if (category === ErrorCategory.PERMANENT) {
      return false;
    }

    // Check against max retries for this category
    const maxRetries = this.getMaxRetries(category);
    if (retryCount >= maxRetries) {
      return false;
    }

    // Non-retry strategies
    const noRetryStrategies = [
      RecoveryStrategy.SKIP_STEP,
      RecoveryStrategy.ESCALATE,
      RecoveryStrategy.ABORT,
    ];

    return !noRetryStrategies.includes(strategy);
  }

  /**
   * Get max retries for an error category
   */
  getMaxRetries(category) {
    const categoryMaxRetries = {
      [ErrorCategory.TRANSIENT]: 5,
      [ErrorCategory.RATE_LIMIT]: 4,
      [ErrorCategory.TIMEOUT]: 3,
      [ErrorCategory.CONTEXT]: 2,
      [ErrorCategory.VALIDATION]: 2,
      [ErrorCategory.RESOURCE]: 2,
      [ErrorCategory.INTERNAL]: 3,
      [ErrorCategory.PERMISSION]: 0,
      [ErrorCategory.PERMANENT]: 0,
    };

    return categoryMaxRetries[category] ?? this.options.maxRetries;
  }

  /**
   * Get context action for a recovery strategy
   */
  getContextAction(strategy, context) {
    switch (strategy) {
      case RecoveryStrategy.RESET_CONTEXT:
        return {
          action: 'reset',
          description: 'Clear conversation history and start fresh',
        };

      case RecoveryStrategy.TRIM_CONTEXT:
        return {
          action: 'trim',
          keepRecent: 5,
          description: 'Keep only recent messages to reduce context size',
        };

      case RecoveryStrategy.SIMPLIFY_REQUEST:
        return {
          action: 'simplify',
          description: 'Simplify the request or break it into smaller parts',
          suggestions: [
            'Remove detailed examples from prompt',
            'Break complex task into subtasks',
            'Use more concise instructions',
          ],
        };

      default:
        return null;
    }
  }

  /**
   * Record an error for history tracking
   */
  recordError(error, context = {}) {
    const entry = {
      error: this.normalizeError(error),
      category: this.classifyError(error),
      timestamp: Date.now(),
      context,
    };

    this.errorHistory.push(entry);

    // Trim history
    if (this.errorHistory.length > this.maxHistorySize) {
      this.errorHistory = this.errorHistory.slice(-this.maxHistorySize);
    }

    // Update circuit breaker
    this.updateCircuitBreaker(entry);

    // Update retry counter
    const operationId = context.operationId || 'default';
    this.incrementRetryCount(operationId);

    return entry;
  }

  /**
   * Record a success (resets retry counter and circuit breaker)
   */
  recordSuccess(context = {}) {
    const operationId = context.operationId || 'default';
    this.resetRetryCount(operationId);

    // Reduce circuit breaker failures on success
    if (this.circuitBreaker.failures > 0) {
      this.circuitBreaker.failures--;
    }

    // Close circuit if failures cleared
    if (this.circuitBreaker.failures === 0) {
      this.circuitBreaker.isOpen = false;
      this.circuitBreaker.openedAt = null;
    }
  }

  /**
   * Get retry count for an operation
   */
  getRetryCount(operationId) {
    return this.retryCounters.get(operationId) || 0;
  }

  /**
   * Increment retry count for an operation
   */
  incrementRetryCount(operationId) {
    const current = this.retryCounters.get(operationId) || 0;
    this.retryCounters.set(operationId, current + 1);
    return current + 1;
  }

  /**
   * Reset retry count for an operation
   */
  resetRetryCount(operationId) {
    this.retryCounters.delete(operationId);
  }

  /**
   * Update circuit breaker state
   */
  updateCircuitBreaker(errorEntry) {
    this.circuitBreaker.failures++;
    this.circuitBreaker.lastFailure = errorEntry.timestamp;

    // Open circuit if threshold exceeded
    if (this.circuitBreaker.failures >= this.options.circuitBreakerThreshold) {
      this.circuitBreaker.isOpen = true;
      this.circuitBreaker.openedAt = Date.now();
    }
  }

  /**
   * Check if circuit breaker is open
   */
  isCircuitOpen() {
    if (!this.circuitBreaker.isOpen) {
      return false;
    }

    // Check if reset time has elapsed
    const elapsed = Date.now() - this.circuitBreaker.openedAt;
    if (elapsed >= this.options.circuitBreakerResetTime) {
      // Allow a single attempt (half-open state)
      this.circuitBreaker.isOpen = false;
      this.circuitBreaker.failures = this.options.circuitBreakerThreshold - 1;
      return false;
    }

    return true;
  }

  /**
   * Get error trends from history
   */
  getErrorTrends() {
    const now = Date.now();
    const oneMinuteAgo = now - 60000;
    const fiveMinutesAgo = now - 300000;

    const recentErrors = this.errorHistory.filter(e => e.timestamp > oneMinuteAgo);
    const mediumErrors = this.errorHistory.filter(e => e.timestamp > fiveMinutesAgo);

    // Count by category
    const categoryCounts = {};
    for (const entry of this.errorHistory) {
      categoryCounts[entry.category] = (categoryCounts[entry.category] || 0) + 1;
    }

    return {
      total: this.errorHistory.length,
      lastMinute: recentErrors.length,
      lastFiveMinutes: mediumErrors.length,
      byCategory: categoryCounts,
      circuitBreakerOpen: this.circuitBreaker.isOpen,
      circuitBreakerFailures: this.circuitBreaker.failures,
    };
  }

  /**
   * Execute an operation with smart retry
   */
  async executeWithRetry(operation, context = {}) {
    const operationId = context.operationId || `op_${Date.now()}`;
    const maxRetries = context.maxRetries ?? this.options.maxRetries;

    while (true) {
      try {
        const result = await operation();
        this.recordSuccess({ operationId });
        return result;
      } catch (error) {
        const errorEntry = this.recordError(error, { operationId, ...context });
        const recovery = this.getRecoveryStrategy(error, { operationId, ...context });

        // Emit error event if callback provided
        if (context.onError) {
          context.onError({
            error,
            errorEntry,
            recovery,
          });
        }

        // Check if we should retry
        if (!recovery.shouldRetry) {
          // Execute context action if provided
          if (recovery.contextAction && context.onContextAction) {
            await context.onContextAction(recovery.contextAction);
          }

          throw new RecoveryError(error, recovery);
        }

        // Wait before retry
        if (recovery.delay > 0) {
          await this.sleep(recovery.delay);
        }

        // Execute context action if needed
        if (recovery.contextAction && context.onContextAction) {
          await context.onContextAction(recovery.contextAction);
        }
      }
    }
  }

  /**
   * Sleep helper
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get summary statistics
   */
  getSummary() {
    return {
      errorHistory: this.errorHistory.length,
      trends: this.getErrorTrends(),
      circuitBreaker: {
        isOpen: this.circuitBreaker.isOpen,
        failures: this.circuitBreaker.failures,
        lastFailure: this.circuitBreaker.lastFailure,
      },
      activeOperations: this.retryCounters.size,
    };
  }
}

/**
 * Custom error class for recovery failures
 */
export class RecoveryError extends Error {
  constructor(originalError, recovery) {
    super(`Recovery failed: ${recovery.strategy} - ${originalError.message}`);
    this.name = 'RecoveryError';
    this.originalError = originalError;
    this.recovery = recovery;
    this.category = recovery.category;
    this.strategy = recovery.strategy;
  }
}

export default ErrorRecovery;
