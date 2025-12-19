import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CLIInitializer } from '../cli-initializer.js';
import { Config } from '../config.js';

// Mock all dependencies
vi.mock('../claude-code-client.js', () => ({
  ClaudeCodeClient: {
    createWorkerClient: vi.fn(() => ({
      on: vi.fn(),
      options: {},
    })),
    createSupervisorClient: vi.fn(() => ({})),
    createPlannerClient: vi.fn(() => ({})),
  },
}));

vi.mock('../goal-tracker.js', () => ({ GoalTracker: vi.fn() }));
vi.mock('../supervisor.js', () => ({ Supervisor: vi.fn() }));
vi.mock('../phase-manager.js', () => ({
  PhaseManager: vi.fn(() => ({ initializeFromGoals: vi.fn() })),
}));
vi.mock('../completion-verifier.js', () => ({ CompletionVerifier: vi.fn() }));
vi.mock('../planner.js', () => ({ Planner: vi.fn() }));
vi.mock('../context-manager.js', () => ({ ContextManager: vi.fn() }));
vi.mock('../performance-metrics.js', () => ({
  PerformanceMetrics: vi.fn(),
  AdaptiveOptimizer: vi.fn(),
}));
vi.mock('../error-recovery.js', () => ({ ErrorRecovery: vi.fn() }));
vi.mock('../state-persistence.js', () => ({
  StatePersistence: vi.fn(() => ({
    initialize: vi.fn(),
    startSession: vi.fn(),
    getResumableSession: vi.fn(),
  })),
}));
vi.mock('../parallel-executor.js', () => ({ ParallelStepExecutor: vi.fn() }));
vi.mock('../execution-engine.js', () => ({ ExecutionEngine: vi.fn() }));
vi.mock('../verification-handler.js', () => ({ VerificationHandler: vi.fn() }));
vi.mock('../plan-manager.js', () => ({ PlanManager: vi.fn() }));
vi.mock('../iteration-handler.js', () => ({ IterationHandler: vi.fn() }));
vi.mock('../report-generator.js', () => ({ ReportGenerator: vi.fn() }));
vi.mock('../system-context-builder.js', () => ({ SystemContextBuilder: vi.fn() }));
vi.mock('../main-loop.js', () => ({ MainLoop: vi.fn() }));

