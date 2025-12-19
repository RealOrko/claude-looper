import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ResponseProcessor } from '../response-processor.js';

function createMockRunner() {
  return {
    iterationCount: 0,
    recentActions: [],
    shouldStop: false,
    finalSummary: null,
    pendingCompletion: null,
    pendingStepCompletion: null,
    pendingSubPlan: null,
    goalTracker: {
      updateProgress: vi.fn(() => ({ progressPercent: 50, milestones: [] })),
      getProgressSummary: vi.fn(() => ({ overallProgress: 50 })),
    },
    planner: {
      getCurrentStep: vi.fn(() => ({ number: 1, description: 'Test step', complexity: 'medium' })),
      isComplete: vi.fn(() => false),
      canAttemptSubPlan: vi.fn(() => true),
      isInSubPlan: vi.fn(() => false),
      failCurrentStep: vi.fn(),
      advanceStep: vi.fn(),
      abortSubPlan: vi.fn(),
      getProgress: vi.fn(() => ({ current: 1, total: 5, completed: 0 })),
    },
    config: { get: vi.fn(() => ({ enabled: true })) },
    contextManager: {
      isDuplicateResponse: vi.fn(() => false),
      recordDecision: vi.fn(),
      compressHistory: vi.fn(history => history.slice(-10)),
      estimateTokens: vi.fn(() => 1000),
      options: { summaryThreshold: 50 },
    },
    supervisor: { consecutiveIssues: 0 },
    client: { conversationHistory: [] },
    onProgress: vi.fn(),
    onMessage: vi.fn(),
  };
}

