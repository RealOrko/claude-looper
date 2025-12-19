/**
 * Tests for ExecutionEngine
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ExecutionEngine } from '../execution-engine.js';

// Mock runner with all required properties
function createMockRunner(overrides = {}) {
  return {
    client: {
      hasActiveSession: vi.fn().mockReturnValue(true),
      startSession: vi.fn().mockResolvedValue({ response: 'Started', sessionId: 'test' }),
      continueConversation: vi.fn().mockResolvedValue({ response: 'Working...', sessionId: 'test' }),
      conversationHistory: [
        { role: 'user', content: 'Start' },
        { role: 'assistant', content: 'Working on it' },
      ],
    },
    planner: {
      getCurrentStep: vi.fn().mockReturnValue({ number: 1, description: 'Test step', complexity: 'simple' }),
      getProgress: vi.fn().mockReturnValue({ current: 1, total: 5, completed: 0, percentComplete: 0 }),
      isComplete: vi.fn().mockReturnValue(false),
      failCurrentStep: vi.fn(),
      advanceStep: vi.fn(),
      canAttemptSubPlan: vi.fn().mockReturnValue(false),
      isInSubPlan: vi.fn().mockReturnValue(false),
      abortSubPlan: vi.fn(),
    },
    supervisor: {
      check: vi.fn().mockResolvedValue({
        assessment: { action: 'CONTINUE', score: 80 },
        needsIntervention: false,
        consecutiveIssues: 0,
      }),
      consecutiveIssues: 0,
    },
    contextManager: {
      trackTokenUsage: vi.fn(),
      getCachedAssessment: vi.fn().mockReturnValue(null),
      cacheAssessment: vi.fn(),
      isDuplicateResponse: vi.fn().mockReturnValue(false),
      recordDecision: vi.fn(),
      generateSmartContext: vi.fn().mockReturnValue('Smart context'),
      compressHistory: vi.fn().mockImplementation(history => history.slice(-5)),
      estimateTokens: vi.fn().mockReturnValue(100),
      options: { tokenBudget: 4000, summaryThreshold: 50 },
    },
    goalTracker: {
      updateProgress: vi.fn().mockReturnValue({ progressPercent: 20 }),
      getProgressCheckPrompt: vi.fn().mockReturnValue('Progress check prompt'),
      getProgressSummary: vi.fn().mockReturnValue({ overallProgress: 50 }),
    },
    phaseManager: {
      getTimePrompt: vi.fn().mockReturnValue(null),
      isTimeForProgressCheck: vi.fn().mockReturnValue(false),
    },
    metrics: {
      recordSupervision: vi.fn(),
    },
    config: {
      get: vi.fn().mockReturnValue(null),
    },
    iterationCount: 0,
    primaryGoal: 'Test goal',
    subGoals: [],
    workingDirectory: '/test',
    initialContext: '',
    recentActions: [],
    pendingStepCompletion: null,
    pendingSubPlan: null,
    pendingCompletion: null,
    shouldStop: false,
    onProgress: vi.fn(),
    onMessage: vi.fn(),
    onSupervision: vi.fn(),
    onEscalation: vi.fn(),
    buildSystemContext: vi.fn().mockReturnValue('System context'),
    ...overrides,
  };
}

describe('ExecutionEngine', () => {
  let engine;
  let mockRunner;

  beforeEach(() => {
    mockRunner = createMockRunner();
    engine = new ExecutionEngine(mockRunner);
  });

  describe('constructor', () => {
    it('should initialize with runner reference', () => {
      expect(engine.runner).toBe(mockRunner);
    });
  });

  describe('runIteration', () => {
    it('should start new session on first iteration', async () => {
      mockRunner.client.hasActiveSession.mockReturnValue(false);
      mockRunner.client.startSession.mockResolvedValue({
        response: 'Started',
        sessionId: 'new-session',
        tokensIn: 100,
        tokensOut: 50,
      });

      const result = await engine.runIteration();

      expect(mockRunner.client.startSession).toHaveBeenCalled();
      expect(mockRunner.buildSystemContext).toHaveBeenCalled();
      expect(result.iteration).toBe(1);
    });

    it('should continue conversation on subsequent iterations', async () => {
      mockRunner.client.hasActiveSession.mockReturnValue(true);

      await engine.runIteration();

      expect(mockRunner.client.continueConversation).toHaveBeenCalled();
    });

    it('should run supervision on subsequent iterations', async () => {
      mockRunner.client.hasActiveSession.mockReturnValue(true);
      mockRunner.client.conversationHistory = [
        { role: 'user', content: 'Start' },
        { role: 'assistant', content: 'Working on it' },
      ];

      await engine.runIteration();

      expect(mockRunner.supervisor.check).toHaveBeenCalled();
    });

    it('should track token usage', async () => {
      mockRunner.client.hasActiveSession.mockReturnValue(false);
      mockRunner.client.startSession.mockResolvedValue({
        response: 'Started',
        tokensIn: 500,
        tokensOut: 200,
      });

      await engine.runIteration();

      expect(mockRunner.contextManager.trackTokenUsage).toHaveBeenCalledWith(500, 200);
    });
  });

  describe('runSupervision', () => {
    it('should use cached assessment when available', async () => {
      const cachedAssessment = { action: 'CONTINUE', score: 85, needsIntervention: false };
      mockRunner.contextManager.getCachedAssessment.mockReturnValue(cachedAssessment);

      const result = await engine.runSupervision({ content: 'Test response' });

      expect(result.cached).toBe(true);
      expect(result.assessment).toBe(cachedAssessment);
      expect(mockRunner.supervisor.check).not.toHaveBeenCalled();
    });

    it('should perform full supervision check when no cache', async () => {
      mockRunner.contextManager.getCachedAssessment.mockReturnValue(null);

      await engine.runSupervision({ content: 'Test response' });

      expect(mockRunner.supervisor.check).toHaveBeenCalled();
    });

    it('should cache CONTINUE results', async () => {
      mockRunner.supervisor.check.mockResolvedValue({
        assessment: { action: 'CONTINUE', score: 80 },
        needsIntervention: false,
      });

      await engine.runSupervision({ content: 'Test response' });

      expect(mockRunner.contextManager.cacheAssessment).toHaveBeenCalled();
    });

    it('should not cache non-CONTINUE results', async () => {
      mockRunner.supervisor.check.mockResolvedValue({
        assessment: { action: 'REDIRECT', score: 50 },
        needsIntervention: true,
      });

      await engine.runSupervision({ content: 'Test response' });

      expect(mockRunner.contextManager.cacheAssessment).not.toHaveBeenCalled();
    });
  });

  describe('handleEscalations', () => {
    it('should handle CRITICAL action', () => {
      const supervisionResult = {
        assessment: { action: 'CRITICAL', score: 20 },
        consecutiveIssues: 5,
      };

      engine.handleEscalations(supervisionResult);

      expect(mockRunner.contextManager.recordDecision).toHaveBeenCalledWith(
        'Critical escalation issued',
        expect.any(String)
      );
      expect(mockRunner.onEscalation).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'critical' })
      );
    });

    it('should handle ABORT action', () => {
      const supervisionResult = {
        assessment: { action: 'ABORT', score: 10 },
        consecutiveIssues: 10,
      };

      engine.handleEscalations(supervisionResult);

      expect(mockRunner.shouldStop).toBe(true);
      expect(mockRunner.abortReason).toBe('Escalation: unable to maintain goal focus');
      expect(mockRunner.onEscalation).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'abort' })
      );
    });
  });

  describe('buildIterationPrompt', () => {
    it('should include supervisor correction when intervention needed', async () => {
      const supervisionResult = {
        needsIntervention: true,
        prompt: 'Please refocus on the goal',
      };

      const prompt = await engine.buildIterationPrompt(supervisionResult);

      expect(prompt).toContain('Please refocus on the goal');
    });

    it('should include time prompt when available', async () => {
      mockRunner.phaseManager.getTimePrompt.mockReturnValue('30 minutes remaining');

      const prompt = await engine.buildIterationPrompt(null);

      expect(prompt).toContain('30 minutes remaining');
    });

    it('should include progress check when time for it', async () => {
      mockRunner.phaseManager.isTimeForProgressCheck.mockReturnValue(true);

      const prompt = await engine.buildIterationPrompt(null);

      expect(mockRunner.goalTracker.getProgressCheckPrompt).toHaveBeenCalled();
      expect(prompt).toContain('Progress check prompt');
    });

    it('should include smart context', async () => {
      const prompt = await engine.buildIterationPrompt(null);

      expect(mockRunner.contextManager.generateSmartContext).toHaveBeenCalled();
      expect(prompt).toContain('Smart context');
    });

    it('should include step prompt when step available', async () => {
      const prompt = await engine.buildIterationPrompt(null);

      expect(prompt).toContain('CURRENT STEP');
      expect(prompt).toContain('Test step');
      expect(prompt).toContain('STEP COMPLETE');
    });

    it('should return default prompt when no content', async () => {
      mockRunner.planner.getCurrentStep.mockReturnValue(null);
      mockRunner.contextManager.generateSmartContext.mockReturnValue(null);

      const prompt = await engine.buildIterationPrompt(null);

      expect(prompt).toBe('Continue. What is your next action?');
    });
  });

  describe('processResponse', () => {
    it('should increment iteration count', () => {
      const result = { response: 'Working...', sessionId: 'test' };

      engine.processResponse(result, null);

      expect(mockRunner.iterationCount).toBe(1);
    });

    it('should detect duplicate responses', () => {
      mockRunner.contextManager.isDuplicateResponse.mockReturnValue(true);
      const result = { response: 'Same response again', sessionId: 'test' };

      engine.processResponse(result, null);

      expect(mockRunner.onProgress).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'duplicate_response_detected' })
      );
    });

    it('should extract actions from response', () => {
      const result = { response: 'I created a new file and ran the tests', sessionId: 'test' };

      engine.processResponse(result, null);

      expect(mockRunner.recentActions.length).toBeGreaterThan(0);
    });

    it('should emit message event', () => {
      const result = { response: 'Test response', sessionId: 'test-session' };

      engine.processResponse(result, null);

      expect(mockRunner.onMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          iteration: 1,
          content: 'Test response',
          sessionId: 'test-session',
        })
      );
    });
  });

  describe('extractActions', () => {
    it('should extract creation actions', () => {
      const actions = engine.responseProcessor.extractActions('I created a new component');

      expect(actions).toContain('I created a new component');
    });

    it('should extract edit actions', () => {
      const actions = engine.responseProcessor.extractActions('I edited the config file');

      expect(actions.some(a => a.includes('edited'))).toBe(true);
    });

    it('should extract multiple action types', () => {
      const actions = engine.responseProcessor.extractActions('I ran the tests and fixed the bug');

      expect(actions.length).toBeGreaterThan(0);
    });

    it('should handle empty response', () => {
      const actions = engine.responseProcessor.extractActions('');

      expect(actions).toEqual([]);
    });

    it('should limit actions per pattern', () => {
      const actions = engine.responseProcessor.extractActions(
        'I created file1, created file2, created file3, created file4'
      );

      // Should limit to 2 per pattern
      expect(actions.filter(a => a.includes('created')).length).toBeLessThanOrEqual(2);
    });
  });

  describe('handleStepSignals', () => {
    it('should set pending step completion on STEP COMPLETE', () => {
      engine.responseProcessor.handleStepSignals('Done! STEP COMPLETE');

      expect(mockRunner.pendingStepCompletion).not.toBeNull();
      expect(mockRunner.pendingStepCompletion.step.number).toBe(1);
    });

    it('should not set pending if already pending', () => {
      mockRunner.pendingStepCompletion = { step: { number: 0 } };

      engine.responseProcessor.handleStepSignals('STEP COMPLETE');

      expect(mockRunner.pendingStepCompletion.step.number).toBe(0); // Unchanged
    });

    it('should handle STEP BLOCKED with sub-plan', () => {
      mockRunner.planner.canAttemptSubPlan.mockReturnValue(true);

      engine.responseProcessor.handleStepSignals('STEP BLOCKED: Missing API key');

      expect(mockRunner.pendingSubPlan).not.toBeNull();
      expect(mockRunner.pendingSubPlan.reason).toBe('Missing API key');
    });

    it('should fail step when sub-plan not possible', () => {
      mockRunner.planner.canAttemptSubPlan.mockReturnValue(false);

      engine.responseProcessor.handleStepSignals('STEP BLOCKED: Missing API key');

      expect(mockRunner.planner.failCurrentStep).toHaveBeenCalledWith('Missing API key');
      expect(mockRunner.planner.advanceStep).toHaveBeenCalled();
    });
  });

  describe('handleCompletionSignals', () => {
    it('should set pending completion on task complete phrase', () => {
      mockRunner.config.get.mockReturnValue({ enabled: true });

      engine.responseProcessor.handleCompletionSignals('All done! task complete', { progressPercent: 80 });

      expect(mockRunner.pendingCompletion).not.toBeNull();
      expect(mockRunner.pendingCompletion.trigger).toBe('completion_phrase');
    });

    it('should set pending completion when planner complete', () => {
      mockRunner.planner.isComplete.mockReturnValue(true);
      mockRunner.config.get.mockReturnValue({ enabled: true });

      engine.responseProcessor.handleCompletionSignals('Done', { progressPercent: 100 });

      expect(mockRunner.pendingCompletion.trigger).toBe('planner_complete');
    });

    it('should set pending completion on 100% progress', () => {
      mockRunner.config.get.mockReturnValue({ enabled: true });

      engine.responseProcessor.handleCompletionSignals('Almost there', { progressPercent: 100 });

      expect(mockRunner.pendingCompletion.trigger).toBe('progress_100');
    });

    it('should stop immediately when verification disabled', () => {
      mockRunner.config.get.mockReturnValue({ enabled: false });
      mockRunner.planner.isComplete.mockReturnValue(true);

      engine.responseProcessor.handleCompletionSignals('Done!', { progressPercent: 100 });

      expect(mockRunner.shouldStop).toBe(true);
      expect(mockRunner.finalSummary).not.toBeNull();
    });
  });

  describe('compressHistoryIfNeeded', () => {
    it('should compress when history exceeds threshold', () => {
      mockRunner.client.conversationHistory = Array(60).fill({ role: 'user', content: 'msg' });

      engine.responseProcessor.compressHistoryIfNeeded();

      expect(mockRunner.contextManager.compressHistory).toHaveBeenCalled();
      expect(mockRunner.onProgress).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'history_compressed' })
      );
    });

    it('should not compress when history below threshold', () => {
      mockRunner.client.conversationHistory = Array(10).fill({ role: 'user', content: 'msg' });

      engine.responseProcessor.compressHistoryIfNeeded();

      expect(mockRunner.contextManager.compressHistory).not.toHaveBeenCalled();
    });
  });

  describe('handleBlockedStep', () => {
    it('should abort sub-plan when in sub-plan', () => {
      mockRunner.planner.isInSubPlan.mockReturnValue(true);
      const step = { number: 1, description: 'Sub-step' };

      engine.responseProcessor.handleBlockedStep(step, 'Test reason');

      expect(mockRunner.planner.abortSubPlan).toHaveBeenCalledWith('Test reason');
      expect(mockRunner.onProgress).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'subplan_failed' })
      );
    });

    it('should fail and advance when not in sub-plan', () => {
      mockRunner.planner.isInSubPlan.mockReturnValue(false);
      const step = { number: 1, description: 'Main step' };

      engine.responseProcessor.handleBlockedStep(step, 'Test reason');

      expect(mockRunner.planner.failCurrentStep).toHaveBeenCalledWith('Test reason');
      expect(mockRunner.planner.advanceStep).toHaveBeenCalled();
      expect(mockRunner.onProgress).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'step_failed' })
      );
    });
  });
});

describe('ExecutionEngine edge cases', () => {
  let engine;
  let mockRunner;

  beforeEach(() => {
    mockRunner = createMockRunner();
    engine = new ExecutionEngine(mockRunner);
  });

  it('should handle null supervision result', async () => {
    const prompt = await engine.buildIterationPrompt(null);

    expect(prompt).toBeDefined();
    expect(prompt.length).toBeGreaterThan(0);
  });

  it('should handle empty conversation history for supervision', async () => {
    mockRunner.client.conversationHistory = [];

    const result = await engine.runIteration();

    expect(result).toBeDefined();
  });

  it('should extract actions case insensitively', () => {
    const actions = engine.responseProcessor.extractActions('I CREATED a file and RAN tests');

    expect(actions.length).toBeGreaterThan(0);
  });

  it('should handle step with missing properties', () => {
    mockRunner.planner.getCurrentStep.mockReturnValue({ number: 1 }); // No description

    engine.responseProcessor.handleStepSignals('STEP COMPLETE');

    expect(mockRunner.pendingStepCompletion).not.toBeNull();
  });
});
