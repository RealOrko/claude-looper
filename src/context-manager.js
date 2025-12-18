/**
 * Context Manager - Intelligent context and cache management
 *
 * Features:
 * - Conversation history compression for token efficiency
 * - LRU cache for expensive operations
 * - Smart context windowing
 * - Progress state summarization
 * - Sliding window context with importance scoring
 * - Adaptive token budgeting
 * - Response deduplication
 */

// Simple LRU Cache implementation
class LRUCache {
  constructor(maxSize = 100) {
    this.maxSize = maxSize;
    this.cache = new Map();
  }

  get(key) {
    if (!this.cache.has(key)) return undefined;

    // Move to end (most recently used)
    const value = this.cache.get(key);
    this.cache.delete(key);
    this.cache.set(key, value);
    return value;
  }

  set(key, value, ttlMs = 0) {
    // Remove oldest if at capacity
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }

    const entry = {
      value,
      expires: ttlMs > 0 ? Date.now() + ttlMs : 0,
    };
    this.cache.set(key, entry);
  }

  has(key) {
    if (!this.cache.has(key)) return false;

    const entry = this.cache.get(key);
    if (entry.expires > 0 && Date.now() > entry.expires) {
      this.cache.delete(key);
      return false;
    }
    return true;
  }

  delete(key) {
    return this.cache.delete(key);
  }

  clear() {
    this.cache.clear();
  }

  size() {
    return this.cache.size;
  }
}

export class ContextManager {
  constructor(options = {}) {
    this.options = {
      maxHistoryMessages: options.maxHistoryMessages || 50,
      summaryThreshold: options.summaryThreshold || 30,
      maxTokenEstimate: options.maxTokenEstimate || 100000,
      cacheSize: options.cacheSize || 100,
      cacheTtlMs: options.cacheTtlMs || 5 * 60 * 1000, // 5 min default TTL
      // New options for enhanced context management
      importanceDecayRate: options.importanceDecayRate || 0.9,
      tokenBudget: options.tokenBudget || 50000, // Target token budget per context
      deduplicationWindow: options.deduplicationWindow || 10,
    };

    // Caches for different operation types
    this.assessmentCache = new LRUCache(this.options.cacheSize);
    this.planCache = new LRUCache(20);  // Fewer plans cached
    this.fileContentCache = new LRUCache(50);
    this.responseHashCache = new LRUCache(100); // For deduplication

    // State tracking
    this.conversationSummaries = [];
    this.keyDecisions = [];
    this.progressMilestones = [];
    this.tokenEstimate = 0;

    // Token tracking
    this.tokenUsage = {
      total: 0,
      saved: 0, // Tokens saved by compression/caching
      history: [], // Recent token usage per iteration
    };

    // Response deduplication
    this.recentResponseHashes = [];
  }

  /**
   * Estimate token count for a string (rough approximation)
   * Uses ~4 chars per token as a rough estimate
   */
  estimateTokens(text) {
    if (!text) return 0;
    return Math.ceil(text.length / 4);
  }

  /**
   * Generate a cache key for assessment requests
   */
  generateAssessmentCacheKey(response, goal, consecutiveIssues) {
    // Use a hash of relevant factors
    const responsePrefix = response.substring(0, 500);
    return `assess:${consecutiveIssues}:${this.simpleHash(responsePrefix + goal)}`;
  }

