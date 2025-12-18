/**
 * Configuration management for the autonomous runner
 *
 * Enhanced with:
 * - Model fallback configuration
 * - Retry and backoff settings
 * - Adaptive iteration delays
 * - Supervisor-specific settings
 * - Parallel execution configuration
 * - Context management settings
 * - Performance metrics options
 */

export const DEFAULT_CONFIG = {
  // Time limits in milliseconds
  timeLimits: {
    '30m': 30 * 60 * 1000,
    '1h': 60 * 60 * 1000,
    '2h': 2 * 60 * 60 * 1000,
    '4h': 4 * 60 * 60 * 1000,
    '8h': 8 * 60 * 60 * 1000,
    '24h': 24 * 60 * 60 * 1000,
  },

  // How often to check progress and remind of goals (ms)
  progressCheckInterval: 5 * 60 * 1000, // Every 5 minutes

  // Escalation thresholds - consecutive issues required to trigger each level
  escalationThresholds: {
    warn: 2,      // CORRECT - clear redirection
    intervene: 3, // REFOCUS - hard intervention
    critical: 4,  // CRITICAL - final warning
    abort: 5,     // ABORT - terminate session
  },

  // Stagnation threshold - no progress for this long triggers alert (ms)
  stagnationThreshold: 15 * 60 * 1000, // 15 minutes

  // Legacy alias (deprecated, use escalationThresholds.intervene)
  driftThreshold: 3,

  // Maximum tokens per response
  maxTokens: 16384,

  // Model configuration
  models: {
    worker: 'opus',           // Primary worker model
    workerFallback: 'sonnet', // Fallback when worker overloaded
    supervisor: 'sonnet',     // Supervisor model (fast assessments)
    supervisorFallback: 'haiku', // Supervisor fallback
    planner: 'opus',          // Planner model (complex reasoning)
    plannerFallback: 'sonnet', // Planner fallback
  },

  // Legacy model setting (deprecated, use models.worker)
  model: 'claude-sonnet-4-20250514',

  // Temperature for responses
  temperature: 0.2,

  // Retry configuration
  retry: {
    maxRetries: 5,            // Maximum retry attempts
    baseDelay: 1000,          // Base delay in ms (exponential backoff)
    maxDelay: 60000,          // Maximum delay between retries
    retryableErrors: ['ECONNRESET', 'ETIMEDOUT', 'overloaded', 'rate_limit'],
    circuitBreakerThreshold: 5,  // Open circuit after this many consecutive failures
    circuitBreakerResetTime: 60000, // Time in ms before circuit resets
    jitterFactor: 0.3,        // Jitter factor for backoff randomization
  },

  // Maximum retries on API errors (legacy, use retry.maxRetries)
  maxRetries: 3,

  // Delay between retries (ms) (legacy, use retry.baseDelay)
  retryDelay: 5000,

  // Tool timeout (ms)
  toolTimeout: 5 * 60 * 1000, // 5 minutes

  // Enable verbose logging
  verbose: false,

  // Iteration delay configuration
  iterationDelay: {
    minimum: 500,             // Minimum delay between iterations (ms)
    default: 2000,            // Default delay (ms)
    afterSuccess: 1000,       // Delay after successful step completion
    afterError: 3000,         // Delay after error (give system time to recover)
    adaptive: true,           // Enable adaptive delays based on performance
  },

  // Supervisor configuration
  supervisor: {
    useStructuredOutput: true,  // Use JSON schema for structured responses
    readOnlyTools: true,        // Restrict supervisor to read-only tools
    noSessionPersistence: true, // Don't save supervisor sessions
    maxResponseLength: 5000,    // Truncate worker responses for assessment
    skipForSimpleSteps: false,  // Skip supervision for 'simple' complexity steps
  },

  // Completion verification settings
  verification: {
    enabled: true,              // Whether to verify completion claims
    maxAttempts: 3,             // Max false claims before escalation
    challengeTimeout: 5 * 60 * 1000,  // 5 min for Claude to provide evidence
    testTimeout: 5 * 60 * 1000,       // 5 min for test execution
    requireArtifacts: true,     // Fail if no artifacts found for non-trivial goals
    runTests: true,             // Whether to actually run test commands
    testCommands: [             // Common test commands to try
      'npm test',
      'pytest',
      'go test ./...',
      'cargo test',
      'make test',
      'ctest',
    ],
    buildCommands: [            // Common build commands to try
      'npm run build',
      'go build ./...',
      'cargo build',
      'make',
      'cmake --build .',
    ],
  },

  // Parallel execution configuration
  parallelExecution: {
    enabled: true,              // Enable parallel step execution
    maxConcurrent: 3,           // Maximum steps to run in parallel
    requireDependencyAnalysis: true, // Require dependency analysis before parallel execution
  },

  // Context management settings
  contextManager: {
    maxHistoryMessages: 50,     // Maximum messages to keep in history
    summaryThreshold: 30,       // Compress history after this many messages
    tokenBudget: 50000,         // Target token budget per context
    importanceDecayRate: 0.9,   // Decay rate for message importance
    deduplicationWindow: 10,    // Check last N responses for duplicates
    cacheTtlMs: 5 * 60 * 1000,  // Cache TTL (5 minutes)
  },

  // Stall detection and recovery
  stallDetection: {
    enabled: true,              // Enable advanced stall detection
    scoreVarianceThreshold: 25, // Score variance threshold for stuck detection
    minScoreForStuck: 70,       // Below this avg score = possibly stuck
    similarityThreshold: 0.7,   // Response similarity threshold
    autoRecoveryEnabled: true,  // Enable automatic recovery attempts
    maxRecoveryAttempts: 3,     // Maximum recovery attempts before escalation
  },

  // Performance metrics settings
  metrics: {
    enabled: true,              // Enable performance tracking
    trackTokenUsage: true,      // Track token usage per iteration
    trackStepTiming: true,      // Track step execution timing
    retainHistoryCount: 100,    // Number of iterations to retain timing data
  },

  // State persistence for resumable sessions
  persistence: {
    enabled: true,              // Enable state persistence
    dir: '.claude-runner',      // Persistence directory (relative to working dir)
    autoSaveInterval: 30000,    // Auto-save interval in ms
    maxCheckpoints: 10,         // Maximum checkpoints to keep
    cacheMaxSize: 100,          // Maximum cached results
    cacheTTL: 3600000,          // Cache TTL (1 hour)
    cleanupAgeDays: 7,          // Delete completed sessions older than this
  },
};

export class Config {
  constructor(userConfig = {}) {
    this.settings = { ...DEFAULT_CONFIG, ...userConfig };
  }

  get(key) {
    return this.settings[key];
  }

  set(key, value) {
    this.settings[key] = value;
  }

  getTimeLimit(limitString) {
    if (typeof limitString === 'number') {
      return limitString;
    }
    return this.settings.timeLimits[limitString] || this.parseTimeString(limitString);
  }

  parseTimeString(str) {
    const match = str.match(/^(\d+)(m|h|d)$/);
    if (!match) {
      throw new Error(`Invalid time format: ${str}. Use format like "30m", "2h", "1d"`);
    }
    const value = parseInt(match[1], 10);
    const unit = match[2];
    const multipliers = { m: 60 * 1000, h: 60 * 60 * 1000, d: 24 * 60 * 60 * 1000 };
    return value * multipliers[unit];
  }
}
