/**
 * Tests for dashboard/state.js
 */
import { describe, it, expect } from 'vitest';
import { createInitialState, updateScoreHistory, initializeState } from '../state.js';

describe('dashboard/state', () => {
  describe('createInitialState', () => {
    it('should create state with all required fields', () => {
      const state = createInitialState();

      expect(state.goal).toBe('');
      expect(state.subGoals).toEqual([]);
      expect(state.timeLimit).toBe('');
      expect(state.startTime).toBe(null);
      expect(state.iteration).toBe(0);
      expect(state.progress).toBe(0);
      expect(state.status).toBe('initializing');
      expect(state.phase).toBe('');
      expect(state.sessionId).toBe(null);
      expect(state.scoreHistory).toEqual([]);
      expect(state.lastScore).toBe(null);
      expect(state.consecutiveIssues).toBe(0);
      expect(state.messages).toEqual([]);
      expect(state.verification).toBe(null);
      expect(state.error).toBe(null);
    });
  });

  describe('updateScoreHistory', () => {
    it('should add score to history', () => {
      const state = { scoreHistory: [], lastScore: null };
      updateScoreHistory(state, 75);

      expect(state.scoreHistory).toEqual([75]);
      expect(state.lastScore).toBe(75);
    });

    it('should update lastScore with new value', () => {
      const state = { scoreHistory: [50], lastScore: 50 };
      updateScoreHistory(state, 80);

      expect(state.scoreHistory).toEqual([50, 80]);
      expect(state.lastScore).toBe(80);
    });

    it('should trim history to max size', () => {
      const state = { scoreHistory: Array(50).fill(50), lastScore: 50 };
      updateScoreHistory(state, 99);

      expect(state.scoreHistory.length).toBe(50);
      expect(state.scoreHistory[state.scoreHistory.length - 1]).toBe(99);
    });

    it('should ignore undefined scores', () => {
      const state = { scoreHistory: [50], lastScore: 50 };
      updateScoreHistory(state, undefined);

      expect(state.scoreHistory).toEqual([50]);
      expect(state.lastScore).toBe(50);
    });
  });

  describe('initializeState', () => {
    it('should initialize state with provided data', () => {
      const state = createInitialState();
      const data = {
        goal: 'Test goal',
        subGoals: ['Sub 1', 'Sub 2'],
        timeLimit: '30m',
      };

      initializeState(state, data);

      expect(state.goal).toBe('Test goal');
      expect(state.subGoals).toEqual(['Sub 1', 'Sub 2']);
      expect(state.timeLimit).toBe('30m');
      expect(state.startTime).toBeDefined();
      expect(state.status).toBe('initialized');
    });

    it('should default subGoals to empty array', () => {
      const state = createInitialState();
      initializeState(state, { goal: 'Test', timeLimit: '1h' });

      expect(state.subGoals).toEqual([]);
    });
  });
});
