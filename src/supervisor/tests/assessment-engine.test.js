import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AssessmentEngine } from '../assessment-engine.js';

describe('AssessmentEngine', () => {
  let engine;
  let mockClient;
  let mockGoalTracker;
  let mockThresholds;

  beforeEach(() => {
    mockClient = {
      sendPrompt: vi.fn().mockResolvedValue({
        response: 'RELEVANT: YES\nPRODUCTIVE: YES\nPROGRESSING: YES\nSCORE: 85\nACTION: CONTINUE\nREASON: Good progress',
      }),
    };
    mockGoalTracker = {
      primaryGoal: 'Build a test application',
      subGoals: [],
      currentPhase: 0,
    };
    mockThresholds = {
      warn: 2,
      intervene: 4,
      critical: 6,
      abort: 8,
    };
    engine = new AssessmentEngine(mockClient);
  });

  describe('constructor', () => {
    it('should use default options', () => {
      expect(engine.useStructuredOutput).toBe(true);
      expect(engine.readOnlyTools).toBe(true);
      expect(engine.maxResponseLength).toBe(5000);
      expect(engine.skipForSimpleSteps).toBe(false);
    });

    it('should accept custom options', () => {
      const custom = new AssessmentEngine(mockClient, {
        useStructuredOutput: false,
        readOnlyTools: false,
        maxResponseLength: 1000,
        skipForSimpleSteps: true,
      });

      expect(custom.useStructuredOutput).toBe(false);
      expect(custom.readOnlyTools).toBe(false);
      expect(custom.maxResponseLength).toBe(1000);
      expect(custom.skipForSimpleSteps).toBe(true);
    });

    it('should initialize empty assessment history', () => {
      expect(engine.assessmentHistory).toEqual([]);
      expect(engine.consecutiveIssues).toBe(0);
    });
  });

  describe('buildSupervisionHistory', () => {
    it('should return message for no assessments', () => {
      const result = engine.buildSupervisionHistory(mockThresholds);
      expect(result).toBe('No previous assessments.');
    });

    it('should format recent assessments', () => {
      engine.assessmentHistory = [
        { assessment: { action: 'CONTINUE', score: 85, reason: 'Good work' } },
        { assessment: { action: 'REMIND', score: 60, reason: 'Stay focused' } },
      ];

      const result = engine.buildSupervisionHistory(mockThresholds);

      expect(result).toContain('[CONTINUE] Score: 85/100');
      expect(result).toContain('[REMIND] Score: 60/100');
    });

    it('should only include last 3 assessments', () => {
      engine.assessmentHistory = [
        { assessment: { action: 'CONTINUE', score: 90 } },
        { assessment: { action: 'CONTINUE', score: 85 } },
        { assessment: { action: 'CONTINUE', score: 80 } },
        { assessment: { action: 'REMIND', score: 60 } },
      ];

      const result = engine.buildSupervisionHistory(mockThresholds);

      expect(result).not.toContain('Score: 90');
      expect(result).toContain('Score: 85');
      expect(result).toContain('Score: 80');
      expect(result).toContain('Score: 60');
    });

    it('should add warning for warn threshold', () => {
      engine.consecutiveIssues = 2;
      engine.assessmentHistory = [{ assessment: { action: 'CORRECT', score: 40 } }];

      const result = engine.buildSupervisionHistory(mockThresholds);

      expect(result).toContain('⚠️ ALERT');
    });

    it('should add warning for intervene threshold', () => {
      engine.consecutiveIssues = 4;
      engine.assessmentHistory = [{ assessment: { action: 'CORRECT', score: 40 } }];

      const result = engine.buildSupervisionHistory(mockThresholds);

      expect(result).toContain('⚠️ WARNING');
      expect(result).toContain('escalation imminent');
    });

    it('should add warning for critical threshold', () => {
      engine.consecutiveIssues = 6;
      engine.assessmentHistory = [{ assessment: { action: 'CORRECT', score: 40 } }];

      const result = engine.buildSupervisionHistory(mockThresholds);

      expect(result).toContain('⚠️ CRITICAL');
      expect(result).toContain('session termination');
    });
  });

  describe('buildAssessmentPrompt', () => {
    it('should build structured output prompt', () => {
      const prompt = engine.buildAssessmentPrompt('Response text', ['action1'], mockGoalTracker, mockThresholds);

      expect(prompt).toContain('SUPERVISOR: Evaluate AI assistant progress');
      expect(prompt).toContain('Build a test application');
      expect(prompt).toContain('Response text');
      expect(prompt).toContain('action1');
    });

    it('should build text format prompt when structured output disabled', () => {
      engine.useStructuredOutput = false;

      const prompt = engine.buildAssessmentPrompt('Response', [], mockGoalTracker, mockThresholds);

      expect(prompt).toContain('You are a SUPERVISOR');
      expect(prompt).toContain('RELEVANT: [YES/NO]');
      expect(prompt).toContain('SCORING GUIDE');
    });

    it('should truncate long responses', () => {
      engine.maxResponseLength = 50;
      const longResponse = 'A'.repeat(100);

      const prompt = engine.buildAssessmentPrompt(longResponse, [], mockGoalTracker, mockThresholds);

      expect(prompt).toContain('A'.repeat(50));
      expect(prompt).not.toContain('A'.repeat(51));
    });

    it('should include current phase when subgoals exist', () => {
      mockGoalTracker.subGoals = [
        { description: 'Phase 1', status: 'in_progress' },
        { description: 'Phase 2', status: 'pending' },
      ];

      const prompt = engine.buildAssessmentPrompt('Response', [], mockGoalTracker, mockThresholds);

      expect(prompt).toContain('Phase 1');
    });

    it('should show no recent actions when empty', () => {
      const prompt = engine.buildAssessmentPrompt('Response', [], mockGoalTracker, mockThresholds);

      expect(prompt).toContain('None');
    });
  });

  describe('getCurrentPhase', () => {
    it('should return primary goal when no subgoals', () => {
      const result = engine.getCurrentPhase(mockGoalTracker);
      expect(result).toBe('Build a test application');
    });

    it('should return current subgoal description', () => {
      mockGoalTracker.subGoals = [
        { description: 'Setup' },
        { description: 'Build' },
      ];
      mockGoalTracker.currentPhase = 1;

      const result = engine.getCurrentPhase(mockGoalTracker);

      expect(result).toBe('Build');
    });
  });

  describe('canUseFastAssessment', () => {
    it('should return false with less than 2 assessments', () => {
      engine.assessmentHistory = [{ assessment: { action: 'CONTINUE', score: 80 } }];
      expect(engine.canUseFastAssessment('STEP COMPLETE')).toBe(false);
    });

    it('should return false when last assessment not CONTINUE', () => {
      engine.assessmentHistory = [
        { assessment: { action: 'CONTINUE', score: 80 } },
        { assessment: { action: 'REMIND', score: 60 } },
      ];
      expect(engine.canUseFastAssessment('STEP COMPLETE')).toBe(false);
    });

    it('should return false when last score below 75', () => {
      engine.assessmentHistory = [
        { assessment: { action: 'CONTINUE', score: 80 } },
        { assessment: { action: 'CONTINUE', score: 70 } },
      ];
      expect(engine.canUseFastAssessment('STEP COMPLETE')).toBe(false);
    });

    it('should return false when consecutive issues > 0', () => {
      engine.assessmentHistory = [
        { assessment: { action: 'CONTINUE', score: 80 } },
        { assessment: { action: 'CONTINUE', score: 80 } },
      ];
      engine.consecutiveIssues = 1;
      expect(engine.canUseFastAssessment('STEP COMPLETE')).toBe(false);
    });

    it('should return false without progress indicator', () => {
      engine.assessmentHistory = [
        { assessment: { action: 'CONTINUE', score: 80 } },
        { assessment: { action: 'CONTINUE', score: 80 } },
      ];
      expect(engine.canUseFastAssessment('Just some text')).toBe(false);
    });

    it('should return false with blocker indicator', () => {
      engine.assessmentHistory = [
        { assessment: { action: 'CONTINUE', score: 80 } },
        { assessment: { action: 'CONTINUE', score: 80 } },
      ];
      expect(engine.canUseFastAssessment('STEP COMPLETE but there was an error')).toBe(false);
    });

    it('should return true with all conditions met', () => {
      engine.assessmentHistory = [
        { assessment: { action: 'CONTINUE', score: 80 } },
        { assessment: { action: 'CONTINUE', score: 80 } },
      ];
      expect(engine.canUseFastAssessment('STEP COMPLETE - all tests pass')).toBe(true);
    });

    it('should detect various progress indicators', () => {
      engine.assessmentHistory = [
        { assessment: { action: 'CONTINUE', score: 80 } },
        { assessment: { action: 'CONTINUE', score: 80 } },
      ];

      expect(engine.canUseFastAssessment('Successfully created the file')).toBe(true);
      expect(engine.canUseFastAssessment('Completed the implementation')).toBe(true);
      expect(engine.canUseFastAssessment('✓ All done')).toBe(true);
    });
  });

  describe('canUseUltraFastAssessment', () => {
    it('should return false with consecutive issues', () => {
      engine.consecutiveIssues = 1;
      expect(engine.canUseUltraFastAssessment('Read tool executed')).toBe(false);
    });

    it('should return false without tool usage', () => {
      expect(engine.canUseUltraFastAssessment('Just thinking about it')).toBe(false);
    });

    it('should return false with error indicators', () => {
      expect(engine.canUseUltraFastAssessment('Read tool error: permission denied')).toBe(false);
    });

    it('should return false for short responses', () => {
      expect(engine.canUseUltraFastAssessment('Read')).toBe(false);
    });

    it('should return true for valid tool usage', () => {
      expect(engine.canUseUltraFastAssessment('Let me read the file to understand the structure and find what we need')).toBe(true);
      expect(engine.canUseUltraFastAssessment("I'll search for the pattern in the codebase to find all matches and understand usage")).toBe(true);
      expect(engine.canUseUltraFastAssessment('Found 5 files matching the pattern, now analyzing each one for relevant code')).toBe(true);
    });
  });

  describe('assess', () => {
    it('should skip assessment for simple complexity steps', async () => {
      engine.skipForSimpleSteps = true;

      const result = await engine.assess('response', [], { complexity: 'simple' });

      expect(result.skipped).toBe(true);
      expect(result.score).toBe(80);
      expect(mockClient.sendPrompt).not.toHaveBeenCalled();
    });

    it('should use ultra-fast assessment when applicable', async () => {
      const result = await engine.assess('Let me read the file to check the implementation and understand the code structure properly', [], {
        goalTracker: mockGoalTracker,
        thresholds: mockThresholds,
      });

      expect(result.ultraFastPath).toBe(true);
      expect(result.score).toBe(90);
      expect(mockClient.sendPrompt).not.toHaveBeenCalled();
    });

    it('should use fast assessment when applicable', async () => {
      engine.assessmentHistory = [
        { assessment: { action: 'CONTINUE', score: 80 } },
        { assessment: { action: 'CONTINUE', score: 80 } },
      ];

      const result = await engine.assess('STEP COMPLETE', [], {
        goalTracker: mockGoalTracker,
        thresholds: mockThresholds,
      });

      expect(result.fastPath).toBe(true);
      expect(result.score).toBe(85);
      expect(mockClient.sendPrompt).not.toHaveBeenCalled();
    });

    it('should call LLM for full assessment', async () => {
      mockClient.sendPrompt.mockResolvedValue({
        structuredOutput: {
          relevant: true,
          productive: true,
          progressing: true,
          score: 75,
          action: 'CONTINUE',
          reason: 'Good progress',
        },
      });

      const result = await engine.assess('Some complex response', [], {
        goalTracker: mockGoalTracker,
        thresholds: mockThresholds,
      });

      expect(mockClient.sendPrompt).toHaveBeenCalled();
      expect(result.score).toBe(75);
    });

    it('should use JSON schema when structured output enabled', async () => {
      mockClient.sendPrompt.mockResolvedValue({ structuredOutput: { score: 80, action: 'CONTINUE' } });

      await engine.assess('response', [], {
        goalTracker: mockGoalTracker,
        thresholds: mockThresholds,
      });

      expect(mockClient.sendPrompt).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ jsonSchema: expect.any(Object) })
      );
    });

    it('should disallow write tools when readOnlyTools enabled', async () => {
      mockClient.sendPrompt.mockResolvedValue({ response: 'SCORE: 80\nACTION: CONTINUE' });

      await engine.assess('response', [], {
        goalTracker: mockGoalTracker,
        thresholds: mockThresholds,
      });

      expect(mockClient.sendPrompt).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          disallowedTools: ['Edit', 'Write', 'Bash', 'NotebookEdit'],
        })
      );
    });

    it('should handle assessment errors gracefully', async () => {
      mockClient.sendPrompt.mockRejectedValue(new Error('Network error'));

      const result = await engine.assess('response', [], {
        goalTracker: mockGoalTracker,
        thresholds: mockThresholds,
      });

      expect(result.action).toBe('CONTINUE');
      expect(result.error).toBe('Network error');
    });

    it('should record assessment in history', async () => {
      mockClient.sendPrompt.mockResolvedValue({
        structuredOutput: { score: 85, action: 'CONTINUE', reason: 'Good' },
      });

      await engine.assess('response', [], {
        goalTracker: mockGoalTracker,
        thresholds: mockThresholds,
      });

      expect(engine.assessmentHistory.length).toBe(1);
      expect(engine.assessmentHistory[0].assessment.score).toBe(85);
    });
  });

  describe('recordAssessment', () => {
    it('should add assessment to history', () => {
      engine.recordAssessment({ action: 'CONTINUE', score: 80 }, 'response text', true);

      expect(engine.assessmentHistory.length).toBe(1);
      expect(engine.assessmentHistory[0].usedStructuredOutput).toBe(true);
    });

    it('should store response snippet', () => {
      const longResponse = 'A'.repeat(200);
      engine.recordAssessment({ action: 'CONTINUE' }, longResponse, false);

      expect(engine.assessmentHistory[0].responseSnippet.length).toBe(100);
    });

    it('should reset consecutive issues on CONTINUE', () => {
      engine.consecutiveIssues = 3;
      engine.recordAssessment({ action: 'CONTINUE' }, 'response', false);

      expect(engine.consecutiveIssues).toBe(0);
    });

    it('should increment consecutive issues on non-CONTINUE', () => {
      engine.recordAssessment({ action: 'REMIND' }, 'response', false);
      expect(engine.consecutiveIssues).toBe(1);

      engine.recordAssessment({ action: 'CORRECT' }, 'response', false);
      expect(engine.consecutiveIssues).toBe(2);
    });

    it('should update lastRelevantAction on CONTINUE', () => {
      const before = engine.lastRelevantAction;
      engine.recordAssessment({ action: 'CONTINUE' }, 'response', false);

      expect(engine.lastRelevantAction).toBeGreaterThanOrEqual(before);
    });

    it('should trim history to max size', () => {
      for (let i = 0; i < 60; i++) {
        engine.recordAssessment({ action: 'CONTINUE', score: i }, 'response', false);
      }

      expect(engine.assessmentHistory.length).toBeLessThanOrEqual(50);
    });
  });

  describe('getAverageScore', () => {
    it('should return null for empty history', () => {
      expect(engine.getAverageScore()).toBeNull();
    });

    it('should calculate average score', () => {
      engine.assessmentHistory = [
        { assessment: { score: 80 } },
        { assessment: { score: 90 } },
        { assessment: { score: 70 } },
      ];

      expect(engine.getAverageScore()).toBe(80);
    });

    it('should round to nearest integer', () => {
      engine.assessmentHistory = [
        { assessment: { score: 80 } },
        { assessment: { score: 85 } },
      ];

      expect(engine.getAverageScore()).toBe(83);
    });
  });

  describe('getHistory', () => {
    it('should return assessment history', () => {
      engine.assessmentHistory = [{ test: true }];
      expect(engine.getHistory()).toEqual([{ test: true }]);
    });
  });

  describe('reset', () => {
    it('should reset all state', () => {
      engine.assessmentHistory = [{ test: true }];
      engine.consecutiveIssues = 5;
      engine.lastRelevantAction = 0;

      engine.reset();

      expect(engine.assessmentHistory).toEqual([]);
      expect(engine.consecutiveIssues).toBe(0);
      expect(engine.lastRelevantAction).toBeGreaterThan(0);
    });
  });
});
