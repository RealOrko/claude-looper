/**
 * Tests for context-compression.js
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  estimateTokens,
  simpleHash,
  summarizeMessages,
  compressHistory,
  scoreMessageImportance,
  filterByImportance,
  createProgressContext,
  ResponseDeduplicator,
  TokenTracker,
} from '../context-compression.js';

describe('estimateTokens', () => {
  it('should return 0 for empty input', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens(null)).toBe(0);
    expect(estimateTokens(undefined)).toBe(0);
  });

  it('should estimate ~4 chars per token', () => {
    expect(estimateTokens('test')).toBe(1);
    expect(estimateTokens('testtest')).toBe(2);
    expect(estimateTokens('a'.repeat(100))).toBe(25);
  });
});

describe('simpleHash', () => {
  it('should generate consistent hashes', () => {
    const hash1 = simpleHash('test string');
    const hash2 = simpleHash('test string');
    expect(hash1).toBe(hash2);
  });

  it('should generate different hashes for different inputs', () => {
    const hash1 = simpleHash('string1');
    const hash2 = simpleHash('string2');
    expect(hash1).not.toBe(hash2);
  });

  it('should return base36 string', () => {
    const hash = simpleHash('test');
    expect(hash).toMatch(/^-?[a-z0-9]+$/);
  });
});

describe('summarizeMessages', () => {
  it('should extract step completions', () => {
    const messages = [
      { content: 'STEP COMPLETE - finished step 3' },
    ];

    const summary = summarizeMessages(messages);

    expect(summary).toContain('Completed step 3');
  });

  it('should extract file operations', () => {
    const messages = [
      { content: 'I created src/app.js and edited utils.js' },
    ];

    const summary = summarizeMessages(messages);

    expect(summary).toContain('created src/app.js');
  });

  it('should extract errors', () => {
    const messages = [
      { content: 'error: Module not found' },
    ];

    const summary = summarizeMessages(messages);

    expect(summary).toContain('Encountered:');
    expect(summary).toContain('error');
  });

  it('should extract decisions', () => {
    const messages = [
      { content: 'I decided to use TypeScript' },
    ];

    const summary = summarizeMessages(messages);

    expect(summary).toContain('decided to use TypeScript');
  });

  it('should deduplicate and limit points', () => {
    const messages = [];
    for (let i = 0; i < 30; i++) {
      messages.push({ content: `STEP COMPLETE - step ${i}` });
    }

    const summary = summarizeMessages(messages);
    const points = summary.split(';');

    expect(points.length).toBeLessThanOrEqual(15);
  });
});

describe('compressHistory', () => {
  it('should return unchanged for short history', () => {
    const history = [
      { role: 'user', content: 'msg1' },
      { role: 'assistant', content: 'msg2' },
    ];

    const result = compressHistory(history, { summaryThreshold: 30 });

    expect(result).toEqual(history);
  });

  it('should compress long history', () => {
    const history = [];
    for (let i = 0; i < 40; i++) {
      history.push({ role: 'assistant', content: `Message ${i}`, timestamp: i });
    }

    const result = compressHistory(history, { preserveRecent: 10, summaryThreshold: 30 });

    expect(result.length).toBe(11); // 1 summary + 10 recent
    expect(result[0].compressed).toBe(true);
    expect(result[0].content).toContain('Previous conversation summary');
  });

  it('should preserve recent messages', () => {
    const history = [];
    for (let i = 0; i < 40; i++) {
      history.push({ role: 'assistant', content: `Message ${i}` });
    }

    const result = compressHistory(history, { preserveRecent: 5, summaryThreshold: 30 });

    // Last 5 messages should be preserved
    expect(result[result.length - 1].content).toBe('Message 39');
    expect(result[result.length - 5].content).toBe('Message 35');
  });
});

describe('scoreMessageImportance', () => {
  it('should score recent messages higher', () => {
    const msg = { content: 'test' };

    const scoreEarly = scoreMessageImportance(msg, 0, 10);
    const scoreLate = scoreMessageImportance(msg, 9, 10);

    expect(scoreLate).toBeGreaterThan(scoreEarly);
  });

  it('should score system messages high', () => {
    const systemMsg = { role: 'system', content: 'test' };
    const assistantMsg = { role: 'assistant', content: 'test' };

    const systemScore = scoreMessageImportance(systemMsg, 5, 10);
    const assistantScore = scoreMessageImportance(assistantMsg, 5, 10);

    expect(systemScore).toBeGreaterThan(assistantScore);
  });

  it('should score step completions high', () => {
    const completionMsg = { content: 'STEP COMPLETE - finished task' };
    const normalMsg = { content: 'Working on task' };

    const completionScore = scoreMessageImportance(completionMsg, 5, 10);
    const normalScore = scoreMessageImportance(normalMsg, 5, 10);

    expect(completionScore).toBeGreaterThan(normalScore);
  });

  it('should penalize repetitive content', () => {
    const repetitiveMsg = { content: 'continue working on task' };
    const actionMsg = { content: 'I created the new file' };

    const repScore = scoreMessageImportance(repetitiveMsg, 5, 10);
    const actionScore = scoreMessageImportance(actionMsg, 5, 10);

    expect(actionScore).toBeGreaterThan(repScore);
  });

  it('should cap score between 0 and 100', () => {
    const superImportant = {
      role: 'system',
      content: 'STEP COMPLETE with error and decision and created file',
    };

    const score = scoreMessageImportance(superImportant, 9, 10);

    expect(score).toBeLessThanOrEqual(100);
    expect(score).toBeGreaterThanOrEqual(0);
  });
});

describe('filterByImportance', () => {
  it('should return empty for empty history', () => {
    const { filtered, savedTokens } = filterByImportance([]);

    expect(filtered).toEqual([]);
    expect(savedTokens).toBe(0);
  });

  it('should always keep first and last messages', () => {
    const history = [
      { role: 'system', content: 'First' },
      { role: 'assistant', content: 'Middle1' },
      { role: 'assistant', content: 'Middle2' },
      { role: 'assistant', content: 'Last' },
    ];

    const { filtered } = filterByImportance(history, { targetTokens: 5 });

    expect(filtered[0].content).toBe('First');
    expect(filtered[filtered.length - 1].content).toBe('Last');
  });

  it('should track saved tokens', () => {
    const history = [];
    for (let i = 0; i < 20; i++) {
      history.push({ content: 'x'.repeat(100) }); // ~25 tokens each
    }

    const { savedTokens } = filterByImportance(history, { targetTokens: 100 });

    expect(savedTokens).toBeGreaterThan(0);
  });

  it('should maintain original order', () => {
    const history = [
      { content: 'A' },
      { content: 'B' },
      { content: 'C' },
      { content: 'D' },
    ];

    const { filtered } = filterByImportance(history, { targetTokens: 100 });

    const indices = filtered.map(m => history.findIndex(h => h.content === m.content));
    for (let i = 1; i < indices.length; i++) {
      expect(indices[i]).toBeGreaterThan(indices[i - 1]);
    }
  });
});

describe('createProgressContext', () => {
  it('should return empty for no planner', () => {
    const result = createProgressContext(null, null);
    expect(result).toBe('');
  });

  it('should include progress info', () => {
    const planner = {
      plan: {
        steps: [
          { number: 1, status: 'completed' },
          { number: 2, status: 'completed' },
          { number: 3, status: 'pending' },
        ],
      },
      getProgress: () => ({ completed: 2, total: 3, percentComplete: 67 }),
      getCurrentStep: () => ({ number: 3, description: 'Final step' }),
    };

    const result = createProgressContext(planner, null);

    expect(result).toContain('Progress: 2/3');
    expect(result).toContain('67%');
    expect(result).toContain('Completed: [1,2]');
    expect(result).toContain('Current: 3. Final step');
  });

  it('should include milestones from goal tracker', () => {
    const goalTracker = {
      completedMilestones: ['Milestone 1', 'Milestone 2', 'Milestone 3', 'Milestone 4'],
    };

    const result = createProgressContext(null, goalTracker);

    expect(result).toContain('Milestones:');
    // Should only include last 3
    expect(result).toContain('Milestone 2');
    expect(result).toContain('Milestone 3');
    expect(result).toContain('Milestone 4');
  });
});

describe('ResponseDeduplicator', () => {
  let dedup;

  beforeEach(() => {
    dedup = new ResponseDeduplicator(3);
  });

  it('should detect duplicates', () => {
    expect(dedup.isDuplicate('first response')).toBe(false);
    expect(dedup.isDuplicate('first response')).toBe(true);
  });

  it('should use sliding window', () => {
    dedup.isDuplicate('response 1');
    dedup.isDuplicate('response 2');
    dedup.isDuplicate('response 3');
    dedup.isDuplicate('response 4'); // pushes out response 1

    // response 1 was pushed out, so it's no longer detected as duplicate
    expect(dedup.isDuplicate('response 1')).toBe(false);
    // But now response 1 is back in the window, so calling again should detect it
    expect(dedup.isDuplicate('response 1')).toBe(true);
  });

  it('should clear history', () => {
    dedup.isDuplicate('test');
    dedup.clear();

    expect(dedup.isDuplicate('test')).toBe(false);
  });

  it('should only compare first 1000 chars', () => {
    const longResponse1 = 'x'.repeat(1500);
    const longResponse2 = 'x'.repeat(1000) + 'y'.repeat(500);

    expect(dedup.isDuplicate(longResponse1)).toBe(false);
    // Same first 1000 chars = duplicate
    expect(dedup.isDuplicate(longResponse2)).toBe(true);
  });
});

describe('TokenTracker', () => {
  let tracker;

  beforeEach(() => {
    tracker = new TokenTracker();
  });

  it('should track total tokens', () => {
    tracker.track(100, 50);
    tracker.track(200, 100);

    expect(tracker.total).toBe(450);
  });

  it('should record saved tokens', () => {
    tracker.recordSaved(100);
    tracker.recordSaved(50);

    expect(tracker.saved).toBe(150);
  });

  it('should limit history', () => {
    for (let i = 0; i < 150; i++) {
      tracker.track(10, 10);
    }

    expect(tracker.history.length).toBe(100);
  });

  describe('getStats', () => {
    it('should return zeros for empty tracker', () => {
      const stats = tracker.getStats();

      expect(stats.total).toBe(0);
      expect(stats.saved).toBe(0);
      expect(stats.average).toBe(0);
      expect(stats.trend).toBe('stable');
    });

    it('should calculate average', () => {
      tracker.track(100, 100); // 200
      tracker.track(200, 200); // 400
      tracker.track(300, 300); // 600

      const stats = tracker.getStats();

      expect(stats.total).toBe(1200);
      expect(stats.average).toBe(400);
      expect(stats.iterations).toBe(3);
    });

    it('should detect increasing trend', () => {
      // Add older low values
      for (let i = 0; i < 15; i++) {
        tracker.track(50, 50);
      }
      // Add recent high values
      for (let i = 0; i < 10; i++) {
        tracker.track(200, 200);
      }

      const stats = tracker.getStats();

      expect(stats.trend).toBe('increasing');
    });

    it('should detect decreasing trend', () => {
      // Add older high values
      for (let i = 0; i < 15; i++) {
        tracker.track(200, 200);
      }
      // Add recent low values
      for (let i = 0; i < 10; i++) {
        tracker.track(50, 50);
      }

      const stats = tracker.getStats();

      expect(stats.trend).toBe('decreasing');
    });

    it('should calculate efficiency', () => {
      tracker.track(100, 100);
      tracker.recordSaved(100);

      const stats = tracker.getStats();

      // saved / (total + saved) = 100 / 300 = 33%
      expect(stats.efficiency).toBe(33);
    });
  });
});
