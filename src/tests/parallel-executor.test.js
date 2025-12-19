/**
 * Tests for ParallelStepExecutor
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ParallelStepExecutor } from '../parallel-executor.js';

// Mock runner with all required properties
function createMockRunner(overrides = {}) {
  return {
    client: {
      hasActiveSession: vi.fn().mockReturnValue(true),
      startSession: vi.fn().mockResolvedValue({ response: 'Started', sessionId: 'test' }),
      continueConversation: vi.fn().mockResolvedValue({ response: 'STEP COMPLETE', sessionId: 'test' }),
      conversationHistory: [],
    },
    planner: {
      markStepInProgress: vi.fn(),
      completeStepByNumber: vi.fn(),
      failStepByNumber: vi.fn(),
    },
    contextManager: {
      trackTokenUsage: vi.fn(),
      buildOptimizedWorkerContext: vi.fn().mockReturnValue('Optimized context'),
    },
    metrics: {
      recordStepExecution: vi.fn(),
    },
    goalTracker: {},
    primaryGoal: 'Test goal',
    subGoals: [],
    workingDirectory: '/test',
    onProgress: vi.fn(),
    buildSystemContext: vi.fn().mockReturnValue('System context'),
    ...overrides,
  };
}

function createMockStep(number, description = 'Test step', complexity = 'simple') {
  return { number, description, complexity };
}

describe('ParallelStepExecutor', () => {
  let executor;
  let mockRunner;

  beforeEach(() => {
    mockRunner = createMockRunner();
    executor = new ParallelStepExecutor(mockRunner);
  });

  describe('constructor', () => {
    it('should initialize with runner and maxParallel', () => {
      expect(executor.runner).toBe(mockRunner);
      expect(executor.maxParallel).toBe(3);
    });
  });

  describe('executeBatch', () => {
    it('should return empty array for empty steps', async () => {
      const results = await executor.executeBatch([], [mockRunner.client]);
      expect(results).toEqual([]);
    });

    it('should return empty array for null steps', async () => {
      const results = await executor.executeBatch(null, [mockRunner.client]);
      expect(results).toEqual([]);
    });

    it('should execute single step without parallel optimization', async () => {
      const step = createMockStep(1);
      const results = await executor.executeBatch([step], [mockRunner.client]);

      expect(results).toHaveLength(1);
      expect(results[0].step).toBe(step);
      expect(results[0].success).toBe(true);
    });

    it('should execute multiple steps in parallel', async () => {
      const steps = [createMockStep(1), createMockStep(2), createMockStep(3)];
      const clients = [mockRunner.client, mockRunner.client, mockRunner.client];

      const results = await executor.executeBatch(steps, clients);

      expect(results).toHaveLength(3);
      expect(mockRunner.onProgress).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'parallel_batch_started' })
      );
      expect(mockRunner.onProgress).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'parallel_batch_completed' })
      );
    });

    it('should limit batch size to maxParallel', async () => {
      executor.maxParallel = 2;
      const steps = [createMockStep(1), createMockStep(2), createMockStep(3), createMockStep(4)];
      const clients = [mockRunner.client, mockRunner.client];

      const results = await executor.executeBatch(steps, clients);

      // Should only execute 2 steps (limited by maxParallel)
      expect(results).toHaveLength(2);
    });

    it('should limit batch size to available clients', async () => {
      const steps = [createMockStep(1), createMockStep(2), createMockStep(3)];
      const clients = [mockRunner.client]; // Only 1 client

      const results = await executor.executeBatch(steps, clients);

      expect(results).toHaveLength(1);
    });

    it('should mark all batch steps as in progress', async () => {
      const steps = [createMockStep(1), createMockStep(2)];
      const clients = [mockRunner.client, mockRunner.client];

      await executor.executeBatch(steps, clients);

      expect(mockRunner.planner.markStepInProgress).toHaveBeenCalledWith(1);
      expect(mockRunner.planner.markStepInProgress).toHaveBeenCalledWith(2);
    });

    it('should handle errors in parallel execution gracefully', async () => {
      const steps = [createMockStep(1), createMockStep(2)];
      const failingClient = {
        ...mockRunner.client,
        continueConversation: vi.fn().mockRejectedValue(new Error('Client error')),
      };
      const clients = [mockRunner.client, failingClient];

      const results = await executor.executeBatch(steps, clients);

      expect(results).toHaveLength(2);
      // First should succeed
      expect(results[0].success).toBe(true);
      // Second should fail gracefully
      expect(results[1].success).toBe(false);
      expect(results[1].error).toBe('Client error');
    });
  });

  describe('executeStepWithClient', () => {
    it('should execute step successfully and detect completion', async () => {
      const step = createMockStep(1);
      mockRunner.client.continueConversation.mockResolvedValue({
        response: 'Done! STEP COMPLETE',
        sessionId: 'test',
        tokensIn: 100,
        tokensOut: 50,
      });

      const result = await executor.executeStepWithClient(step, mockRunner.client);

      expect(result.success).toBe(true);
      expect(result.step).toBe(step);
      expect(result.duration).toBeGreaterThanOrEqual(0);
      expect(mockRunner.planner.completeStepByNumber).toHaveBeenCalledWith(1);
      expect(mockRunner.metrics.recordStepExecution).toHaveBeenCalledWith(
        1, 'completed', expect.any(Number), expect.objectContaining({ parallel: true })
      );
    });

    it('should detect blocked step', async () => {
      const step = createMockStep(1);
      mockRunner.client.continueConversation.mockResolvedValue({
        response: 'STEP BLOCKED: Missing dependencies',
        sessionId: 'test',
      });

      const result = await executor.executeStepWithClient(step, mockRunner.client);

      expect(result.success).toBe(false);
      expect(result.blocked).toBe(true);
      expect(result.reason).toBe('Missing dependencies');
      expect(mockRunner.planner.failStepByNumber).toHaveBeenCalledWith(1, 'Missing dependencies');
    });

    it('should handle unclear response (no completion signal)', async () => {
      const step = createMockStep(1);
      mockRunner.client.continueConversation.mockResolvedValue({
        response: 'Working on it...',
        sessionId: 'test',
      });

      const result = await executor.executeStepWithClient(step, mockRunner.client);

      expect(result.success).toBe(false);
      expect(result.unclear).toBe(true);
    });

    it('should start new session if client has no active session', async () => {
      const step = createMockStep(1);
      mockRunner.client.hasActiveSession.mockReturnValue(false);
      mockRunner.client.startSession.mockResolvedValue({
        response: 'Started and STEP COMPLETE',
        sessionId: 'new-session',
      });

      await executor.executeStepWithClient(step, mockRunner.client);

      expect(mockRunner.client.startSession).toHaveBeenCalled();
      expect(mockRunner.buildSystemContext).toHaveBeenCalled();
    });

    it('should track token usage when available', async () => {
      const step = createMockStep(1);
      mockRunner.client.continueConversation.mockResolvedValue({
        response: 'STEP COMPLETE',
        tokensIn: 500,
        tokensOut: 200,
      });

      await executor.executeStepWithClient(step, mockRunner.client);

      expect(mockRunner.contextManager.trackTokenUsage).toHaveBeenCalledWith(500, 200);
    });

    it('should handle execution errors', async () => {
      const step = createMockStep(1);
      mockRunner.client.continueConversation.mockRejectedValue(new Error('Network error'));

      const result = await executor.executeStepWithClient(step, mockRunner.client);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Network error');
      expect(mockRunner.planner.failStepByNumber).toHaveBeenCalledWith(1, 'Network error');
    });

    it('should detect completion with step number in signal', async () => {
      const step = createMockStep(1);
      mockRunner.client.continueConversation.mockResolvedValue({
        response: 'STEP 1 COMPLETE',
        sessionId: 'test',
      });

      const result = await executor.executeStepWithClient(step, mockRunner.client);

      expect(result.success).toBe(true);
    });
  });

  describe('buildStepPrompt', () => {
    it('should build prompt with optimized context', () => {
      const step = createMockStep(1, 'Test step', 'complex');

      const prompt = executor.buildStepPrompt(step);

      expect(mockRunner.contextManager.buildOptimizedWorkerContext).toHaveBeenCalled();
      expect(prompt).toContain('Execute Step 1: Test step');
      expect(prompt).toContain('Complexity: complex');
      expect(prompt).toContain('STEP COMPLETE');
      expect(prompt).toContain('STEP BLOCKED');
    });

    it('should limit context length for parallel workers', () => {
      const step = createMockStep(1);

      executor.buildStepPrompt(step);

      expect(mockRunner.contextManager.buildOptimizedWorkerContext).toHaveBeenCalledWith(
        expect.objectContaining({ maxLength: 3000 })
      );
    });

    it('should include recent history only', () => {
      mockRunner.client.conversationHistory = Array(20).fill({ role: 'user', content: 'msg' });
      const step = createMockStep(1);

      executor.buildStepPrompt(step);

      const callArgs = mockRunner.contextManager.buildOptimizedWorkerContext.mock.calls[0][0];
      expect(callArgs.recentHistory).toHaveLength(10);
    });
  });
});

describe('ParallelStepExecutor edge cases', () => {
  let executor;
  let mockRunner;

  beforeEach(() => {
    mockRunner = createMockRunner();
    executor = new ParallelStepExecutor(mockRunner);
  });

  it('should handle step with no complexity', async () => {
    const step = { number: 1, description: 'No complexity step' };
    mockRunner.client.continueConversation.mockResolvedValue({
      response: 'STEP COMPLETE',
      sessionId: 'test',
    });

    const result = await executor.executeStepWithClient(step, mockRunner.client);

    expect(result.success).toBe(true);
  });

  it('should handle blocked step with no reason', async () => {
    const step = createMockStep(1);
    mockRunner.client.continueConversation.mockResolvedValue({
      response: 'STEP BLOCKED: ',
      sessionId: 'test',
    });

    const result = await executor.executeStepWithClient(step, mockRunner.client);

    expect(result.blocked).toBe(true);
    // Empty reason after colon gets trimmed to empty string, which is falsy, so 'Unknown' is used
    expect(result.reason).toBe('Unknown');
  });

  it('should report batch progress with correct structure', async () => {
    const steps = [createMockStep(1, 'Step 1'), createMockStep(2, 'Step 2')];
    const clients = [mockRunner.client, mockRunner.client];

    await executor.executeBatch(steps, clients);

    expect(mockRunner.onProgress).toHaveBeenCalledWith({
      type: 'parallel_batch_started',
      steps: [
        { number: 1, description: 'Step 1' },
        { number: 2, description: 'Step 2' },
      ],
      count: 2,
    });
  });
});
