/**
 * Configuration management for the autonomous runner
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

  // Model to use
  model: 'claude-sonnet-4-20250514',

  // Temperature for responses
  temperature: 0.2,

  // Maximum retries on API errors
  maxRetries: 3,

  // Delay between retries (ms)
  retryDelay: 5000,

  // Tool timeout (ms)
  toolTimeout: 5 * 60 * 1000, // 5 minutes

  // Enable verbose logging
  verbose: false,

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
