import { describe, it, expect } from 'vitest';
import {
  stringSimilarity,
  detectRepetitiveBehavior,
  generateRecoverySuggestion,
  suggestAutoRecovery,
} from '../repetition-detector.js';

describe('repetition-detector', () => {
  describe('stringSimilarity', () => {
    it('should return 0 for empty strings', () => {
      expect(stringSimilarity('', '')).toBe(0);
      expect(stringSimilarity('abc', '')).toBe(0);
      expect(stringSimilarity('', 'def')).toBe(0);
    });

    it('should return 0 for strings with only short words', () => {
      expect(stringSimilarity('a b c', 'a b c')).toBe(0);
      expect(stringSimilarity('the an', 'the an')).toBe(0);
    });

    it('should return 1 for identical strings with long words', () => {
      expect(stringSimilarity('hello world testing', 'hello world testing')).toBe(1);
    });

    it('should return high similarity for similar strings', () => {
      const str1 = 'implementing the feature correctly';
      const str2 = 'implementing the feature correctly now';
      const similarity = stringSimilarity(str1, str2);
      expect(similarity).toBeGreaterThan(0.7);
    });

    it('should return low similarity for different strings', () => {
      const str1 = 'implementing authentication module';
      const str2 = 'testing database connections';
      const similarity = stringSimilarity(str1, str2);
      expect(similarity).toBeLessThan(0.3);
    });

    it('should ignore words with 3 or fewer characters', () => {
      const str1 = 'the quick brown fox jumps';
      const str2 = 'a quick brown cat leaps';
      const similarity = stringSimilarity(str1, str2);
      // Words with 4+ chars: str1: quick, brown, jumps; str2: quick, brown, leaps
      // Intersection: quick, brown (2); Union: quick, brown, jumps, leaps (4)
      expect(similarity).toBe(0.5); // 2 overlap out of 4 unique
    });
  });

  describe('detectRepetitiveBehavior', () => {
    it('should return not repetitive for insufficient history', () => {
      expect(detectRepetitiveBehavior([]).isRepetitive).toBe(false);
      expect(detectRepetitiveBehavior([{ assessment: { score: 80 } }]).isRepetitive).toBe(false);
      expect(detectRepetitiveBehavior([
        { assessment: { score: 80 } },
        { assessment: { score: 75 } },
        { assessment: { score: 70 } },
        { assessment: { score: 65 } },
      ]).isRepetitive).toBe(false);
    });

    it('should detect score stuck pattern', () => {
      const history = Array(10).fill(null).map(() => ({
        assessment: { action: 'CONTINUE', score: 60 },
        responseSnippet: 'different content ' + Math.random(),
      }));

      const result = detectRepetitiveBehavior(history);

      expect(result.isRepetitive).toBe(true);
      expect(result.patterns.scoreStuck).toBe(true);
    });

    it('should not detect score stuck for high scores', () => {
      const history = Array(10).fill(null).map(() => ({
        assessment: { action: 'CONTINUE', score: 85 },
        responseSnippet: 'different content ' + Math.random(),
      }));

      const result = detectRepetitiveBehavior(history);

      expect(result.patterns.scoreStuck).toBe(false);
    });

    it('should not detect score stuck for high variance', () => {
      const scores = [40, 80, 45, 75, 50, 90, 55, 85, 60, 70];
      const history = scores.map((score, i) => ({
        assessment: { action: 'CONTINUE', score },
        responseSnippet: 'different content ' + i,
      }));

      const result = detectRepetitiveBehavior(history);

      expect(result.patterns.scoreStuck).toBe(false);
    });

    it('should detect repeated corrections pattern', () => {
      const history = Array(10).fill(null).map((_, i) => ({
        assessment: { action: i % 2 === 0 ? 'CORRECT' : 'REMIND', score: 50 + i * 5 },
        responseSnippet: 'different content ' + i,
      }));

      const result = detectRepetitiveBehavior(history);

      expect(result.isRepetitive).toBe(true);
      expect(result.patterns.repeatedCorrections).toBe(true);
    });

    it('should not flag repeated CONTINUE as issue', () => {
      const history = Array(10).fill(null).map((_, i) => ({
        assessment: { action: 'CONTINUE', score: 80 + i },
        responseSnippet: 'different content ' + i,
      }));

      const result = detectRepetitiveBehavior(history);

      expect(result.patterns.repeatedCorrections).toBe(false);
    });

    it('should detect similar content pattern', () => {
      const history = Array(10).fill(null).map(() => ({
        assessment: { action: 'CONTINUE', score: 80 },
        responseSnippet: 'implementing the authentication module correctly with proper validation',
      }));

      const result = detectRepetitiveBehavior(history);

      expect(result.isRepetitive).toBe(true);
      expect(result.patterns.similarContent).toBe(true);
    });

    it('should handle missing responseSnippet', () => {
      const history = Array(10).fill(null).map((_, i) => ({
        assessment: { action: 'CONTINUE', score: 80 + i },
      }));

      const result = detectRepetitiveBehavior(history);

      expect(result.patterns.similarContent).toBe(false);
    });

    it('should include suggestion when repetitive', () => {
      const history = Array(10).fill(null).map(() => ({
        assessment: { action: 'CORRECT', score: 45 },
        responseSnippet: 'same content repeatedly',
      }));

      const result = detectRepetitiveBehavior(history);

      expect(result.isRepetitive).toBe(true);
      expect(result.suggestion).toBeTruthy();
    });

    it('should not include suggestion when not repetitive', () => {
      const history = Array(10).fill(null).map((_, i) => ({
        assessment: { action: 'CONTINUE', score: 85 + (i % 5) },
        responseSnippet: `unique content ${i} with different words`,
      }));

      const result = detectRepetitiveBehavior(history);

      if (!result.isRepetitive) {
        expect(result.suggestion).toBeNull();
      }
    });
  });

  describe('generateRecoverySuggestion', () => {
    it('should suggest strategy change for repeated corrections', () => {
      const patterns = { repeatedCorrections: true, similarContent: false, scoreStuck: false };
      const suggestion = generateRecoverySuggestion(patterns);

      expect(suggestion).toContain('alternative approaches');
      expect(suggestion).toContain('different strategy');
    });

    it('should suggest breaking loop for similar content', () => {
      const patterns = { repeatedCorrections: false, similarContent: true, scoreStuck: false };
      const suggestion = generateRecoverySuggestion(patterns);

      expect(suggestion).toContain('in a loop');
      expect(suggestion).toContain('Start fresh');
    });

    it('should suggest addressing blocker for score stuck', () => {
      const patterns = { repeatedCorrections: false, similarContent: false, scoreStuck: true };
      const suggestion = generateRecoverySuggestion(patterns);

      expect(suggestion).toContain('plateaued');
      expect(suggestion).toContain('blocker');
    });

    it('should prioritize repeated corrections over other patterns', () => {
      const patterns = { repeatedCorrections: true, similarContent: true, scoreStuck: true };
      const suggestion = generateRecoverySuggestion(patterns);

      expect(suggestion).toContain('different strategy');
    });

    it('should return generic suggestion when no patterns match', () => {
      const patterns = { repeatedCorrections: false, similarContent: false, scoreStuck: false };
      const suggestion = generateRecoverySuggestion(patterns);

      expect(suggestion).toContain('different approach');
    });
  });

  describe('suggestAutoRecovery', () => {
    it('should return null when not repetitive', () => {
      const analysis = { isRepetitive: false };
      const context = { currentStep: null, primaryGoal: 'Goal' };

      const result = suggestAutoRecovery(analysis, context);

      expect(result).toBeNull();
    });

    it('should suggest SKIP_STEP for blocked step with repeated corrections', () => {
      const analysis = {
        isRepetitive: true,
        patterns: { repeatedCorrections: true, similarContent: false, scoreStuck: false, avgScore: 60 },
      };
      const context = { currentStep: { description: 'Setup database' }, primaryGoal: 'Build app' };

      const result = suggestAutoRecovery(analysis, context);

      expect(result.action).toBe('SKIP_STEP');
      expect(result.prompt).toContain('STEP BLOCKED');
    });

    it('should not suggest SKIP_STEP without current step', () => {
      const analysis = {
        isRepetitive: true,
        patterns: { repeatedCorrections: true, similarContent: true, scoreStuck: false, avgScore: 60 },
      };
      const context = { currentStep: null, primaryGoal: 'Goal' };

      const result = suggestAutoRecovery(analysis, context);

      // Should fall through to similarContent suggestion
      expect(result.action).toBe('CONTEXT_RESET');
    });

    it('should suggest CONTEXT_RESET for similar content', () => {
      const analysis = {
        isRepetitive: true,
        patterns: { repeatedCorrections: false, similarContent: true, scoreStuck: false, avgScore: 60 },
      };
      const context = { currentStep: { description: 'Test step' }, primaryGoal: 'Build app' };

      const result = suggestAutoRecovery(analysis, context);

      expect(result.action).toBe('CONTEXT_RESET');
      expect(result.prompt).toContain('in a loop');
      expect(result.prompt).toContain('Build app');
      expect(result.prompt).toContain('Test step');
    });

    it('should include step description when available', () => {
      const analysis = {
        isRepetitive: true,
        patterns: { repeatedCorrections: false, similarContent: true, scoreStuck: false, avgScore: 60 },
      };
      const context = { currentStep: { description: 'Implement auth' }, primaryGoal: 'Goal' };

      const result = suggestAutoRecovery(analysis, context);

      expect(result.prompt).toContain('Current step: Implement auth');
    });

    it('should suggest SIMPLIFY for low stuck scores', () => {
      const analysis = {
        isRepetitive: true,
        patterns: { repeatedCorrections: false, similarContent: false, scoreStuck: true, avgScore: 40 },
      };
      const context = { currentStep: null, primaryGoal: 'Goal' };

      const result = suggestAutoRecovery(analysis, context);

      expect(result.action).toBe('SIMPLIFY');
      expect(result.prompt).toContain('MINIMUM viable action');
    });

    it('should not suggest SIMPLIFY for higher scores', () => {
      const analysis = {
        isRepetitive: true,
        patterns: { repeatedCorrections: false, similarContent: false, scoreStuck: true, avgScore: 55 },
      };
      const context = { currentStep: null, primaryGoal: 'Goal' };

      const result = suggestAutoRecovery(analysis, context);

      // avgScore >= 50 so SIMPLIFY not triggered
      expect(result).toBeNull();
    });

    it('should prioritize SKIP_STEP over other suggestions', () => {
      const analysis = {
        isRepetitive: true,
        patterns: { repeatedCorrections: true, similarContent: true, scoreStuck: true, avgScore: 30 },
      };
      const context = { currentStep: { description: 'Step' }, primaryGoal: 'Goal' };

      const result = suggestAutoRecovery(analysis, context);

      expect(result.action).toBe('SKIP_STEP');
    });

    it('should return null when no patterns produce recovery actions', () => {
      const analysis = {
        isRepetitive: true,
        patterns: { repeatedCorrections: false, similarContent: false, scoreStuck: false, avgScore: 70 },
      };
      const context = { currentStep: null, primaryGoal: 'Goal' };

      const result = suggestAutoRecovery(analysis, context);

      expect(result).toBeNull();
    });
  });
});
