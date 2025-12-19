/** CLI Orchestrator - main entry point for the autonomous runner */
import { Config } from './config.js';
import { CLIInitializer } from './cli-initializer.js';

export class AutonomousRunnerCLI {
  constructor(options = {}) {
    this.config = new Config(options.config);
    CLIInitializer.initializeClients(this, options);
    CLIInitializer.initializeState(this);
    CLIInitializer.initializeCallbacks(this, options);
    this.wireUpEvents();
  }

  wireUpEvents() {
    this.client.on('stdout', (chunk) => {
      if (this.config.get('verbose')) {
        process.stdout.write(chunk);
      }
    });
  }

  buildSystemContext(primaryGoal, subGoals, workingDirectory) {
    return this.systemContextBuilder.build(primaryGoal, subGoals, workingDirectory);
  }

  async initialize(options) {
    await CLIInitializer.initializeRunContext(this, options);
    return this;
  }

  async run() {
    this.isRunning = true;
    this.shouldStop = false;
    this.phaseManager.start();
    this.metrics.startSession();

    let resumedSession = null;
    if (this.enablePersistence) {
      resumedSession = await this.initializePersistence();
    }

    this.onProgress({
      type: 'started',
      time: this.phaseManager.getTimeStatus(),
      resumed: !!resumedSession,
      sessionId: this.statePersistence.currentSession?.id,
    });

    try {
      await this.planManager.setupPlan(resumedSession);
      this.currentExecutionProfile = this.adaptiveOptimizer.createExecutionProfile(
        this.primaryGoal,
        { complexity: this.planner.plan?.complexity || 'medium' }
      );
      this.onProgress({ type: 'execution_profile_created', profile: this.currentExecutionProfile });

      const finalVerification = await this.executeMainLoop();
      await this.handleTimeExpiration();
      this.metrics.endSession();

      const finalReport = this.generateFinalReport(finalVerification);
      if (this.enablePersistence) {
        await this.statePersistence.completeSession({
          verified: finalVerification?.overallPassed,
          completedSteps: this.planner.getProgress().completed,
          totalSteps: this.planner.getProgress().total,
        }, this.planner.plan);
      }

      this.onComplete(finalReport);
      return finalReport;
    } catch (error) {
      this.metrics.recordError('fatal_error', false);
      this.metrics.endSession();
      if (this.enablePersistence) await this.statePersistence.failSession(error);
      this.onError({ type: 'fatal_error', error: error.message, stack: error.stack });
      throw error;
    } finally {
      this.isRunning = false;
      this.phaseManager.stop();
    }
  }

  async initializePersistence() {
    return CLIInitializer.initializePersistence(this);
  }

  async executeMainLoop() {
    return this.mainLoop.execute();
  }

  async handleTimeExpiration() {
    return this.mainLoop.handleTimeExpiration();
  }

  getStuckIterationCount() {
    const currentStep = this.planner?.getCurrentStep();
    if (!currentStep) return 0;
    return this.metrics.timings.iterations.slice(-10).length;
  }

  getAverageSupervisionScore() {
    const scores = this.metrics.supervision.scoreHistory;
    if (scores.length === 0) return 75;
    const recentScores = scores.slice(-5);
    return recentScores.reduce((a, b) => a + b, 0) / recentScores.length;
  }

  generateFinalReport(finalVerification = null) {
    return this.reportGenerator.generate(finalVerification);
  }

  stop() { this.shouldStop = true; }
  sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

  getAdaptiveDelay(success = true) {
    const delayConfig = this.config.get('iterationDelay') || {};
    if (delayConfig.adaptive === false) return delayConfig.default || 2000;
    const minimum = delayConfig.minimum || 500;
    const afterSuccess = delayConfig.afterSuccess || 1000;
    const afterError = delayConfig.afterError || 3000;

    if (success) {
      this.consecutiveSuccesses++;
      this.consecutiveErrors = 0;
      return Math.max(minimum, afterSuccess - Math.min(this.consecutiveSuccesses - 1, 5) * 100);
    } else {
      this.consecutiveErrors++;
      this.consecutiveSuccesses = 0;
      return afterError + Math.min(this.consecutiveErrors - 1, 5) * 500;
    }
  }

  getClientMetrics() {
    return this.reportGenerator.getClientMetrics();
  }
}

export default AutonomousRunnerCLI;