describe('CLIInitializer', () => {
  let runner;

  beforeEach(() => {
    runner = {
      config: new Config(),
      onProgress: vi.fn(),
    };
  });

  describe('initializeClients', () => {
    it('should initialize all client instances', () => {
      const options = { workingDirectory: '/test', verbose: true };
      CLIInitializer.initializeClients(runner, options);

      expect(runner.client).toBeDefined();
      expect(runner.contextManager).toBeDefined();
      expect(runner.metrics).toBeDefined();
      expect(runner.errorRecovery).toBeDefined();
      expect(runner.statePersistence).toBeDefined();
      expect(runner.adaptiveOptimizer).toBeDefined();
      expect(runner.parallelExecutor).toBeDefined();
      expect(runner.executionEngine).toBeDefined();
      expect(runner.verificationHandler).toBeDefined();
      expect(runner.planManager).toBeDefined();
      expect(runner.iterationHandler).toBeDefined();
      expect(runner.reportGenerator).toBeDefined();
      expect(runner.systemContextBuilder).toBeDefined();
      expect(runner.mainLoop).toBeDefined();
      expect(runner.parallelWorkerClients).toEqual([]);
    });

    it('should respect enablePersistence option', () => {
      CLIInitializer.initializeClients(runner, { enablePersistence: false });
      expect(runner.enablePersistence).toBe(false);

      CLIInitializer.initializeClients(runner, { enablePersistence: true });
      expect(runner.enablePersistence).toBe(true);
    });

    it('should set resumeSessionId from options', () => {
      CLIInitializer.initializeClients(runner, { resumeSessionId: 'test-id' });
      expect(runner.resumeSessionId).toBe('test-id');
    });

    it('should use default values when options not provided', () => {
      CLIInitializer.initializeClients(runner, {});
      expect(runner.enablePersistence).toBe(true);
      expect(runner.resumeSessionId).toBe(null);
    });
  });

  describe('initializeState', () => {
    it('should initialize all state variables to default values', () => {
      CLIInitializer.initializeState(runner);

      expect(runner.goalTracker).toBeNull();
      expect(runner.supervisor).toBeNull();
      expect(runner.phaseManager).toBeNull();
      expect(runner.verifier).toBeNull();
      expect(runner.planner).toBeNull();
      expect(runner.currentExecutionProfile).toBeNull();
      expect(runner.iterationCount).toBe(0);
      expect(runner.planCreated).toBe(false);
      expect(runner.lastProgressCheck).toBeTypeOf('number');
      expect(runner.isRunning).toBe(false);
      expect(runner.shouldStop).toBe(false);
      expect(runner.finalSummary).toBeNull();
      expect(runner.recentActions).toEqual([]);
      expect(runner.pendingCompletion).toBeNull();
      expect(runner.verificationFailures).toBe(0);
      expect(runner.pendingStepCompletion).toBeNull();
      expect(runner.stepVerificationFailures).toBe(0);
      expect(runner.pendingSubPlan).toBeNull();
      expect(runner.abortReason).toBeNull();
      expect(runner.lastIterationSuccess).toBe(true);
      expect(runner.consecutiveSuccesses).toBe(0);
      expect(runner.consecutiveErrors).toBe(0);
    });

    it('should reset state if called multiple times', () => {
      runner.iterationCount = 10;
      runner.isRunning = true;
      runner.consecutiveSuccesses = 5;

      CLIInitializer.initializeState(runner);

      expect(runner.iterationCount).toBe(0);
      expect(runner.isRunning).toBe(false);
      expect(runner.consecutiveSuccesses).toBe(0);
    });
  });

  describe('initializeCallbacks', () => {
    it('should set all callbacks from options', () => {
      const callbacks = {
        onProgress: vi.fn(),
        onMessage: vi.fn(),
        onError: vi.fn(),
        onComplete: vi.fn(),
        onSupervision: vi.fn(),
        onEscalation: vi.fn(),
        onVerification: vi.fn(),
      };

      CLIInitializer.initializeCallbacks(runner, callbacks);

      expect(runner.onProgress).toBe(callbacks.onProgress);
      expect(runner.onMessage).toBe(callbacks.onMessage);
      expect(runner.onError).toBe(callbacks.onError);
      expect(runner.onComplete).toBe(callbacks.onComplete);
      expect(runner.onSupervision).toBe(callbacks.onSupervision);
      expect(runner.onEscalation).toBe(callbacks.onEscalation);
      expect(runner.onVerification).toBe(callbacks.onVerification);
    });

    it('should use no-op functions when callbacks not provided', () => {
      CLIInitializer.initializeCallbacks(runner, {});

      expect(runner.onProgress).toBeTypeOf('function');
      expect(runner.onMessage).toBeTypeOf('function');
      expect(runner.onError).toBeTypeOf('function');
      expect(runner.onComplete).toBeTypeOf('function');
      expect(runner.onSupervision).toBeTypeOf('function');
      expect(runner.onEscalation).toBeTypeOf('function');
      expect(runner.onVerification).toBeTypeOf('function');

      // No-op functions should not throw
      expect(() => runner.onProgress()).not.toThrow();
      expect(() => runner.onMessage()).not.toThrow();
      expect(() => runner.onError()).not.toThrow();
    });
  });

  describe('createParallelWorkers', () => {
    beforeEach(() => {
      runner.parallelWorkerClients = [];
    });

    it('should create parallel worker clients when enabled', () => {
      runner.config = new Config({ parallelExecution: { enabled: true, maxWorkers: 3 } });
      const modelConfig = { worker: 'opus' };
      const retryConfig = { maxRetries: 3 };

      CLIInitializer.createParallelWorkers(runner, '/test', modelConfig, retryConfig);

      expect(runner.parallelWorkerClients).toHaveLength(2); // maxWorkers - 1
    });

    it('should not create workers when disabled', () => {
      runner.config = new Config({ parallelExecution: { enabled: false, maxWorkers: 3 } });

      CLIInitializer.createParallelWorkers(runner, '/test', {}, {});

      expect(runner.parallelWorkerClients).toHaveLength(0);
    });

    it('should not create workers when maxWorkers is 1', () => {
      runner.config = new Config({ parallelExecution: { enabled: true, maxWorkers: 1 } });

      CLIInitializer.createParallelWorkers(runner, '/test', {}, {});

      expect(runner.parallelWorkerClients).toHaveLength(0);
    });

    it('should use default maxWorkers of 2', () => {
      runner.config = new Config({ parallelExecution: {} });

      CLIInitializer.createParallelWorkers(runner, '/test', {}, {});

      expect(runner.parallelWorkerClients).toHaveLength(1); // 2 - 1
    });
  });

  describe('initializeRunContext', () => {
    it('should initialize run context with all required components', async () => {
      const options = {
        primaryGoal: 'Test goal',
        subGoals: ['Sub 1', 'Sub 2'],
        timeLimit: '1h',
        workingDirectory: '/test',
        initialContext: 'Initial context',
      };

      runner.client = { options: {} };
      runner.config = new Config();
      runner.parallelWorkerClients = [];

      await CLIInitializer.initializeRunContext(runner, options);

      expect(runner.primaryGoal).toBe('Test goal');
      expect(runner.subGoals).toEqual(['Sub 1', 'Sub 2']);
      expect(runner.workingDirectory).toBe('/test');
      expect(runner.initialContext).toBe('Initial context');
      expect(runner.goalTracker).toBeDefined();
      expect(runner.supervisorClient).toBeDefined();
      expect(runner.supervisor).toBeDefined();
      expect(runner.plannerClient).toBeDefined();
      expect(runner.planner).toBeDefined();
      expect(runner.phaseManager).toBeDefined();
      expect(runner.verifier).toBeDefined();
      expect(runner.onProgress).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'initialized',
          goal: 'Test goal',
        })
      );
    });

    it('should use defaults when optional values not provided', async () => {
      const options = { primaryGoal: 'Test goal' };
      runner.client = { options: {} };
      runner.config = new Config();
      runner.parallelWorkerClients = [];

      await CLIInitializer.initializeRunContext(runner, options);

      expect(runner.subGoals).toEqual([]);
      expect(runner.workingDirectory).toBe(process.cwd());
      expect(runner.initialContext).toBe('');
    });
  });

  describe('initializePersistence', () => {
    it('should initialize persistence and start new session', async () => {
      runner.statePersistence = {
        initialize: vi.fn(),
        startSession: vi.fn().mockResolvedValue(null),
        getResumableSession: vi.fn().mockResolvedValue(null),
      };
      runner.primaryGoal = 'Test goal';
      runner.resumeSessionId = null;

      const result = await CLIInitializer.initializePersistence(runner);

      expect(runner.statePersistence.initialize).toHaveBeenCalled();
      expect(runner.statePersistence.getResumableSession).toHaveBeenCalledWith('Test goal');
      expect(runner.statePersistence.startSession).toHaveBeenCalledWith('Test goal');
      expect(result).toBeNull();
    });

    it('should resume session when resumeSessionId provided', async () => {
      const mockSession = { id: 'resume-id', goal: 'Test goal' };
      runner.statePersistence = {
        initialize: vi.fn(),
        startSession: vi.fn().mockResolvedValue(mockSession),
        getResumableSession: vi.fn(),
      };
      runner.primaryGoal = 'Test goal';
      runner.resumeSessionId = 'resume-id';

      const result = await CLIInitializer.initializePersistence(runner);

      expect(runner.statePersistence.startSession).toHaveBeenCalledWith('Test goal', {
        resumeSessionId: 'resume-id',
      });
      expect(runner.statePersistence.getResumableSession).not.toHaveBeenCalled();
      expect(result).toBe(mockSession);
    });

    it('should resume existing session when found', async () => {
      const mockSession = { id: 'existing-id', goal: 'Test goal' };
      runner.statePersistence = {
        initialize: vi.fn(),
        startSession: vi.fn().mockResolvedValue(mockSession),
        getResumableSession: vi.fn().mockResolvedValue(mockSession),
      };
      runner.primaryGoal = 'Test goal';
      runner.resumeSessionId = null;
      runner.onProgress = vi.fn();

      const result = await CLIInitializer.initializePersistence(runner);

      expect(runner.onProgress).toHaveBeenCalledWith({
        type: 'resumable_session_found',
        session: mockSession,
      });
      expect(runner.statePersistence.startSession).toHaveBeenCalledWith('Test goal', {
        resumeSessionId: 'existing-id',
      });
      expect(result).toBe(mockSession);
    });

    it('should handle no resumable session found', async () => {
      runner.statePersistence = {
        initialize: vi.fn(),
        startSession: vi.fn().mockResolvedValue(null),
        getResumableSession: vi.fn().mockResolvedValue(null),
      };
      runner.primaryGoal = 'Test goal';
      runner.resumeSessionId = null;

      const result = await CLIInitializer.initializePersistence(runner);

      expect(runner.statePersistence.getResumableSession).toHaveBeenCalledWith('Test goal');
      expect(runner.statePersistence.startSession).toHaveBeenCalledTimes(1);
      expect(result).toBeNull();
    });
  });
});
