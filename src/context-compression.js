/**
 * Context Compression - Message history compression and token management
 *
 * Features:
 * - Conversation history compression
 * - Importance-based message filtering
 * - Token estimation and budgeting
 * - Response deduplication
 */

/**
 * Estimate token count for a string (rough approximation)
 * Uses ~4 chars per token as a rough estimate
 */
export function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

/**
 * Simple string hash for cache keys and deduplication
 */
export function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return hash.toString(36);
}

/**
 * Summarize a list of messages into key points
 */
export function summarizeMessages(messages) {
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
 * Compress conversation history to save tokens
 * Returns a summarized version of the history
 */
export function compressHistory(history, options = {}) {
  const { preserveRecent = 10, summaryThreshold = 30 } = options;

  if (history.length <= summaryThreshold) {
    return history;
  }

  // Keep recent messages intact
  const recentMessages = history.slice(-preserveRecent);
  const olderMessages = history.slice(0, -preserveRecent);

  // Summarize older messages by extracting key information
  const summary = summarizeMessages(olderMessages);

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
 * Score the importance of a message for context inclusion
 * Higher score = more important to keep
 */
export function scoreMessageImportance(message, index, totalMessages) {
  let score = 0;
  const content = message.content || '';
  const recency = index / totalMessages; // 0 to 1, higher = more recent

  // Recency bonus (more recent = more important)
  score += recency * 30;

  // Role-based scoring
  if (message.role === 'system') score += 20;
  if (message.role === 'user') score += 10;

  // Content-based scoring
  if (/STEP\s+COMPLETE/i.test(content)) score += 25;
  if (/STEP\s+BLOCKED/i.test(content)) score += 20;
  if (/error|exception|failed/i.test(content)) score += 15;
  if (/created?|wrote|implemented/i.test(content)) score += 10;
  if (/decision|decided|choosing/i.test(content)) score += 15;

  // Penalize repetitive content
  if (/continue|working on|in progress/i.test(content) && content.length < 200) {
    score -= 10;
  }

  // Penalize very long messages
  if (content.length > 5000) score -= 5;

  return Math.max(0, Math.min(100, score));
}

/**
 * Apply importance-based filtering to conversation history
 * Keeps high-importance messages and recent messages within token budget
 */
export function filterByImportance(history, options = {}) {
  const { targetTokens = 50000 } = options;

  if (history.length === 0) return { filtered: history, savedTokens: 0 };

  // Score all messages
  const scored = history.map((msg, idx) => ({
    ...msg,
    importance: scoreMessageImportance(msg, idx, history.length),
    tokens: estimateTokens(msg.content),
    originalIndex: idx,
  }));

  // Always keep first (system) and last few messages
  const mustKeep = new Set([0, history.length - 1, history.length - 2, history.length - 3]);

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
    if (currentTokens + msg.tokens <= targetTokens) {
      kept.push(msg);
      currentTokens += msg.tokens;
    }
  }

  // Sort back to original order
  kept.sort((a, b) => a.originalIndex - b.originalIndex);

  // Calculate saved tokens
  const originalTokens = scored.reduce((sum, m) => sum + m.tokens, 0);
  const savedTokens = originalTokens - currentTokens;

  // Clean up internal properties
  const filtered = kept.map(({ importance, tokens, originalIndex, ...msg }) => msg);

  return { filtered, savedTokens };
}

/**
 * Create a compact progress context string
 */
export function createProgressContext(planner, goalTracker) {
  const lines = [];

  if (planner?.plan) {
    const progress = planner.getProgress();
    lines.push(`Progress: ${progress.completed}/${progress.total} steps (${progress.percentComplete}%)`);

    const completed = planner.plan.steps
      .filter(s => s.status === 'completed')
      .map(s => s.number)
      .join(',');
    if (completed) {
      lines.push(`Completed: [${completed}]`);
    }

    const current = planner.getCurrentStep();
    if (current) {
      lines.push(`Current: ${current.number}. ${current.description}`);
    }
  }

  if (goalTracker?.completedMilestones?.length > 0) {
    lines.push(`Milestones: ${goalTracker.completedMilestones.slice(-3).join(', ')}`);
  }

  return lines.join('\n');
}

/**
 * Response deduplication tracker
 */
export class ResponseDeduplicator {
  constructor(windowSize = 10) {
    this.windowSize = windowSize;
    this.recentHashes = [];
  }

  /**
   * Check if a response is a duplicate
   * @returns {boolean} true if duplicate detected
   */
  isDuplicate(response) {
    const hash = simpleHash(response.substring(0, 1000));

    if (this.recentHashes.includes(hash)) {
      return true;
    }

    this.recentHashes.push(hash);
    if (this.recentHashes.length > this.windowSize) {
      this.recentHashes.shift();
    }

    return false;
  }

  /**
   * Clear the deduplication history
   */
  clear() {
    this.recentHashes = [];
  }
}

/**
 * Token usage tracker
 */
export class TokenTracker {
  constructor() {
    this.total = 0;
    this.saved = 0;
    this.history = [];
  }

  /**
   * Track token usage for an iteration
   */
  track(promptTokens, responseTokens) {
    const total = promptTokens + responseTokens;
    this.total += total;
    this.history.push({
      timestamp: Date.now(),
      prompt: promptTokens,
      response: responseTokens,
      total,
    });

    if (this.history.length > 100) {
      this.history = this.history.slice(-100);
    }
  }

  /**
   * Record saved tokens from compression
   */
  recordSaved(tokens) {
    this.saved += tokens;
  }

  /**
   * Get token usage statistics
   */
  getStats() {
    if (this.history.length === 0) {
      return { total: 0, saved: 0, average: 0, trend: 'stable' };
    }

    const average = Math.round(this.total / this.history.length);

    const recentAvg = this.history.slice(-10).reduce((sum, h) => sum + h.total, 0) / Math.min(10, this.history.length);
    const olderAvg = this.history.slice(0, -10).reduce((sum, h) => sum + h.total, 0) / Math.max(1, this.history.length - 10);

    let trend = 'stable';
    if (recentAvg > olderAvg * 1.2) trend = 'increasing';
    else if (recentAvg < olderAvg * 0.8) trend = 'decreasing';

    return {
      total: this.total,
      saved: this.saved,
      average,
      trend,
      iterations: this.history.length,
      efficiency: this.saved > 0
        ? Math.round((this.saved / (this.total + this.saved)) * 100)
        : 0,
    };
  }
}

export default {
  estimateTokens,
  simpleHash,
  summarizeMessages,
  compressHistory,
  scoreMessageImportance,
  filterByImportance,
  createProgressContext,
  ResponseDeduplicator,
  TokenTracker,
};
