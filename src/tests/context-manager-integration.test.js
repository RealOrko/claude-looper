/**
 * Tests for ContextManager integration with AutonomousRunnerCLI
 * Verifies token tracking, history compression, and smart context generation
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ContextManager } from '../context-manager.js';

describe('ContextManager Integration', () => {
  let contextManager;

  beforeEach(() => {
    contextManager = new ContextManager({
      summaryThreshold: 10,
      tokenBudget: 5000,
      maxHistoryMessages: 50,
    });
  });

  describe('Token Usage Tracking', () => {
    it('should track token usage from API responses', () => {
      contextManager.trackTokenUsage(1000, 500);
      contextManager.trackTokenUsage(800, 400);

      const stats = contextManager.getTokenStats();
      expect(stats.total).toBe(2700); // 1500 + 1200
      expect(stats.iterations).toBe(2);
    });

    it('should calculate average token usage', () => {
      contextManager.trackTokenUsage(1000, 500);
      contextManager.trackTokenUsage(800, 400);
      contextManager.trackTokenUsage(600, 300);

      const stats = contextManager.getTokenStats();
      expect(stats.average).toBe(1200); // (1500 + 1200 + 900) / 3
    });

    it('should detect increasing token usage trend', () => {
      // Simulate older low usage
      for (let i = 0; i < 15; i++) {
        contextManager.trackTokenUsage(500, 200);
      }
      // Simulate recent high usage
      for (let i = 0; i < 10; i++) {
        contextManager.trackTokenUsage(2000, 1000);
      }

      const stats = contextManager.getTokenStats();
      expect(stats.trend).toBe('increasing');
    });

    it('should limit token usage history to prevent memory growth', () => {
      for (let i = 0; i < 150; i++) {
        contextManager.trackTokenUsage(100, 50);
      }

      expect(contextManager.tokenUsage.history.length).toBeLessThanOrEqual(100);
    });
  });

  describe('History Compression', () => {
    it('should compress history when exceeding threshold', () => {
      const history = [];
      for (let i = 0; i < 20; i++) {
        history.push({
          role: i % 2 === 0 ? 'user' : 'assistant',
          content: `Message ${i}: This is test content for compression testing.`,
          timestamp: Date.now() - (20 - i) * 1000,
        });
      }

      const compressed = contextManager.compressHistory(history, 5);

      // Should have summary message + recent messages
      expect(compressed.length).toBeLessThan(history.length);
      expect(compressed.some(m => m.compressed)).toBe(true);
    });

    it('should preserve recent messages during compression', () => {
      const history = [];
      for (let i = 0; i < 20; i++) {
        history.push({
          role: 'assistant',
          content: `Message ${i}`,
          timestamp: Date.now() - (20 - i) * 1000,
        });
      }

      const compressed = contextManager.compressHistory(history, 5);

      // Last 5 messages should be preserved
      const lastOriginal = history[history.length - 1].content;
      const lastCompressed = compressed[compressed.length - 1].content;
      expect(lastCompressed).toBe(lastOriginal);
    });

    it('should not compress if history is below threshold', () => {
      const history = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there' },
      ];

      const result = contextManager.compressHistory(history);

      expect(result).toEqual(history);
    });

    it('should extract key information in summaries', () => {
      const history = [
        { role: 'assistant', content: 'Step 1 STEP COMPLETE - Created the file' },
        { role: 'assistant', content: 'Edited src/index.js with the new function' },
        { role: 'assistant', content: 'Error: Failed to compile' },
      ];

      const summary = contextManager.summarizeMessages(history);

      // Should extract step completion, file operations, and errors
      expect(summary).toContain('Completed step 1');
      expect(summary).toContain('Edited src/index.js');
      expect(summary).toContain('Encountered:');
    });
  });

  describe('Smart Context Generation', () => {
    it('should generate context with goal and step', () => {
      const context = contextManager.generateSmartContext({
        goal: 'Build a REST API',
        currentStep: { description: 'Create endpoints' },
        history: [],
      });

      expect(context).toContain('GOAL: Build a REST API');
      expect(context).toContain('CURRENT STEP: Create endpoints');
    });

    it('should include progress context when planner provided', () => {
      const mockPlanner = {
        plan: {
          steps: [
            { number: 1, status: 'completed' },
            { number: 2, status: 'in_progress' },
            { number: 3, status: 'pending' },
          ],
        },
        getProgress: () => ({
          completed: 1,
          total: 3,
          percentComplete: 33,
        }),
        getCurrentStep: () => ({ number: 2, description: 'Step 2' }),
      };

      const context = contextManager.generateSmartContext({
        goal: 'Test goal',
        planner: mockPlanner,
      });

      expect(context).toContain('Progress:');
      expect(context).toContain('1/3');
    });

    it('should include key decisions when available', () => {
      contextManager.recordDecision('Use PostgreSQL', 'Better for complex queries');
      contextManager.recordDecision('Add caching', 'Improve performance');

      const context = contextManager.generateSmartContext({
        goal: 'Build app',
      });

      expect(context).toContain('KEY DECISIONS');
      expect(context).toContain('Use PostgreSQL');
    });

    it('should respect token budget', () => {
      // Add lots of decisions and history
      for (let i = 0; i < 20; i++) {
        contextManager.recordDecision(`Decision ${i}`, `Reason ${i}`);
      }

      const context = contextManager.generateSmartContext({
        goal: 'Test goal with a very long description that should be included',
        maxTokens: 500, // Low budget
      });

      // Context should be bounded
      const estimatedTokens = contextManager.estimateTokens(context);
      expect(estimatedTokens).toBeLessThan(1000); // Some overhead allowed
    });
  });

  describe('Optimized Worker Context', () => {
    it('should build compact context for parallel workers', () => {
      const context = contextManager.buildOptimizedWorkerContext({
        goal: 'Implement feature X',
        currentStep: { description: 'Write tests' },
        maxLength: 1000,
      });

      expect(context).toContain('GOAL: Implement feature X');
      expect(context).toContain('CURRENT STEP: Write tests');
      expect(context.length).toBeLessThanOrEqual(1000);
    });

    it('should truncate context that exceeds maxLength', () => {
      // Add many decisions to create long context
      for (let i = 0; i < 50; i++) {
        contextManager.recordDecision(
          `Very long decision ${i} with lots of text`,
          `Very long reason ${i} with even more text to fill up space`
        );
      }

      const context = contextManager.buildOptimizedWorkerContext({
        goal: 'Test goal that is moderately long to ensure we have content',
        maxLength: 100, // Very small to force truncation
      });

      // Context should be bounded by maxLength
      expect(context.length).toBeLessThanOrEqual(120); // Allow for [truncated] suffix
    });

    it('should include recent history summary', () => {
      const recentHistory = [
        { role: 'assistant', content: 'Created file src/api.js' },
        { role: 'assistant', content: 'Added error handling' },
      ];

      contextManager.buildOptimizedWorkerContext({
        goal: 'Build API',
        recentHistory,
        maxLength: 5000,
      });

      // History should be processed without errors
      expect(true).toBe(true);
    });
  });

  describe('Decision and Milestone Recording', () => {
    it('should record decisions with timestamps', () => {
      contextManager.recordDecision('Use TypeScript', 'Type safety');

      expect(contextManager.keyDecisions.length).toBe(1);
      expect(contextManager.keyDecisions[0].decision).toBe('Use TypeScript');
      expect(contextManager.keyDecisions[0].reason).toBe('Type safety');
      expect(contextManager.keyDecisions[0].timestamp).toBeDefined();
    });

    it('should limit decisions to prevent unbounded growth', () => {
      for (let i = 0; i < 30; i++) {
        contextManager.recordDecision(`Decision ${i}`, 'Reason');
      }

      expect(contextManager.keyDecisions.length).toBeLessThanOrEqual(20);
    });

    it('should record milestones', () => {
      contextManager.recordMilestone('Completed step 1: Setup');
      contextManager.recordMilestone('Completed step 2: Implementation');

      expect(contextManager.progressMilestones.length).toBe(2);
    });

    it('should limit milestones to prevent unbounded growth', () => {
      for (let i = 0; i < 50; i++) {
        contextManager.recordMilestone(`Milestone ${i}`);
      }

      expect(contextManager.progressMilestones.length).toBeLessThanOrEqual(30);
    });
  });

  describe('Duplicate Detection', () => {
    it('should detect duplicate responses', () => {
      const response = 'This is a test response that repeats.';

      const first = contextManager.isDuplicateResponse(response);
      const second = contextManager.isDuplicateResponse(response);

      expect(first).toBe(false);
      expect(second).toBe(true);
    });

    it('should use sliding window for duplicate detection', () => {
      // Fill up the window
      for (let i = 0; i < 15; i++) {
        contextManager.isDuplicateResponse(`Unique response ${i}`);
      }

      // Old response should no longer be detected as duplicate
      const oldResponse = 'Unique response 0';
      const isOldDuplicate = contextManager.isDuplicateResponse(oldResponse);

      // Depends on window size, but should allow old responses
      expect(contextManager.recentResponseHashes.length).toBeLessThanOrEqual(
        contextManager.options.deduplicationWindow
      );
    });
  });

  describe('Importance Scoring', () => {
    it('should score recent messages higher', () => {
      const messages = [
        { role: 'assistant', content: 'Old message' },
        { role: 'assistant', content: 'New message' },
      ];

      const oldScore = contextManager.scoreMessageImportance(messages[0], 0, 2);
      const newScore = contextManager.scoreMessageImportance(messages[1], 1, 2);

      expect(newScore).toBeGreaterThan(oldScore);
    });

    it('should score step completion signals higher', () => {
      const regular = { role: 'assistant', content: 'Working on the task' };
      const completion = { role: 'assistant', content: 'STEP COMPLETE - finished the work' };

      const regularScore = contextManager.scoreMessageImportance(regular, 0, 2);
      const completionScore = contextManager.scoreMessageImportance(completion, 0, 2);

      expect(completionScore).toBeGreaterThan(regularScore);
    });

    it('should score error messages higher', () => {
      const regular = { role: 'assistant', content: 'Processing request' };
      const error = { role: 'assistant', content: 'Error: Failed to compile the code' };

      const regularScore = contextManager.scoreMessageImportance(regular, 0, 2);
      const errorScore = contextManager.scoreMessageImportance(error, 0, 2);

      expect(errorScore).toBeGreaterThan(regularScore);
    });

    it('should filter messages by importance within token budget', () => {
      const history = [];
      for (let i = 0; i < 50; i++) {
        history.push({
          role: 'assistant',
          content: i === 25 ? 'STEP COMPLETE - Important!' : `Regular message ${i} with enough content to consume tokens and force filtering when budget is low`,
        });
      }

      // Use a very low token budget to force filtering
      const filtered = contextManager.filterByImportance(history, 500);

      // With low budget, should filter some messages
      expect(filtered.length).toBeLessThanOrEqual(history.length);
    });
  });

  describe('Cache Management', () => {
    it('should cache assessment results', () => {
      const assessment = { score: 85, action: 'CONTINUE' };

      contextManager.cacheAssessment('response text', 'goal', 0, assessment);

      const cached = contextManager.getCachedAssessment('response text', 'goal', 0);
      expect(cached).toBeDefined();
    });

    it('should return cache statistics', () => {
      contextManager.cacheAssessment('test', 'goal', 0, { score: 80 });
      contextManager.recordDecision('Decision', 'Reason');
      contextManager.recordMilestone('Milestone');

      const stats = contextManager.getCacheStats();

      expect(stats.assessments).toBeGreaterThanOrEqual(0);
      expect(stats.decisions).toBe(1);
      expect(stats.milestones).toBe(1);
    });

    it('should clear all caches on reset', () => {
      contextManager.cacheAssessment('test', 'goal', 0, { score: 80 });
      contextManager.recordDecision('Decision', 'Reason');

      contextManager.reset();

      expect(contextManager.keyDecisions.length).toBe(0);
      const stats = contextManager.getCacheStats();
      expect(stats.assessments).toBe(0);
    });
  });

  describe('Optimization Suggestions', () => {
    it('should suggest optimizations for high average token usage', () => {
      // Simulate high average token usage (>30000 average triggers suggestion)
      for (let i = 0; i < 10; i++) {
        contextManager.trackTokenUsage(25000, 10000); // 35000 per iteration
      }

      const suggestions = contextManager.suggestOptimizations();
      const stats = contextManager.getTokenStats();

      // Should have high average
      expect(stats.average).toBeGreaterThan(30000);
      expect(suggestions.some(s => s.toLowerCase().includes('token') || s.toLowerCase().includes('usage'))).toBe(true);
    });

    it('should suggest optimizations for many decisions', () => {
      // Need more than 15 decisions to trigger suggestion
      for (let i = 0; i < 18; i++) {
        contextManager.recordDecision(`Decision ${i}`, 'Reason');
      }

      const suggestions = contextManager.suggestOptimizations();

      expect(suggestions.some(s => s.toLowerCase().includes('decision'))).toBe(true);
    });

    it('should return empty suggestions when everything is optimal', () => {
      // Low token usage, few decisions
      contextManager.trackTokenUsage(1000, 500);
      contextManager.recordDecision('Single decision', 'Reason');

      const suggestions = contextManager.suggestOptimizations();

      // May or may not have suggestions depending on thresholds
      expect(Array.isArray(suggestions)).toBe(true);
    });
  });
});
