/**
 * Tests for AutonomousRunnerCLI (cli-orchestrator.js)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock all dependencies before importing
vi.mock('../claude-code-client.js', () => ({
  ClaudeCodeClient: {
    createWorkerClient: vi.fn(() => ({
      on: vi.fn(),
      hasActiveSession: vi.fn().mockReturnValue(false),
      startSession: vi.fn().mockResolvedValue({ response: 'Started', sessionId: 'test' }),
      continueConversation: vi.fn().mockResolvedValue({ response: 'Working...', sessionId: 'test' }),
      conversationHistory: [],
      options: {},
      getSessionId: vi.fn().mockReturnValue('test-session'),
      getHistory: vi.fn().mockReturnValue([]),
      getMetrics: vi.fn().mockReturnValue({}),
      reset: vi.fn(),
    })),
    createSupervisorClient: vi.fn(() => ({
      on: vi.fn(),
      getMetrics: vi.fn().mockReturnValue({}),
    })),
    createPlannerClient: vi.fn(() => ({
      on: vi.fn(),
      getMetrics: vi.fn().mockReturnValue({}),
    })),
  },
}));

vi.mock('../goal-tracker.js', () => ({
  GoalTracker: vi.fn(() => ({
    primaryGoal: 'Test goal',
    subGoals: [],
    completedMilestones: [],
    updateProgress: vi.fn().mockReturnValue({}),
    getProgressSummary: vi.fn().mockReturnValue({ overallProgress: 50 }),
    isComplete: vi.fn().mockReturnValue(false),
    getProgressCheckPrompt: vi.fn().mockReturnValue('Progress check'),
  })),
}));

vi.mock('../supervisor.js', () => ({
  Supervisor: vi.fn(() => ({
    check: vi.fn().mockResolvedValue({
      assessment: { action: 'CONTINUE', score: 80 },
      needsIntervention: false,
    }),
    reviewPlan: vi.fn().mockResolvedValue({ approved: true }),
    verifyStepCompletion: vi.fn().mockResolvedValue({ verified: true }),
    verifyGoalAchieved: vi.fn().mockResolvedValue({ achieved: true, confidence: 'high' }),
    getStats: vi.fn().mockReturnValue({}),
    consecutiveIssues: 0,
    getMetrics: vi.fn().mockReturnValue({}),
  })),
}));

vi.mock('../phase-manager.js', () => ({
  PhaseManager: vi.fn(() => ({
    start: vi.fn(),
    stop: vi.fn(),
    initializeFromGoals: vi.fn(),
    getTimeStatus: vi.fn().mockReturnValue({ elapsed: '1m', percentTimeUsed: 10, isExpired: false }),
    getTimePrompt: vi.fn().mockReturnValue(null),
    isTimeForProgressCheck: vi.fn().mockReturnValue(false),
    isTimeExpired: vi.fn().mockReturnValue(false),
    getStatusReport: vi.fn().mockReturnValue({ phases: [], checkpoints: [] }),
    formatDuration: vi.fn().mockReturnValue('2h'),
    timeLimit: 7200000,
  })),
}));

vi.mock('../config.js', () => ({
  Config: vi.fn(() => ({
    get: vi.fn().mockReturnValue(null),
    getTimeLimit: vi.fn().mockReturnValue(7200000),
  })),
}));

vi.mock('../completion-verifier.js', () => ({
  CompletionVerifier: vi.fn(() => ({
    verify: vi.fn().mockResolvedValue({ passed: true }),
    generateRejectionPrompt: vi.fn().mockReturnValue('Please continue'),
    getStats: vi.fn().mockReturnValue({}),
  })),
}));

vi.mock('../planner.js', () => ({
  Planner: vi.fn(() => ({
    createPlan: vi.fn().mockResolvedValue({
      steps: [{ number: 1, description: 'Step 1', status: 'pending' }],
      totalSteps: 1,
      analysis: 'Analysis',
    }),
    restorePlan: vi.fn(),
    getCurrentStep: vi.fn().mockReturnValue({ number: 1, description: 'Step 1', complexity: 'simple' }),
    getProgress: vi.fn().mockReturnValue({ current: 1, total: 1, completed: 0, failed: 0, percentComplete: 0 }),
    isComplete: vi.fn().mockReturnValue(false),
    enableParallelMode: vi.fn(),
    advanceStep: vi.fn(),
    failCurrentStep: vi.fn(),
    getSummary: vi.fn().mockReturnValue('Summary'),
    getExecutionStats: vi.fn().mockReturnValue({}),
    plan: { steps: [], totalSteps: 1, analysis: 'Analysis' },
    currentStep: 0,
    getNextExecutableBatch: vi.fn().mockReturnValue([]),
    shouldDecomposeStep: vi.fn().mockReturnValue(false),
    skipStep: vi.fn(),
  })),
}));

vi.mock('../context-manager.js', () => ({
  ContextManager: vi.fn(() => ({
    trackTokenUsage: vi.fn(),
    getCachedAssessment: vi.fn().mockReturnValue(null),
    cacheAssessment: vi.fn(),
    recordDecision: vi.fn(),
    recordMilestone: vi.fn(),
    generateSmartContext: vi.fn().mockReturnValue('Context'),
    compressHistory: vi.fn().mockImplementation(h => h),
    estimateTokens: vi.fn().mockReturnValue(100),
    getCacheStats: vi.fn().mockReturnValue({}),
    getTokenStats: vi.fn().mockReturnValue({}),
    isDuplicateResponse: vi.fn().mockReturnValue(false),
    buildOptimizedWorkerContext: vi.fn().mockReturnValue('Worker context'),
    reset: vi.fn(),
    trimToRecent: vi.fn(),
    options: { tokenBudget: 4000, summaryThreshold: 50 },
  })),
}));

vi.mock('../performance-metrics.js', () => ({
  PerformanceMetrics: vi.fn(() => ({
    startSession: vi.fn(),
    endSession: vi.fn(),
    startIteration: vi.fn(),
    endIteration: vi.fn(),
    recordPlanningTime: vi.fn(),
    recordStepExecution: vi.fn(),
    recordSupervision: vi.fn(),
    recordError: vi.fn(),
    recordParallelExecution: vi.fn(),
    getSummary: vi.fn().mockReturnValue({}),
    getTrends: vi.fn().mockReturnValue({}),
    efficiency: { avgStepTime: 1000 },
    timings: { iterations: [] },
    supervision: { scoreHistory: [] },
  })),
  AdaptiveOptimizer: vi.fn(() => ({
    createExecutionProfile: vi.fn().mockReturnValue({ primaryStrategy: 'sequential' }),
    adjustStrategy: vi.fn().mockReturnValue([]),
    classifyTask: vi.fn().mockReturnValue('general'),
    recordTaskPerformance: vi.fn(),
    recordStrategyEffectiveness: vi.fn(),
  })),
}));

vi.mock('../error-recovery.js', () => ({
  ErrorRecovery: vi.fn(() => ({
    executeWithRetry: vi.fn().mockImplementation(fn => fn()),
    getErrorTrends: vi.fn().mockReturnValue({ lastMinute: 0 }),
  })),
  RecoveryStrategy: {
    SKIP_STEP: 'SKIP_STEP',
    ESCALATE: 'ESCALATE',
    ABORT: 'ABORT',
  },
  ErrorCategory: {},
}));

vi.mock('../state-persistence.js', () => ({
  StatePersistence: vi.fn(() => ({
    initialize: vi.fn().mockResolvedValue(),
    startSession: vi.fn().mockResolvedValue(null),
    getResumableSession: vi.fn().mockResolvedValue(null),
    setPlan: vi.fn().mockResolvedValue(),
    createCheckpoint: vi.fn().mockResolvedValue(),
    updateStepProgress: vi.fn().mockResolvedValue(),
    completeSession: vi.fn().mockResolvedValue(),
    failSession: vi.fn().mockResolvedValue(),
    currentSession: { id: 'test-session' },
  })),
}));

vi.mock('../parallel-executor.js', () => ({
  ParallelStepExecutor: vi.fn(() => ({
    executeBatch: vi.fn().mockResolvedValue([]),
    maxParallel: 3,
  })),
}));

vi.mock('../execution-engine.js', () => ({
  ExecutionEngine: vi.fn(() => ({
    runIteration: vi.fn().mockResolvedValue({
      iteration: 1,
      response: 'Working...',
      sessionId: 'test',
      progress: {},
      planProgress: { current: 1, total: 1 },
      shouldStop: false,
    }),
  })),
}));

// Now import the class
import { AutonomousRunnerCLI } from '../cli-orchestrator.js';

describe('AutonomousRunnerCLI', () => {
  let runner;

  beforeEach(() => {
    vi.clearAllMocks();
    runner = new AutonomousRunnerCLI({
      workingDirectory: '/test',
      verbose: false,
    });
  });

  describe('constructor', () => {
    it('should initialize with default options', () => {
      expect(runner.config).toBeDefined();
      expect(runner.client).toBeDefined();
      expect(runner.contextManager).toBeDefined();
      expect(runner.metrics).toBeDefined();
      expect(runner.errorRecovery).toBeDefined();
      expect(runner.parallelExecutor).toBeDefined();
      expect(runner.executionEngine).toBeDefined();
    });

    it('should initialize execution state', () => {
      expect(runner.iterationCount).toBe(0);
      expect(runner.planCreated).toBe(false);
      expect(runner.isRunning).toBe(false);
      expect(runner.shouldStop).toBe(false);
      expect(runner.recentActions).toEqual([]);
    });

    it('should initialize callbacks to no-ops', () => {
      expect(runner.onProgress).toBeInstanceOf(Function);
      expect(runner.onMessage).toBeInstanceOf(Function);
      expect(runner.onError).toBeInstanceOf(Function);
      expect(runner.onComplete).toBeInstanceOf(Function);
    });

    it('should accept custom callbacks', () => {
      const customProgress = vi.fn();
      const customRunner = new AutonomousRunnerCLI({
        onProgress: customProgress,
      });

      expect(customRunner.onProgress).toBe(customProgress);
    });
  });

  describe('buildSystemContext', () => {
    beforeEach(async () => {
      await runner.initialize({
        primaryGoal: 'Test goal',
        subGoals: ['Sub 1', 'Sub 2'],
        workingDirectory: '/test',
      });
    });

    it('should include primary goal', () => {
      const context = runner.buildSystemContext('Test goal', [], '/test');

      expect(context).toContain('PRIMARY GOAL');
      expect(context).toContain('Test goal');
    });

    it('should include sub-goals when present', () => {
      const context = runner.buildSystemContext('Goal', ['Sub 1', 'Sub 2'], '/test');

      expect(context).toContain('SUB-GOALS');
      expect(context).toContain('Sub 1');
      expect(context).toContain('Sub 2');
    });

    it('should include working directory', () => {
      const context = runner.buildSystemContext('Goal', [], '/my/dir');

      expect(context).toContain('WORKING DIRECTORY');
      expect(context).toContain('/my/dir');
    });

    it('should include autonomous mode rules', () => {
      const context = runner.buildSystemContext('Goal', [], '/test');

      expect(context).toContain('AUTONOMOUS MODE');
      expect(context).toContain('STEP COMPLETE');
      expect(context).toContain('STEP BLOCKED');
      expect(context).toContain('TASK COMPLETE');
    });

    it('should include step context when planner has step', () => {
      runner.planner.getCurrentStep.mockReturnValue({
        number: 2,
        description: 'Current step',
        complexity: 'complex',
      });
      runner.planner.getProgress.mockReturnValue({ current: 2, total: 5 });
      runner.planner.plan = {
        steps: [{ number: 1, description: 'Done', status: 'completed' }],
      };

      const context = runner.buildSystemContext('Goal', [], '/test');

      expect(context).toContain('CURRENT STEP');
      expect(context).toContain('Current step');
      expect(context).toContain('complex');
    });
  });

  describe('initialize', () => {
    it('should initialize goal tracker', async () => {
      await runner.initialize({
        primaryGoal: 'Test goal',
        subGoals: ['Sub 1'],
        workingDirectory: '/test',
      });

      expect(runner.goalTracker).toBeDefined();
      expect(runner.primaryGoal).toBe('Test goal');
      expect(runner.subGoals).toEqual(['Sub 1']);
    });

    it('should initialize supervisor with client', async () => {
      await runner.initialize({
        primaryGoal: 'Test goal',
        workingDirectory: '/test',
      });

      expect(runner.supervisor).toBeDefined();
      expect(runner.supervisorClient).toBeDefined();
    });

    it('should initialize planner', async () => {
      await runner.initialize({
        primaryGoal: 'Test goal',
        workingDirectory: '/test',
      });

      expect(runner.planner).toBeDefined();
      expect(runner.plannerClient).toBeDefined();
    });

    it('should initialize phase manager with time limit', async () => {
      await runner.initialize({
        primaryGoal: 'Test goal',
        timeLimit: '1h',
        workingDirectory: '/test',
      });

      expect(runner.phaseManager).toBeDefined();
    });

    it('should emit initialized progress event', async () => {
      const onProgress = vi.fn();
      runner.onProgress = onProgress;

      await runner.initialize({
        primaryGoal: 'Test goal',
        workingDirectory: '/test',
      });

      expect(onProgress).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'initialized',
          goal: 'Test goal',
        })
      );
    });

    it('should return self for chaining', async () => {
      const result = await runner.initialize({
        primaryGoal: 'Test goal',
        workingDirectory: '/test',
      });

      expect(result).toBe(runner);
    });
  });

  describe('getAdaptiveDelay', () => {
    it('should return shorter delay after success', () => {
      runner.config.get = vi.fn().mockReturnValue({
        minimum: 500,
        afterSuccess: 1000,
        afterError: 3000,
      });

      const delay1 = runner.getAdaptiveDelay(true);
      const delay2 = runner.getAdaptiveDelay(true);

      expect(delay2).toBeLessThanOrEqual(delay1);
    });

    it('should return longer delay after error', () => {
      runner.config.get = vi.fn().mockReturnValue({
        minimum: 500,
        afterSuccess: 1000,
        afterError: 3000,
      });

      const delay1 = runner.getAdaptiveDelay(false);
      const delay2 = runner.getAdaptiveDelay(false);

      expect(delay2).toBeGreaterThanOrEqual(delay1);
    });

    it('should reset consecutive counters on transition', () => {
      runner.config.get = vi.fn().mockReturnValue({});

      runner.getAdaptiveDelay(true);
      runner.getAdaptiveDelay(true);
      expect(runner.consecutiveSuccesses).toBe(2);

      runner.getAdaptiveDelay(false);
      expect(runner.consecutiveSuccesses).toBe(0);
      expect(runner.consecutiveErrors).toBe(1);
    });

    it('should use default delay when adaptive disabled', () => {
      runner.config.get = vi.fn().mockReturnValue({
        adaptive: false,
        default: 2000,
      });

      const delay = runner.getAdaptiveDelay(true);

      expect(delay).toBe(2000);
    });
  });

  describe('stop', () => {
    it('should set shouldStop flag', () => {
      runner.stop();

      expect(runner.shouldStop).toBe(true);
    });
  });

  describe('sleep', () => {
    it('should return a promise that resolves after delay', async () => {
      const start = Date.now();
      await runner.sleep(50);
      const elapsed = Date.now() - start;

      expect(elapsed).toBeGreaterThanOrEqual(40); // Allow some tolerance
    });
  });

  describe('getStuckIterationCount', () => {
    it('should return 0 when no current step', () => {
      runner.planner = { getCurrentStep: vi.fn().mockReturnValue(null) };

      const count = runner.getStuckIterationCount();

      expect(count).toBe(0);
    });

    it('should return recent iteration count', () => {
      runner.planner = { getCurrentStep: vi.fn().mockReturnValue({ number: 1 }) };
      runner.metrics = {
        timings: { iterations: [1, 2, 3, 4, 5] },
      };

      const count = runner.getStuckIterationCount();

      expect(count).toBe(5);
    });
  });

  describe('getAverageSupervisionScore', () => {
    it('should return default when no history', () => {
      runner.metrics = { supervision: { scoreHistory: [] } };

      const score = runner.getAverageSupervisionScore();

      expect(score).toBe(75);
    });

    it('should average recent scores', () => {
      runner.metrics = { supervision: { scoreHistory: [80, 70, 90, 60, 100] } };

      const score = runner.getAverageSupervisionScore();

      expect(score).toBe(80); // (80+70+90+60+100)/5
    });
  });

  describe('generateFinalReport', () => {
    beforeEach(async () => {
      await runner.initialize({
        primaryGoal: 'Test goal',
        workingDirectory: '/test',
      });
    });

    it('should include status', () => {
      runner.planner.isComplete.mockReturnValue(true);

      const report = runner.generateFinalReport();

      expect(report.status).toBe('completed');
    });

    it('should include goal information', () => {
      const report = runner.generateFinalReport();

      expect(report.goal).toBeDefined();
      expect(report.goal.primary).toBe('Test goal');
    });

    it('should include plan information', () => {
      runner.planner.plan = {
        analysis: 'Test analysis',
        steps: [],
        totalSteps: 5,
      };

      const report = runner.generateFinalReport();

      expect(report.plan).toBeDefined();
      expect(report.plan.analysis).toBe('Test analysis');
    });

    it('should include time information', () => {
      const report = runner.generateFinalReport();

      expect(report.time).toBeDefined();
      expect(report.time.elapsed).toBeDefined();
    });

    it('should include session information', () => {
      const report = runner.generateFinalReport();

      expect(report.session).toBeDefined();
      expect(report.session.iterations).toBe(0);
    });

    it('should include verification information', () => {
      runner.verificationFailures = 2;

      const report = runner.generateFinalReport();

      expect(report.verification).toBeDefined();
      expect(report.verification.failures).toBe(2);
    });

    it('should mark status as aborted when abort reason set', () => {
      runner.abortReason = 'Test abort';

      const report = runner.generateFinalReport();

      expect(report.status).toBe('aborted');
      expect(report.abortReason).toBe('Test abort');
    });

    it('should mark status as time_expired when time is up', () => {
      runner.phaseManager.getTimeStatus.mockReturnValue({ isExpired: true });

      const report = runner.generateFinalReport();

      expect(report.status).toBe('time_expired');
    });

    it('should include final verification when provided', () => {
      const finalVerification = {
        goalVerification: { achieved: 'YES', confidence: 'high' },
        overallPassed: true,
      };

      const report = runner.generateFinalReport(finalVerification);

      expect(report.finalVerification).toBeDefined();
      expect(report.finalVerification.goalAchieved).toBe('YES');
      expect(report.finalVerification.overallPassed).toBe(true);
    });
  });

  describe('getClientMetrics', () => {
    it('should return metrics from all clients', () => {
      runner.client = { getMetrics: vi.fn().mockReturnValue({ calls: 5 }) };
      runner.supervisorClient = { getMetrics: vi.fn().mockReturnValue({ calls: 3 }) };
      runner.plannerClient = { getMetrics: vi.fn().mockReturnValue({ calls: 1 }) };

      const metrics = runner.getClientMetrics();

      expect(metrics.worker).toEqual({ calls: 5 });
      expect(metrics.supervisor).toEqual({ calls: 3 });
      expect(metrics.planner).toEqual({ calls: 1 });
    });

    it('should handle missing clients', () => {
      runner.client = { getMetrics: vi.fn().mockReturnValue({}) };
      runner.supervisorClient = null;
      runner.plannerClient = null;

      const metrics = runner.getClientMetrics();

      expect(metrics.supervisor).toBeNull();
      expect(metrics.planner).toBeNull();
    });
  });
});

describe('AutonomousRunnerCLI status determination', () => {
  let runner;

  beforeEach(() => {
    vi.clearAllMocks();
    runner = new AutonomousRunnerCLI({});
  });

  it('should return verification_failed when final verification fails', async () => {
    await runner.initialize({ primaryGoal: 'Test', workingDirectory: '/test' });
    runner.planner.isComplete.mockReturnValue(true);

    const report = runner.generateFinalReport({
      goalVerification: { achieved: 'NO' },
      overallPassed: false,
    });

    expect(report.status).toBe('verification_failed');
  });

  it('should return completed when goal tracker complete', async () => {
    await runner.initialize({ primaryGoal: 'Test', workingDirectory: '/test' });
    runner.goalTracker.isComplete.mockReturnValue(true);

    const report = runner.generateFinalReport();

    expect(report.status).toBe('completed');
  });

  it('should return stopped as fallback', async () => {
    await runner.initialize({ primaryGoal: 'Test', workingDirectory: '/test' });
    runner.planner.isComplete.mockReturnValue(false);
    runner.goalTracker.isComplete.mockReturnValue(false);
    runner.phaseManager.getTimeStatus.mockReturnValue({ isExpired: false });

    const report = runner.generateFinalReport();

    expect(report.status).toBe('stopped');
  });
});
