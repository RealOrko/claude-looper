/**
 * CLI Initializer - handles initialization of clients and state
 */
import { ClaudeCodeClient } from './claude-code-client.js';
import { GoalTracker } from './goal-tracker.js';
import { Supervisor } from './supervisor.js';
import { PhaseManager } from './phase-manager.js';
import { CompletionVerifier } from './completion-verifier.js';
import { Planner } from './planner.js';
import { ContextManager } from './context-manager.js';
import { PerformanceMetrics, AdaptiveOptimizer } from './performance-metrics.js';
import { ErrorRecovery } from './error-recovery.js';
import { StatePersistence } from './state-persistence.js';
import { ParallelStepExecutor } from './parallel-executor.js';
import { ExecutionEngine } from './execution-engine.js';
import { VerificationHandler } from './verification-handler.js';
import { PlanManager } from './plan-manager.js';
import { IterationHandler } from './iteration-handler.js';
import { ReportGenerator } from './report-generator.js';
import { SystemContextBuilder } from './system-context-builder.js';
import { MainLoop } from './main-loop.js';

export class CLIInitializer {
  static initializeClients(runner, options) {
    const modelConfig = runner.config.get('models') || {};
    const retryConfig = runner.config.get('retry') || {};

    runner.client = ClaudeCodeClient.createWorkerClient({
      cwd: options.workingDirectory || process.cwd(),
      verbose: options.verbose || false,
      model: modelConfig.worker || 'opus',
      fallbackModel: modelConfig.workerFallback || 'sonnet',
      maxRetries: retryConfig.maxRetries || 3,
      retryBaseDelay: retryConfig.baseDelay || 1000,
    });

    runner.contextManager = new ContextManager();
    runner.metrics = new PerformanceMetrics();
    runner.errorRecovery = new ErrorRecovery({
      baseDelay: retryConfig.baseDelay || 1000,
      maxDelay: retryConfig.maxDelay || 60000,
      maxRetries: retryConfig.maxRetries || 5,
      circuitBreakerThreshold: retryConfig.circuitBreakerThreshold || 5,
      circuitBreakerResetTime: retryConfig.circuitBreakerResetTime || 60000,
    });

    const persistenceConfig = runner.config.get('persistence') || {};
    runner.statePersistence = new StatePersistence({
      workingDirectory: options.workingDirectory || process.cwd(),
      persistenceDir: persistenceConfig.dir || '.claude-runner',
      autoSaveInterval: persistenceConfig.autoSaveInterval || 30000,
      maxCheckpoints: persistenceConfig.maxCheckpoints || 10,
      cacheMaxSize: persistenceConfig.cacheMaxSize || 100,
      cacheTTL: persistenceConfig.cacheTTL || 3600000,
    });
    runner.enablePersistence = options.enablePersistence !== false;
    runner.resumeSessionId = options.resumeSessionId || null;

    runner.adaptiveOptimizer = new AdaptiveOptimizer();
    runner.parallelExecutor = new ParallelStepExecutor(runner);
    runner.executionEngine = new ExecutionEngine(runner);
    runner.verificationHandler = new VerificationHandler(runner);
    runner.planManager = new PlanManager(runner);
    runner.iterationHandler = new IterationHandler(runner);
    runner.reportGenerator = new ReportGenerator(runner);
    runner.systemContextBuilder = new SystemContextBuilder(runner);
    runner.mainLoop = new MainLoop(runner);
    runner.parallelWorkerClients = [];
  }

  static initializeState(runner) {
    runner.goalTracker = null;
    runner.supervisor = null;
    runner.phaseManager = null;
    runner.verifier = null;
    runner.planner = null;
    runner.currentExecutionProfile = null;
    runner.iterationCount = 0;
    runner.planCreated = false;
    runner.lastProgressCheck = Date.now();
    runner.isRunning = false;
    runner.shouldStop = false;
    runner.finalSummary = null;
    runner.recentActions = [];
    runner.pendingCompletion = null;
    runner.verificationFailures = 0;
    runner.pendingStepCompletion = null;
    runner.stepVerificationFailures = 0;
    runner.pendingSubPlan = null;
    runner.abortReason = null;
    runner.lastIterationSuccess = true;
    runner.consecutiveSuccesses = 0;
    runner.consecutiveErrors = 0;
  }