describe('ResponseProcessor', () => {
  let processor;
  let mockRunner;

  beforeEach(() => {
    mockRunner = createMockRunner();
    processor = new ResponseProcessor(mockRunner);
  });

  describe('process', () => {
    it('should increment iteration count', () => {
      const result = processor.process({ response: 'Test response', sessionId: '123' }, null);
      expect(mockRunner.iterationCount).toBe(1);
    });

    it('should emit message event', () => {
      processor.process({ response: 'Test response', sessionId: '123' }, null);
      expect(mockRunner.onMessage).toHaveBeenCalledWith(expect.objectContaining({
        iteration: 1,
        content: 'Test response',
        sessionId: '123',
      }));
    });

    it('should return structured result', () => {
      mockRunner.goalTracker.getProgressSummary = vi.fn(() => ({ overallProgress: 50 }));
      const result = processor.process({ response: 'Done!', sessionId: '123' }, null);
      expect(result).toHaveProperty('iteration');
      expect(result).toHaveProperty('response');
      expect(result).toHaveProperty('sessionId');
      expect(result).toHaveProperty('progress');
      expect(result).toHaveProperty('shouldStop');
    });
  });

  describe('extractActions', () => {
    it('should extract creation actions', () => {
      const actions = processor.extractActions('I created a new component');
      expect(actions).toContain('I created a new component');
    });

    it('should extract edit actions', () => {
      const actions = processor.extractActions('I edited the file');
      expect(actions.some(a => a.includes('edited'))).toBe(true);
    });

    it('should extract run/execute actions', () => {
      const actions = processor.extractActions('I ran the tests');
      expect(actions.some(a => a.includes('ran'))).toBe(true);
    });

    it('should handle empty response', () => {
      const actions = processor.extractActions('');
      expect(actions).toEqual([]);
    });

    it('should limit actions per pattern to 2', () => {
      const actions = processor.extractActions(
        'I created file1, created file2, created file3, created file4'
      );
      expect(actions.filter(a => a.includes('created')).length).toBeLessThanOrEqual(2);
    });

    it('should extract progress verbs', () => {
      const actions = processor.extractActions('running tests, searching for files');
      expect(actions.length).toBeGreaterThan(0);
    });
  });

  describe('handleStepSignals', () => {
    it('should detect STEP COMPLETE signal', () => {
      processor.handleStepSignals('Done! STEP COMPLETE');
      expect(mockRunner.pendingStepCompletion).not.toBeNull();
      expect(mockRunner.pendingStepCompletion.step.number).toBe(1);
    });

    it('should emit progress event on step complete', () => {
      processor.handleStepSignals('STEP COMPLETE');
      expect(mockRunner.onProgress).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'step_verification_pending' })
      );
    });

    it('should not duplicate pending step completion', () => {
      mockRunner.pendingStepCompletion = { step: { number: 99 } };
      processor.handleStepSignals('STEP COMPLETE');
      expect(mockRunner.pendingStepCompletion.step.number).toBe(99);
    });

    it('should detect STEP BLOCKED signal', () => {
      processor.handleStepSignals('STEP BLOCKED: Missing dependency');
      expect(mockRunner.pendingSubPlan).not.toBeNull();
      expect(mockRunner.pendingSubPlan.reason).toBe('Missing dependency');
    });

    it('should fail step when sub-plan not possible', () => {
      mockRunner.planner.canAttemptSubPlan.mockReturnValue(false);
      processor.handleStepSignals('STEP BLOCKED: Cannot proceed');
      expect(mockRunner.planner.failCurrentStep).toHaveBeenCalled();
      expect(mockRunner.planner.advanceStep).toHaveBeenCalled();
    });
  });

  describe('handleBlockedStep', () => {
    it('should abort sub-plan when in sub-plan', () => {
      mockRunner.planner.isInSubPlan.mockReturnValue(true);
      processor.handleBlockedStep({ number: 1 }, 'Test reason');
      expect(mockRunner.planner.abortSubPlan).toHaveBeenCalledWith('Test reason');
      expect(mockRunner.onProgress).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'subplan_failed' })
      );
    });

    it('should fail and advance when not in sub-plan', () => {
      mockRunner.planner.isInSubPlan.mockReturnValue(false);
      processor.handleBlockedStep({ number: 1 }, 'Test reason');
      expect(mockRunner.planner.failCurrentStep).toHaveBeenCalledWith('Test reason');
      expect(mockRunner.planner.advanceStep).toHaveBeenCalled();
      expect(mockRunner.onProgress).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'step_failed' })
      );
    });

    it('should record decision in context manager', () => {
      mockRunner.planner.isInSubPlan.mockReturnValue(false);
      processor.handleBlockedStep({ number: 5 }, 'Blocked reason');
      expect(mockRunner.contextManager.recordDecision).toHaveBeenCalled();
    });
  });

  describe('handleCompletionSignals', () => {
    it('should detect task complete phrase', () => {
      processor.handleCompletionSignals('All done! task complete', { progressPercent: 50 });
      expect(mockRunner.pendingCompletion).not.toBeNull();
      expect(mockRunner.pendingCompletion.trigger).toBe('completion_phrase');
    });

    it('should detect goal achieved phrase', () => {
      processor.handleCompletionSignals('Goal achieved successfully', { progressPercent: 100 });
      expect(mockRunner.pendingCompletion.trigger).toBe('completion_phrase');
    });

    it('should detect planner completion', () => {
      mockRunner.planner.isComplete.mockReturnValue(true);
      processor.handleCompletionSignals('Done', { progressPercent: 100 });
      expect(mockRunner.pendingCompletion.trigger).toBe('planner_complete');
    });

    it('should detect 100% progress', () => {
      processor.handleCompletionSignals('Still working', { progressPercent: 100 });
      expect(mockRunner.pendingCompletion.trigger).toBe('progress_100');
    });

    it('should stop immediately when verification disabled', () => {
      mockRunner.config.get.mockReturnValue({ enabled: false });
      mockRunner.planner.isComplete.mockReturnValue(true);
      processor.handleCompletionSignals('Done!', { progressPercent: 100 });
      expect(mockRunner.shouldStop).toBe(true);
    });
  });

  describe('handleDuplicateResponses', () => {
    it('should detect duplicates', () => {
      mockRunner.contextManager.isDuplicateResponse.mockReturnValue(true);
      processor.handleDuplicateResponses('Same response');
      expect(mockRunner.onProgress).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'duplicate_response_detected' })
      );
    });

    it('should increase consecutive issues on duplicate', () => {
      mockRunner.contextManager.isDuplicateResponse.mockReturnValue(true);
      mockRunner.config.get.mockReturnValue({ warn: 3 });
      processor.handleDuplicateResponses('Same response');
      expect(mockRunner.supervisor.consecutiveIssues).toBeGreaterThanOrEqual(2);
    });

    it('should not trigger on unique response', () => {
      mockRunner.contextManager.isDuplicateResponse.mockReturnValue(false);
      processor.handleDuplicateResponses('Unique response');
      expect(mockRunner.onProgress).not.toHaveBeenCalled();
    });
  });

  describe('compressHistoryIfNeeded', () => {
    it('should compress when history exceeds threshold', () => {
      mockRunner.client.conversationHistory = Array(60).fill({ role: 'user', content: 'msg' });
      processor.compressHistoryIfNeeded();
      expect(mockRunner.contextManager.compressHistory).toHaveBeenCalled();
      expect(mockRunner.onProgress).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'history_compressed' })
      );
    });

    it('should not compress when below threshold', () => {
      mockRunner.client.conversationHistory = Array(10).fill({ role: 'user', content: 'msg' });
      processor.compressHistoryIfNeeded();
      expect(mockRunner.contextManager.compressHistory).not.toHaveBeenCalled();
    });
  });
});