  /**
   * Simple string hash for cache keys
   */
  simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return hash.toString(36);
  }

  /**
   * Check if we have a cached assessment for similar context
   */
  getCachedAssessment(response, goal, consecutiveIssues) {
    const key = this.generateAssessmentCacheKey(response, goal, consecutiveIssues);
    const cached = this.assessmentCache.get(key);

    if (cached && !this.isExpired(cached)) {
      return cached.value;
    }
    return null;
  }

  /**
   * Cache an assessment result
   */
  cacheAssessment(response, goal, consecutiveIssues, assessment) {
    const key = this.generateAssessmentCacheKey(response, goal, consecutiveIssues);
    this.assessmentCache.set(key, assessment, this.options.cacheTtlMs);
  }

  /**
   * Check if a cached entry is expired
   */
  isExpired(entry) {
    return entry.expires > 0 && Date.now() > entry.expires;
  }

  /**
   * Compress conversation history to save tokens
   * Returns a summarized version of the history
   */
  compressHistory(history, preserveRecent = 10) {
    if (history.length <= this.options.summaryThreshold) {
      return history;
    }

    // Keep recent messages intact
    const recentMessages = history.slice(-preserveRecent);
    const olderMessages = history.slice(0, -preserveRecent);

    // Summarize older messages by extracting key information
    const summary = this.summarizeMessages(olderMessages);

    // Return compressed history with summary prefix
    return [
      {
        role: 'system',
        content: `[Previous conversation summary: ${summary}]`,
        timestamp: olderMessages[0]?.timestamp,
        compressed: true,
      },
      ...recentMessages,
    ];
  }

  /**
   * Summarize a list of messages into key points
   */
  summarizeMessages(messages) {
    const keyPoints = [];

    for (const msg of messages) {
      const content = msg.content || '';

      // Extract step completions
      if (content.match(/STEP\s+COMPLETE/i)) {
        const stepMatch = content.match(/step\s+(\d+)/i);
        if (stepMatch) {
          keyPoints.push(`Completed step ${stepMatch[1]}`);
        }
      }

      // Extract file operations
      const fileOps = content.match(/(?:created?|edited?|wrote|deleted?)\s+['""]?([a-zA-Z0-9_\-./]+)['""]?/gi);
      if (fileOps && fileOps.length > 0) {
        keyPoints.push(...fileOps.slice(0, 2).map(op => op.trim()));
      }

      // Extract errors encountered
      const errors = content.match(/error[:\s]+([^\n.]+)/gi);
      if (errors) {
        keyPoints.push(`Encountered: ${errors[0].substring(0, 50)}`);
      }

      // Extract decisions
      const decisions = content.match(/(?:decided to|will|going to)\s+([^\n.]+)/gi);
      if (decisions) {
        keyPoints.push(decisions[0].substring(0, 60));
      }
    }

    // Deduplicate and limit
    const uniquePoints = [...new Set(keyPoints)].slice(0, 15);
    return uniquePoints.join('; ');
  }

  /**
   * Create a compact progress context string
   */
  createProgressContext(planner, goalTracker) {
    const lines = [];

    // Current plan progress
    if (planner?.plan) {
      const progress = planner.getProgress();
      lines.push(`Progress: ${progress.completed}/${progress.total} steps (${progress.percentComplete}%)`);

      // List completed steps compactly
      const completed = planner.plan.steps
        .filter(s => s.status === 'completed')
        .map(s => s.number)
        .join(',');
      if (completed) {
        lines.push(`Completed: [${completed}]`);
      }

      // Current step
      const current = planner.getCurrentStep();
      if (current) {
        lines.push(`Current: ${current.number}. ${current.description}`);
      }
    }

    // Key milestones from goal tracker
    if (goalTracker?.completedMilestones?.length > 0) {
      lines.push(`Milestones: ${goalTracker.completedMilestones.slice(-3).join(', ')}`);
    }

    return lines.join('\n');
  }

  /**
   * Track a key decision for context
   */
  recordDecision(decision, reason) {
    this.keyDecisions.push({
      decision,
      reason,
      timestamp: Date.now(),
    });

    // Keep only recent decisions
    if (this.keyDecisions.length > 20) {
      this.keyDecisions = this.keyDecisions.slice(-20);
    }
  }

  /**
   * Track a progress milestone
   */
  recordMilestone(milestone) {
    this.progressMilestones.push({
      milestone,
      timestamp: Date.now(),
    });

    // Keep only recent milestones
    if (this.progressMilestones.length > 30) {
      this.progressMilestones = this.progressMilestones.slice(-30);
    }
  }

  /**
   * Get a compact summary of key decisions
   */
  getDecisionSummary() {
    if (this.keyDecisions.length === 0) return null;

    return this.keyDecisions
      .slice(-5)
      .map(d => `- ${d.decision}`)
      .join('\n');
  }

  /**
   * Build optimized context for worker prompt
   * Focuses on what's needed without bloat
   */
  buildOptimizedWorkerContext(options) {
    const {
      goal,
      currentStep,
      recentHistory,
      planner,
      goalTracker,
      maxLength = 5000,
    } = options;

    const sections = [];

    // Goal (always include)
    sections.push(`GOAL: ${goal}`);

    // Current step (if available)
    if (currentStep) {
      sections.push(`CURRENT STEP: ${currentStep.description}`);
    }

    // Progress summary
    const progressCtx = this.createProgressContext(planner, goalTracker);
    if (progressCtx) {
      sections.push(progressCtx);
    }

    // Key decisions (if any)
    const decisions = this.getDecisionSummary();
    if (decisions) {
      sections.push(`KEY DECISIONS:\n${decisions}`);
    }

    // Compress and include recent history
    if (recentHistory?.length > 0) {
      const compressed = this.compressHistory(recentHistory, 5);
      const summaryMsg = compressed.find(m => m.compressed);
      if (summaryMsg) {
        sections.push(summaryMsg.content);
      }
    }

    // Combine and truncate if needed
    let context = sections.join('\n\n');
    if (context.length > maxLength) {
      context = context.substring(0, maxLength) + '\n[truncated]';
    }

    return context;
  }

  /**
   * Clear all caches
   */
  clearCaches() {
    this.assessmentCache.clear();
    this.planCache.clear();
    this.fileContentCache.clear();
  }

  /**
   * Reset all context (for error recovery)
   */
  reset() {
    this.clearCaches();
    this.keyDecisions = [];
    this.progressMilestones = [];
    this.currentTokenBudget = this.options.tokenBudget;
  }

  /**
   * Trim context to keep only recent items (for error recovery)
   */
  trimToRecent(keepRecent = 5) {
    // Keep only the most recent decisions
    if (this.keyDecisions.length > keepRecent) {
      this.keyDecisions = this.keyDecisions.slice(-keepRecent);
    }

    // Keep only the most recent milestones
    if (this.progressMilestones.length > keepRecent) {
      this.progressMilestones = this.progressMilestones.slice(-keepRecent);
    }

    // Clear caches to reduce memory
    this.clearCaches();
  }

  /**
   * Get cache statistics
   */
  getCacheStats() {
    return {
      assessments: this.assessmentCache.size(),
      plans: this.planCache.size(),
      fileContents: this.fileContentCache.size(),
      decisions: this.keyDecisions.length,
      milestones: this.progressMilestones.length,
    };
  }

  /**
   * Prune expired entries from caches
   */
  pruneExpired() {
    const now = Date.now();
    let pruned = 0;

    for (const cache of [this.assessmentCache, this.planCache, this.fileContentCache]) {
      for (const [key, entry] of cache.cache.entries()) {
        if (entry.expires > 0 && now > entry.expires) {
          cache.cache.delete(key);
          pruned++;
        }
      }
    }

    return pruned;
  }

  /**
   * Score the importance of a message for context inclusion
   * Higher score = more important to keep
   */
  scoreMessageImportance(message, index, totalMessages) {
    let score = 0;
    const content = message.content || '';
    const recency = index / totalMessages; // 0 to 1, higher = more recent

    // Recency bonus (more recent = more important)
    score += recency * 30;

    // Role-based scoring
    if (message.role === 'system') score += 20; // System messages are important
    if (message.role === 'user') score += 10; // User messages often contain goals

    // Content-based scoring
    if (/STEP\s+COMPLETE/i.test(content)) score += 25; // Completion signals
    if (/STEP\s+BLOCKED/i.test(content)) score += 20; // Blocker information
    if (/error|exception|failed/i.test(content)) score += 15; // Error info
    if (/created?|wrote|implemented/i.test(content)) score += 10; // Actions taken
    if (/decision|decided|choosing/i.test(content)) score += 15; // Decisions

    // Penalize repetitive content
    if (/continue|working on|in progress/i.test(content) && content.length < 200) {
      score -= 10;
    }

    // Penalize very long messages (often verbose)
    if (content.length > 5000) score -= 5;

    return Math.max(0, Math.min(100, score));
  }

  /**
   * Apply importance-based filtering to conversation history
   * Keeps high-importance messages and recent messages
   */
  filterByImportance(history, targetTokens = null) {
    const budget = targetTokens || this.options.tokenBudget;
    if (history.length === 0) return history;

    // Score all messages
    const scored = history.map((msg, idx) => ({
      ...msg,
      importance: this.scoreMessageImportance(msg, idx, history.length),
      tokens: this.estimateTokens(msg.content),
      originalIndex: idx,
    }));

    // Always keep first (system) and last few messages
    const mustKeep = new Set([0, history.length - 1, history.length - 2, history.length - 3]);

    // Sort by importance (descending), but maintain relative order for kept messages
    let currentTokens = 0;
    const kept = [];

    // First, add must-keep messages
    for (const idx of mustKeep) {
      if (idx >= 0 && idx < scored.length) {
        kept.push(scored[idx]);
        currentTokens += scored[idx].tokens;
      }
    }

    // Then add high-importance messages until budget is reached
    const remaining = scored
      .filter((_, idx) => !mustKeep.has(idx))
      .sort((a, b) => b.importance - a.importance);

    for (const msg of remaining) {
      if (currentTokens + msg.tokens <= budget) {
        kept.push(msg);
        currentTokens += msg.tokens;
      }
    }

    // Sort back to original order
    kept.sort((a, b) => a.originalIndex - b.originalIndex);

    // Track saved tokens
    const originalTokens = scored.reduce((sum, m) => sum + m.tokens, 0);
    this.tokenUsage.saved += originalTokens - currentTokens;

    return kept.map(({ importance, tokens, originalIndex, ...msg }) => msg);
  }

  /**
   * Check if a response is a duplicate of recent responses
   * Returns true if duplicate detected
   */
  isDuplicateResponse(response) {
    const hash = this.simpleHash(response.substring(0, 1000));

    // Check recent hashes
    if (this.recentResponseHashes.includes(hash)) {
      return true;
    }

    // Add to recent hashes (sliding window)
    this.recentResponseHashes.push(hash);
    if (this.recentResponseHashes.length > this.options.deduplicationWindow) {
      this.recentResponseHashes.shift();
    }

    return false;
  }

  /**
   * Generate a smart context window for a prompt
   * Balances recency, importance, and token budget
   */
  generateSmartContext(options) {
    const {
      goal,
      currentStep,
      history = [],
      planner = null,
      goalTracker = null,
      maxTokens = this.options.tokenBudget,
    } = options;

    const sections = [];
    let remainingTokens = maxTokens;

    // Priority 1: Goal and current step (always include)
    const goalSection = `GOAL: ${goal}`;
    sections.push(goalSection);
    remainingTokens -= this.estimateTokens(goalSection);

    if (currentStep) {
      const stepSection = `CURRENT STEP: ${currentStep.description}`;
      sections.push(stepSection);
      remainingTokens -= this.estimateTokens(stepSection);
    }

    // Priority 2: Progress summary (compact)
    const progressCtx = this.createProgressContext(planner, goalTracker);
    if (progressCtx) {
      sections.push(progressCtx);
      remainingTokens -= this.estimateTokens(progressCtx);
    }

    // Priority 3: Key decisions
    const decisions = this.getDecisionSummary();
    if (decisions && remainingTokens > 500) {
      const decisionSection = `KEY DECISIONS:\n${decisions}`;
      sections.push(decisionSection);
      remainingTokens -= this.estimateTokens(decisionSection);
    }

    // Priority 4: Filtered conversation history
    if (history.length > 0 && remainingTokens > 1000) {
      const filteredHistory = this.filterByImportance(history, remainingTokens);
      const compressed = this.compressHistory(filteredHistory, 5);
      const summaryMsg = compressed.find(m => m.compressed);
      if (summaryMsg) {
        sections.push(summaryMsg.content);
      }
    }

    return sections.join('\n\n');
  }

  /**
   * Track token usage for an iteration
   */
  trackTokenUsage(promptTokens, responseTokens) {
    const total = promptTokens + responseTokens;
    this.tokenUsage.total += total;
    this.tokenUsage.history.push({
      timestamp: Date.now(),
      prompt: promptTokens,
      response: responseTokens,
      total,
    });

    // Keep only recent history
    if (this.tokenUsage.history.length > 100) {
      this.tokenUsage.history = this.tokenUsage.history.slice(-100);
    }
  }

  /**
   * Get token usage statistics
   */
  getTokenStats() {
    const history = this.tokenUsage.history;
    if (history.length === 0) {
      return {
        total: 0,
        saved: 0,
        average: 0,
        trend: 'stable',
      };
    }

    const average = Math.round(this.tokenUsage.total / history.length);

    // Calculate trend from recent usage
    const recentAvg = history.slice(-10).reduce((sum, h) => sum + h.total, 0) / Math.min(10, history.length);
    const olderAvg = history.slice(0, -10).reduce((sum, h) => sum + h.total, 0) / Math.max(1, history.length - 10);

    let trend = 'stable';
    if (recentAvg > olderAvg * 1.2) trend = 'increasing';
    else if (recentAvg < olderAvg * 0.8) trend = 'decreasing';

    return {
      total: this.tokenUsage.total,
      saved: this.tokenUsage.saved,
      average,
      trend,
      iterations: history.length,
      efficiency: this.tokenUsage.saved > 0
        ? Math.round((this.tokenUsage.saved / (this.tokenUsage.total + this.tokenUsage.saved)) * 100)
        : 0,
    };
  }

  /**
   * Suggest context optimizations based on usage patterns
   */
  suggestOptimizations() {
    const suggestions = [];
    const stats = this.getTokenStats();

    if (stats.trend === 'increasing') {
      suggestions.push('Token usage increasing - consider more aggressive history compression');
    }

    if (stats.average > 30000) {
      suggestions.push('High average token usage - enable stricter importance filtering');
    }

    if (this.keyDecisions.length > 15) {
      suggestions.push('Many decisions tracked - consider summarizing older decisions');
    }

    if (this.assessmentCache.size() > 80) {
      suggestions.push('Assessment cache nearly full - consider reducing TTL');
    }

    return suggestions;
  }
}

export default ContextManager;