  static initializeCallbacks(runner, options) {
    runner.onProgress = options.onProgress || (() => {});
    runner.onMessage = options.onMessage || (() => {});
    runner.onError = options.onError || (() => {});
    runner.onComplete = options.onComplete || (() => {});
    runner.onSupervision = options.onSupervision || (() => {});
    runner.onEscalation = options.onEscalation || (() => {});
    runner.onVerification = options.onVerification || (() => {});
  }

  static createParallelWorkers(runner, workingDirectory, modelConfig, retryConfig) {
    const parallelConfig = runner.config.get('parallelExecution') || {};
    const maxParallel = parallelConfig.maxWorkers || 2;
    if (parallelConfig.enabled !== false && maxParallel > 1) {
      for (let i = 1; i < maxParallel; i++) {
        runner.parallelWorkerClients.push(
          ClaudeCodeClient.createWorkerClient({
            cwd: workingDirectory,
            verbose: false,
            model: modelConfig.worker || 'opus',
            fallbackModel: modelConfig.workerFallback || 'sonnet',
            maxRetries: retryConfig.maxRetries || 3,
          })
        );
      }
    }
  }

  static async initializeRunContext(runner, options) {
    const {
      primaryGoal,
      subGoals = [],
      timeLimit = '2h',
      workingDirectory = process.cwd(),
      initialContext = '',
    } = options;

    const modelConfig = runner.config.get('models') || {};
    const retryConfig = runner.config.get('retry') || {};

    runner.goalTracker = new GoalTracker(primaryGoal, subGoals);

    runner.supervisorClient = ClaudeCodeClient.createSupervisorClient({
      cwd: workingDirectory,
      verbose: false,
      model: modelConfig.supervisor || 'sonnet',
      fallbackModel: modelConfig.supervisorFallback || 'haiku',
    });
    runner.supervisor = new Supervisor(runner.supervisorClient, runner.goalTracker, runner.config);

    runner.plannerClient = ClaudeCodeClient.createPlannerClient({
      cwd: workingDirectory,
      verbose: false,
      model: modelConfig.planner || 'opus',
      fallbackModel: modelConfig.plannerFallback || 'sonnet',
      maxRetries: retryConfig.maxRetries || 3,
    });
    runner.planner = new Planner(runner.plannerClient);

    runner.phaseManager = new PhaseManager(runner.config.getTimeLimit(timeLimit), runner.config);
    runner.phaseManager.initializeFromGoals(runner.goalTracker);
    runner.verifier = new CompletionVerifier(runner.client, runner.goalTracker, runner.config);
    runner.client.options.cwd = workingDirectory;

    this.createParallelWorkers(runner, workingDirectory, modelConfig, retryConfig);

    runner.primaryGoal = primaryGoal;
    runner.subGoals = subGoals;
    runner.workingDirectory = workingDirectory;
    runner.initialContext = initialContext;

    runner.onProgress({ type: 'initialized', goal: primaryGoal, subGoals, timeLimit, plan: null });
  }

  static async initializePersistence(runner) {
    await runner.statePersistence.initialize();
    if (runner.resumeSessionId) {
      return await runner.statePersistence.startSession(runner.primaryGoal, { resumeSessionId: runner.resumeSessionId });
    }
    const existingSession = await runner.statePersistence.getResumableSession(runner.primaryGoal);
    if (existingSession) {
      runner.onProgress({ type: 'resumable_session_found', session: existingSession });
      return await runner.statePersistence.startSession(runner.primaryGoal, { resumeSessionId: existingSession.id });
    }
    await runner.statePersistence.startSession(runner.primaryGoal);
    return null;
  }
}

export default CLIInitializer;
