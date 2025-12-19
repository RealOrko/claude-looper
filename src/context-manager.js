/**
 * Context Manager - Intelligent context and cache management
 *
 * Features:
 * - Conversation history compression for token efficiency
 * - LRU cache for expensive operations
 * - Smart context windowing
 * - Progress state summarization
 *
 * Delegates to specialized modules:
 * - LRUCache: Cache implementation
 * - context-compression: Token management and compression
 */

import { LRUCache } from './lru-cache.js';
import {
  estimateTokens,
  simpleHash,
  compressHistory,
  filterByImportance,
  createProgressContext,
  ResponseDeduplicator,
  TokenTracker,
} from './context-compression.js';

export class ContextManager {
  constructor(options = {}) {
    this.options = {
      maxHistoryMessages: options.maxHistoryMessages || 50,
      summaryThreshold: options.summaryThreshold || 30,
      maxTokenEstimate: options.maxTokenEstimate || 100000,
      cacheSize: options.cacheSize || 100,
      cacheTtlMs: options.cacheTtlMs || 5 * 60 * 1000,
      importanceDecayRate: options.importanceDecayRate || 0.9,
      tokenBudget: options.tokenBudget || 50000,
      deduplicationWindow: options.deduplicationWindow || 10,
    };

    // Caches for different operation types
    this.assessmentCache = new LRUCache(this.options.cacheSize);
    this.planCache = new LRUCache(20);
    this.fileContentCache = new LRUCache(50);

    // State tracking
    this.keyDecisions = [];
    this.progressMilestones = [];

    // Token tracking
    this.tokenTracker = new TokenTracker();

    // Response deduplication
    this.responseDeduplicator = new ResponseDeduplicator(this.options.deduplicationWindow);
  }

  estimateTokens(text) {
    return estimateTokens(text);
  }

  generateAssessmentCacheKey(response, goal, consecutiveIssues) {
    const responsePrefix = response.substring(0, 500);
    return `assess:${consecutiveIssues}:${simpleHash(responsePrefix + goal)}`;
  }

  simpleHash(str) {
    return simpleHash(str);
  }

  getCachedAssessment(response, goal, consecutiveIssues) {
    const key = this.generateAssessmentCacheKey(response, goal, consecutiveIssues);
    return this.assessmentCache.get(key) || null;
  }

  cacheAssessment(response, goal, consecutiveIssues, assessment) {
    const key = this.generateAssessmentCacheKey(response, goal, consecutiveIssues);
    this.assessmentCache.set(key, assessment, this.options.cacheTtlMs);
  }

  compressHistory(history, preserveRecent = 10) {
    return compressHistory(history, {
      preserveRecent,
      summaryThreshold: this.options.summaryThreshold,
    });
  }

  createProgressContext(planner, goalTracker) {
    return createProgressContext(planner, goalTracker);
  }

  recordDecision(decision, reason) {
    this.keyDecisions.push({
      decision,
      reason,
      timestamp: Date.now(),
    });

    if (this.keyDecisions.length > 20) {
      this.keyDecisions = this.keyDecisions.slice(-20);
    }
  }

  recordMilestone(milestone) {
    this.progressMilestones.push({
      milestone,
      timestamp: Date.now(),
    });

    if (this.progressMilestones.length > 30) {
      this.progressMilestones = this.progressMilestones.slice(-30);
    }
  }

  getDecisionSummary() {
    if (this.keyDecisions.length === 0) return null;

    return this.keyDecisions
      .slice(-5)
      .map(d => `- ${d.decision}`)
      .join('\n');
  }

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

    sections.push(`GOAL: ${goal}`);

    if (currentStep) {
      sections.push(`CURRENT STEP: ${currentStep.description}`);
    }

    const progressCtx = this.createProgressContext(planner, goalTracker);
    if (progressCtx) {
      sections.push(progressCtx);
    }

    const decisions = this.getDecisionSummary();
    if (decisions) {
      sections.push(`KEY DECISIONS:\n${decisions}`);
    }

    if (recentHistory?.length > 0) {
      const compressed = this.compressHistory(recentHistory, 5);
      const summaryMsg = compressed.find(m => m.compressed);
      if (summaryMsg) {
        sections.push(summaryMsg.content);
      }
    }

    let context = sections.join('\n\n');
    if (context.length > maxLength) {
      context = context.substring(0, maxLength) + '\n[truncated]';
    }

    return context;
  }

  clearCaches() {
    this.assessmentCache.clear();
    this.planCache.clear();
    this.fileContentCache.clear();
  }

  reset() {
    this.clearCaches();
    this.keyDecisions = [];
    this.progressMilestones = [];
  }

  trimToRecent(keepRecent = 5) {
    if (this.keyDecisions.length > keepRecent) {
      this.keyDecisions = this.keyDecisions.slice(-keepRecent);
    }

    if (this.progressMilestones.length > keepRecent) {
      this.progressMilestones = this.progressMilestones.slice(-keepRecent);
    }

    this.clearCaches();
  }

  getCacheStats() {
    return {
      assessments: this.assessmentCache.size(),
      plans: this.planCache.size(),
      fileContents: this.fileContentCache.size(),
      decisions: this.keyDecisions.length,
      milestones: this.progressMilestones.length,
    };
  }

  pruneExpired() {
    let pruned = 0;
    pruned += this.assessmentCache.pruneExpired();
    pruned += this.planCache.pruneExpired();
    pruned += this.fileContentCache.pruneExpired();
    return pruned;
  }

  filterByImportance(history, targetTokens = null) {
    const { filtered, savedTokens } = filterByImportance(history, {
      targetTokens: targetTokens || this.options.tokenBudget,
    });
    this.tokenTracker.recordSaved(savedTokens);
    return filtered;
  }

  isDuplicateResponse(response) {
    return this.responseDeduplicator.isDuplicate(response);
  }

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

    const goalSection = `GOAL: ${goal}`;
    sections.push(goalSection);
    remainingTokens -= this.estimateTokens(goalSection);

    if (currentStep) {
      const stepSection = `CURRENT STEP: ${currentStep.description}`;
      sections.push(stepSection);
      remainingTokens -= this.estimateTokens(stepSection);
    }

    const progressCtx = this.createProgressContext(planner, goalTracker);
    if (progressCtx) {
      sections.push(progressCtx);
      remainingTokens -= this.estimateTokens(progressCtx);
    }

    const decisions = this.getDecisionSummary();
    if (decisions && remainingTokens > 500) {
      const decisionSection = `KEY DECISIONS:\n${decisions}`;
      sections.push(decisionSection);
      remainingTokens -= this.estimateTokens(decisionSection);
    }

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

  trackTokenUsage(promptTokens, responseTokens) {
    this.tokenTracker.track(promptTokens, responseTokens);
  }

  getTokenStats() {
    return this.tokenTracker.getStats();
  }

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
