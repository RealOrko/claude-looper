import { describe, it, expect } from 'vitest';
import {
  PROGRESS_INDICATORS,
  BLOCKER_INDICATORS,
  TOOL_USAGE_INDICATORS,
  ERROR_INDICATORS,
  buildSupervisionHistory,
  buildStructuredPrompt,
  buildTextPrompt,
  canUseFastAssessment,
  canUseUltraFastAssessment,
} from '../assessment-prompts.js';

describe('assessment-prompts', () => {
  describe('PROGRESS_INDICATORS', () => {
    it('should match STEP COMPLETE', () => {
      expect(PROGRESS_INDICATORS.some(p => p.test('STEP COMPLETE'))).toBe(true);
      expect(PROGRESS_INDICATORS.some(p => p.test('STEP  COMPLETE'))).toBe(true);
    });

    it('should match success phrases', () => {
      expect(PROGRESS_INDICATORS.some(p => p.test('successfully created'))).toBe(true);
      expect(PROGRESS_INDICATORS.some(p => p.test('successfully implemented'))).toBe(true);
    });

    it('should match completion phrases', () => {
      expect(PROGRESS_INDICATORS.some(p => p.test('completed the task'))).toBe(true);
      expect(PROGRESS_INDICATORS.some(p => p.test('finished'))).toBe(true);
    });

    it('should match checkmarks', () => {
      expect(PROGRESS_INDICATORS.some(p => p.test('✓ done'))).toBe(true);
      expect(PROGRESS_INDICATORS.some(p => p.test('✔ complete'))).toBe(true);
    });
  });

  describe('BLOCKER_INDICATORS', () => {
    it('should match STEP BLOCKED', () => {
      expect(BLOCKER_INDICATORS.some(p => p.test('STEP BLOCKED'))).toBe(true);
    });

    it('should match error keywords', () => {
      expect(BLOCKER_INDICATORS.some(p => p.test('error occurred'))).toBe(true);
      expect(BLOCKER_INDICATORS.some(p => p.test('exception thrown'))).toBe(true);
      expect(BLOCKER_INDICATORS.some(p => p.test('failed to complete'))).toBe(true);
    });

    it('should match blocking keywords', () => {
      expect(BLOCKER_INDICATORS.some(p => p.test('stuck on this'))).toBe(true);
      expect(BLOCKER_INDICATORS.some(p => p.test('blocked by'))).toBe(true);
    });
  });

  describe('TOOL_USAGE_INDICATORS', () => {
    it('should match tool names', () => {
      expect(TOOL_USAGE_INDICATORS.some(p => p.test('Read tool executed'))).toBe(true);
      expect(TOOL_USAGE_INDICATORS.some(p => p.test('Write tool called'))).toBe(true);
      expect(TOOL_USAGE_INDICATORS.some(p => p.test('Bash tool running'))).toBe(true);
    });

    it('should match file operations', () => {
      expect(TOOL_USAGE_INDICATORS.some(p => p.test('reading file contents'))).toBe(true);
      expect(TOOL_USAGE_INDICATORS.some(p => p.test('writing file to disk'))).toBe(true);
    });

    it('should match intent phrases', () => {
      expect(TOOL_USAGE_INDICATORS.some(p => p.test('Let me read the file'))).toBe(true);
      expect(TOOL_USAGE_INDICATORS.some(p => p.test("I'll search for it"))).toBe(true);
    });
  });

  describe('ERROR_INDICATORS', () => {
    it('should match error messages', () => {
      expect(ERROR_INDICATORS.some(p => p.test('error: something wrong'))).toBe(true);
      expect(ERROR_INDICATORS.some(p => p.test('exception: null pointer'))).toBe(true);
    });

    it('should match permission issues', () => {
      expect(ERROR_INDICATORS.some(p => p.test('permission denied'))).toBe(true);
    });
  });

  describe('buildSupervisionHistory', () => {
    const thresholds = { warn: 2, intervene: 4, critical: 6, abort: 8 };

    it('should return message for empty history', () => {
      const result = buildSupervisionHistory([], 0, thresholds);
      expect(result).toBe('No previous assessments.');
    });

    it('should format assessments correctly', () => {
      const history = [
        { assessment: { action: 'CONTINUE', score: 85, reason: 'Good work' } },
      ];
      const result = buildSupervisionHistory(history, 0, thresholds);
      expect(result).toContain('[CONTINUE] Score: 85/100');
      expect(result).toContain('Good work');
    });

    it('should only use last 3 assessments', () => {
      const history = [
        { assessment: { action: 'CONTINUE', score: 90 } },
        { assessment: { action: 'CONTINUE', score: 85 } },
        { assessment: { action: 'CONTINUE', score: 80 } },
        { assessment: { action: 'REMIND', score: 60 } },
      ];
      const result = buildSupervisionHistory(history, 0, thresholds);
      expect(result).not.toContain('Score: 90');
      expect(result).toContain('Score: 85');
    });

    it('should add warn alert', () => {
      const result = buildSupervisionHistory([{ assessment: { action: 'CORRECT', score: 40 } }], 2, thresholds);
      expect(result).toContain('⚠️ ALERT');
    });

    it('should add intervene warning', () => {
      const result = buildSupervisionHistory([{ assessment: { action: 'CORRECT', score: 40 } }], 4, thresholds);
      expect(result).toContain('⚠️ WARNING');
    });

    it('should add critical warning', () => {
      const result = buildSupervisionHistory([{ assessment: { action: 'CORRECT', score: 40 } }], 6, thresholds);
      expect(result).toContain('⚠️ CRITICAL');
    });
  });

  describe('buildStructuredPrompt', () => {
    it('should build prompt with all fields', () => {
      const params = {
        response: 'Test response',
        recentActions: ['action1'],
        primaryGoal: 'Build app',
        currentPhase: 'Setup',
        consecutiveIssues: 1,
        thresholds: { warn: 2, intervene: 4, abort: 8 },
        hasSubGoals: true,
      };

      const result = buildStructuredPrompt(params);

      expect(result).toContain('SUPERVISOR: Evaluate');
      expect(result).toContain('Build app');
      expect(result).toContain('CURRENT PHASE: Setup');
      expect(result).toContain('Test response');
      expect(result).toContain('action1');
    });

    it('should exclude phase when no subgoals', () => {
      const params = {
        response: 'Test',
        recentActions: [],
        primaryGoal: 'Goal',
        currentPhase: 'Phase',
        consecutiveIssues: 0,
        thresholds: { abort: 8 },
        hasSubGoals: false,
      };

      const result = buildStructuredPrompt(params);

      expect(result).not.toContain('CURRENT PHASE');
    });

    it('should show None for empty actions', () => {
      const params = {
        response: 'Test',
        recentActions: [],
        primaryGoal: 'Goal',
        currentPhase: '',
        consecutiveIssues: 0,
        thresholds: { abort: 8 },
        hasSubGoals: false,
      };

      const result = buildStructuredPrompt(params);

      expect(result).toContain('RECENT ACTIONS: None');
    });
  });

  describe('buildTextPrompt', () => {
    it('should build detailed prompt', () => {
      const params = {
        response: 'Test response',
        recentActions: ['action1', 'action2'],
        primaryGoal: 'Build application',
        subGoals: [{ status: 'done', description: 'Setup' }],
        currentPhase: 'Development',
        supervisionHistory: 'No previous assessments.',
        thresholds: { warn: 2, intervene: 4 },
        hasSubGoals: true,
      };

      const result = buildTextPrompt(params);

      expect(result).toContain('You are a SUPERVISOR');
      expect(result).toContain('Build application');
      expect(result).toContain('SUB-GOALS');
      expect(result).toContain('[done] Setup');
      expect(result).toContain('Working on: Development');
      expect(result).toContain('SCORING GUIDE');
    });

    it('should exclude subgoals section when none', () => {
      const params = {
        response: 'Test',
        recentActions: [],
        primaryGoal: 'Goal',
        subGoals: [],
        currentPhase: '',
        supervisionHistory: '',
        thresholds: {},
        hasSubGoals: false,
      };

      const result = buildTextPrompt(params);

      expect(result).not.toContain('SUB-GOALS');
    });

    it('should include action format instructions', () => {
      const params = {
        response: 'Test',
        recentActions: [],
        primaryGoal: 'Goal',
        subGoals: [],
        currentPhase: '',
        supervisionHistory: '',
        thresholds: { warn: 2, intervene: 4 },
        hasSubGoals: false,
      };

      const result = buildTextPrompt(params);

      expect(result).toContain('RELEVANT: [YES/NO]');
      expect(result).toContain('SCORE: [0-100]');
      expect(result).toContain('ACTION: [CONTINUE/REMIND/CORRECT/REFOCUS]');
    });
  });

  describe('canUseFastAssessment', () => {
    it('should return false with insufficient history', () => {
      expect(canUseFastAssessment('STEP COMPLETE', [], 0)).toBe(false);
      expect(canUseFastAssessment('STEP COMPLETE', [{}], 0)).toBe(false);
    });

    it('should return false when last assessment not CONTINUE', () => {
      const history = [
        { assessment: { action: 'CONTINUE', score: 80 } },
        { assessment: { action: 'REMIND', score: 60 } },
      ];
      expect(canUseFastAssessment('STEP COMPLETE', history, 0)).toBe(false);
    });

    it('should return false when last score below 75', () => {
      const history = [
        { assessment: { action: 'CONTINUE', score: 80 } },
        { assessment: { action: 'CONTINUE', score: 70 } },
      ];
      expect(canUseFastAssessment('STEP COMPLETE', history, 0)).toBe(false);
    });

    it('should return false with consecutive issues', () => {
      const history = [
        { assessment: { action: 'CONTINUE', score: 80 } },
        { assessment: { action: 'CONTINUE', score: 80 } },
      ];
      expect(canUseFastAssessment('STEP COMPLETE', history, 1)).toBe(false);
    });

    it('should return false without progress indicator', () => {
      const history = [
        { assessment: { action: 'CONTINUE', score: 80 } },
        { assessment: { action: 'CONTINUE', score: 80 } },
      ];
      expect(canUseFastAssessment('Just some text', history, 0)).toBe(false);
    });

    it('should return false with blocker indicator', () => {
      const history = [
        { assessment: { action: 'CONTINUE', score: 80 } },
        { assessment: { action: 'CONTINUE', score: 80 } },
      ];
      expect(canUseFastAssessment('STEP COMPLETE but there was an error', history, 0)).toBe(false);
    });

    it('should return true with all conditions met', () => {
      const history = [
        { assessment: { action: 'CONTINUE', score: 80 } },
        { assessment: { action: 'CONTINUE', score: 80 } },
      ];
      expect(canUseFastAssessment('STEP COMPLETE', history, 0)).toBe(true);
      expect(canUseFastAssessment('successfully implemented feature', history, 0)).toBe(true);
    });
  });

  describe('canUseUltraFastAssessment', () => {
    it('should return false with consecutive issues', () => {
      expect(canUseUltraFastAssessment('Let me read the file and check the content now', 1)).toBe(false);
    });

    it('should return false without tool usage', () => {
      expect(canUseUltraFastAssessment('Just thinking about the problem at hand', 0)).toBe(false);
    });

    it('should return false with error indicators', () => {
      expect(canUseUltraFastAssessment('Read tool error: permission denied occurred', 0)).toBe(false);
    });

    it('should return false for short responses', () => {
      expect(canUseUltraFastAssessment('Read', 0)).toBe(false);
    });

    it('should return true for valid tool usage', () => {
      expect(canUseUltraFastAssessment('Let me read the file to understand the code structure better', 0)).toBe(true);
      expect(canUseUltraFastAssessment("I'll search for all matching patterns in the codebase now", 0)).toBe(true);
    });
  });
});
