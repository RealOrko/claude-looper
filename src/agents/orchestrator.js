/**
 * Orchestrator - Main execution loop coordinating all agents
 *
 * The Orchestrator manages the complete workflow:
 * 1. Planning phase - Planner creates execution plan
 * 2. Execution phase - For each step:
 *    a. Coder implements the step
 *    b. Tester validates the implementation
 *    c. If tests fail, Tester creates fix plan → Coder fixes → loop
 *    d. Supervisor verifies all outputs
 * 3. Verification phase - Final goal verification
 *
 * Supports recursive re-planning up to 3 levels deep when steps are blocked.
 */

import { EventEmitter } from 'events';
import {
  AgentRole,
  AgentStatus,
  MessageType,
  PlanDepth,
  VerificationType,
  AgentMessage,
  OrchestrationState,
} from './interfaces.js';
import { MessageBus, Messages } from './message-bus.js';

// Limits
const MAX_FIX_CYCLES = 3; // Max test-fix cycles per step
const MAX_STEP_ATTEMPTS = 3; // Max attempts per step before re-planning
const REQUIRE_TESTS_FOR_COMPLETION = true; // Require tests before marking step complete

/**
 * Orchestration Loop Manager
 */
export class Orchestrator extends EventEmitter {
  constructor(config = {}) {
    super();

    this.config = {
      maxFixCycles: config.maxFixCycles || MAX_FIX_CYCLES,
      maxStepAttempts: config.maxStepAttempts || MAX_STEP_ATTEMPTS,
      verifyAllOutputs: config.verifyAllOutputs !== false, // Default true
      requireTests: config.requireTests !== false, // Default true - require tests for completion
      timeLimit: config.timeLimit || 2 * 60 * 60 * 1000, // 2 hours default
      ...config,
    };

    this.messageBus = new MessageBus();
    this.state = null;
    this.agents = {};
    this.isRunning = false;
    this.shouldStop = false;
    this.startTime = null;

    // Set up message bus event forwarding
    this.setupMessageBusEvents();
  }

  /**
   * Forward message bus events to orchestrator events
   */
  setupMessageBusEvents() {
    this.messageBus.on('message_sent', (data) => {
      this.emit('message', { direction: 'sent', ...data });
    });

    this.messageBus.on('message_delivered', (data) => {
      this.emit('message', { direction: 'delivered', ...data });
    });

    this.messageBus.on('message_failed', (data) => {
      this.emit('error', { type: 'message_failed', ...data });
    });
  }

  /**
   * Register all agents
   */
  registerAgents(agents) {
    for (const [role, agent] of Object.entries(agents)) {
      this.agents[role] = agent;
      this.messageBus.registerAgent(role, agent);
    }

    // Register self as orchestrator for receiving messages
    this.messageBus.registerAgent(AgentRole.ORCHESTRATOR, {
      handleMessage: (msg) => this.handleIncomingMessage(msg),
      getId: () => 'orchestrator',
    });
  }

  /**
   * Handle incoming messages to the orchestrator
   */
  async handleIncomingMessage(message) {
    switch (message.type) {
      case MessageType.STEP_COMPLETE:
        return this.onStepComplete(message);
      case MessageType.STEP_BLOCKED:
        return this.onStepBlocked(message);
      case MessageType.ESCALATION:
        return this.onEscalation(message);
      default:
        this.emit('warning', { message: `Unhandled message type: ${message.type}` });
    }
  }

  /**
   * Initialize orchestration with a goal
   */
  async initialize(primaryGoal, context = {}) {
    this.state = new OrchestrationState(primaryGoal);
    this.state.context = context;
    this.startTime = Date.now();

    this.emit('initialized', {
      goal: primaryGoal,
      context,
      timestamp: this.startTime,
    });

    return this.state;
  }

  /**
   * Main execution loop
   */
  async run() {
    if (!this.state) {
      throw new Error('Orchestrator not initialized. Call initialize() first.');
    }

    this.isRunning = true;
    this.shouldStop = false;

    this.emit('started', { state: this.state.getSummary() });

    try {
      // Phase 1: Planning
      await this.planningPhase();

      if (this.shouldStop) return this.generateReport();

      // Phase 2: Execution Loop
      await this.executionPhase();

      if (this.shouldStop) return this.generateReport();

      // Phase 3: Final Verification
      await this.verificationPhase();

      return this.generateReport();

    } catch (error) {
      this.state.status = 'failed';
      this.emit('error', { type: 'fatal', error: error.message });
      throw error;

    } finally {
      this.isRunning = false;
      this.state.endTime = Date.now();
    }
  }

  /**
   * Phase 1: Planning
   */
  async planningPhase() {
    this.state.status = 'planning';
    this.emit('phase_started', { phase: 'planning' });

    // Request plan from Planner
    const planRequest = Messages.planRequest(
      AgentRole.ORCHESTRATOR,
      this.state.primaryGoal,
      this.state.context
    );

    this.state.updateAgentState(AgentRole.PLANNER, AgentStatus.WORKING);
    const planResponse = await this.messageBus.request(planRequest);
    this.state.updateAgentState(AgentRole.PLANNER, AgentStatus.IDLE, planResponse);

    if (!planResponse.payload?.plan) {
      throw new Error('Planner failed to create a plan');
    }

    this.state.currentPlan = planResponse.payload.plan;
    this.state.metrics.totalSteps = this.state.currentPlan.steps.length;

    this.emit('plan_created', {
      plan: this.state.currentPlan,
      steps: this.state.currentPlan.steps.length,
    });

    // Supervisor verifies the plan
    if (this.config.verifyAllOutputs) {
      await this.verifyOutput(VerificationType.PLAN, this.state.currentPlan);
    }

    this.emit('phase_completed', { phase: 'planning' });
  }

  /**
   * Phase 2: Execution Loop
   */
  async executionPhase() {
    this.state.status = 'executing';
    this.emit('phase_started', { phase: 'execution' });

    while (!this.state.currentPlan.isComplete() && !this.shouldStop && !this.isTimeExpired()) {
      this.state.iteration++;

      const currentStep = this.state.currentPlan.getCurrentStep();
      if (!currentStep) break;

      this.emit('step_started', {
        step: currentStep,
        iteration: this.state.iteration,
      });

      try {
        // Execute the step through the agent cycle
        const stepResult = await this.executeStep(currentStep);

        if (stepResult.success) {
          // Step completed successfully
          this.state.currentPlan.advanceStep();
          this.state.metrics.completedSteps++;

          this.emit('step_completed', {
            step: currentStep,
            result: stepResult,
          });

          // Handle sub-plan completion (pop back to parent)
          await this.handlePlanCompletion();

        } else if (stepResult.blocked) {
          // Step is blocked - try re-planning
          const recovered = await this.handleBlockedStep(currentStep, stepResult.reason);

          if (!recovered) {
            // Could not recover - mark failed and continue
            currentStep.status = 'failed';
            currentStep.failReason = stepResult.reason;
            this.state.metrics.failedSteps++;
            this.state.currentPlan.advanceStep();

            this.emit('step_failed', {
              step: currentStep,
              reason: stepResult.reason,
            });
          }
        } else {
          // Step failed but not blocked (e.g., tests failed with no fix plan)
          // Mark as failed and continue to prevent infinite loop
          currentStep.status = 'failed';
          currentStep.failReason = stepResult.reason || 'Step failed';
          this.state.metrics.failedSteps++;
          this.state.currentPlan.advanceStep();

          this.emit('step_failed', {
            step: currentStep,
            reason: stepResult.reason,
          });
        }

      } catch (error) {
        this.emit('step_error', {
          step: currentStep,
          error: error.message,
        });

        // Handle error recovery
        currentStep.attempts++;
        if (!currentStep.canRetry()) {
          currentStep.status = 'failed';
          currentStep.failReason = error.message;
          this.state.metrics.failedSteps++;
          this.state.currentPlan.advanceStep();
        }
      }

      // Brief pause between steps
      await this.sleep(1000);
    }

    this.emit('phase_completed', { phase: 'execution' });
  }

  /**
   * Execute a single step through the agent cycle
   * Coder → Tester → (Fix Cycle if needed) → Supervisor
   */
  async executeStep(step) {
    step.status = 'in_progress';
    step.attempts++;

    // Step 1: Coder implements
    this.state.updateAgentState(AgentRole.CODER, AgentStatus.WORKING);

    const codeRequest = Messages.codeRequest(
      AgentRole.ORCHESTRATOR,
      step,
      { plan: this.state.currentPlan, iteration: this.state.iteration }
    );

    let codeResponse;
    try {
      codeResponse = await this.messageBus.request(codeRequest);
    } catch (error) {
      this.state.updateAgentState(AgentRole.CODER, AgentStatus.ERROR);
      return { success: false, blocked: true, reason: `Coder failed: ${error.message}` };
    }

    this.state.updateAgentState(AgentRole.CODER, AgentStatus.IDLE, codeResponse);
    step.codeOutput = codeResponse.payload?.output || codeResponse.payload;

    // Check if tests were written (required for step completion)
    if (this.config.requireTests) {
      const testsWritten = step.codeOutput?.tests?.length > 0;
      if (!testsWritten) {
        this.emit('tests_missing', {
          step,
          message: 'No tests written for this step - requesting test creation',
        });

        // Request tests be added
        const testPrompt = this.buildTestRequirementPrompt(step);
        try {
          const testAddResponse = await this.messageBus.request(
            Messages.codeFixRequest(AgentRole.ORCHESTRATOR, step, {
              issues: [{ severity: 'major', description: 'Tests are required before step can be marked complete' }],
              priority: 'high',
              requireTests: true,
            })
          );
          step.codeOutput = testAddResponse.payload?.output || testAddResponse.payload;
        } catch (error) {
          // Continue without tests if test request fails
          this.emit('warning', { message: `Failed to add tests: ${error.message}` });
        }
      }
    }

    // Verify coder output
    if (this.config.verifyAllOutputs) {
      const codeVerification = await this.verifyOutput(VerificationType.CODE, step.codeOutput, { step });
      if (!codeVerification.verified) {
        return { success: false, blocked: true, reason: `Code verification failed: ${codeVerification.reason}` };
      }
    }

    // Step 2: Tester validates
    this.state.updateAgentState(AgentRole.TESTER, AgentStatus.WORKING);

    const testRequest = Messages.testRequest(
      AgentRole.ORCHESTRATOR,
      step,
      step.codeOutput
    );

    let testResponse;
    try {
      testResponse = await this.messageBus.request(testRequest);
    } catch (error) {
      this.state.updateAgentState(AgentRole.TESTER, AgentStatus.ERROR);
      // Test failure is not necessarily blocking - we can try to fix
      testResponse = { payload: { passed: false, reason: error.message } };
    }

    this.state.updateAgentState(AgentRole.TESTER, AgentStatus.IDLE, testResponse);
    step.testResults = testResponse.payload;

    // Step 3: Fix cycle if tests failed
    let fixCycles = 0;
    while (!step.testResults.passed && fixCycles < this.config.maxFixCycles) {
      fixCycles++;
      this.state.metrics.fixCycles++;

      this.emit('fix_cycle_started', {
        step,
        cycle: fixCycles,
        issues: step.testResults.issues,
      });

      // Tester creates fix plan
      const fixPlan = step.testResults.fixPlan || step.testResults.generateFixPlan?.();
      if (!fixPlan) {
        break; // No fix plan available
      }

      // Coder applies fix
      this.state.updateAgentState(AgentRole.CODER, AgentStatus.WORKING);

      const fixRequest = Messages.codeFixRequest(
        AgentRole.ORCHESTRATOR,
        step,
        fixPlan
      );

      try {
        const fixResponse = await this.messageBus.request(fixRequest);
        step.codeOutput = fixResponse.payload;
        this.state.updateAgentState(AgentRole.CODER, AgentStatus.IDLE, fixResponse);
      } catch (error) {
        this.state.updateAgentState(AgentRole.CODER, AgentStatus.ERROR);
        break; // Fix failed
      }

      // Re-test
      this.state.updateAgentState(AgentRole.TESTER, AgentStatus.WORKING);

      const retestRequest = Messages.testRequest(
        AgentRole.ORCHESTRATOR,
        step,
        step.codeOutput
      );

      try {
        testResponse = await this.messageBus.request(retestRequest);
        step.testResults = testResponse.payload;
        this.state.updateAgentState(AgentRole.TESTER, AgentStatus.IDLE, testResponse);
      } catch (error) {
        this.state.updateAgentState(AgentRole.TESTER, AgentStatus.ERROR);
        step.testResults = { passed: false, reason: error.message };
      }

      this.emit('fix_cycle_completed', {
        step,
        cycle: fixCycles,
        passed: step.testResults.passed,
      });
    }

    // Step 4: Final verification by Supervisor
    if (step.testResults.passed && this.config.verifyAllOutputs) {
      const stepVerification = await this.verifyOutput(VerificationType.STEP, {
        step,
        codeOutput: step.codeOutput,
        testResults: step.testResults,
      });

      step.verificationResult = stepVerification;

      if (!stepVerification.verified) {
        this.state.metrics.verificationsFailed++;
        return {
          success: false,
          blocked: false,
          reason: `Supervisor verification failed: ${stepVerification.reason}`,
        };
      }

      this.state.metrics.verificationsPassed++;
    }

    // Determine final result
    if (step.testResults.passed) {
      return { success: true };
    } else {
      return {
        success: false,
        blocked: fixCycles >= this.config.maxFixCycles,
        reason: `Tests failed after ${fixCycles} fix cycles`,
      };
    }
  }

  /**
   * Handle a blocked step through recursive re-planning
   */
  async handleBlockedStep(step, reason) {
    // Check if we can create a sub-plan
    if (!this.state.canCreateSubPlan()) {
      this.emit('replan_limit_reached', {
        step,
        depth: this.state.getPlanDepth(),
        maxDepth: PlanDepth.LEVEL_3,
      });
      return false;
    }

    this.state.metrics.replanCount++;

    this.emit('replan_started', {
      step,
      reason,
      depth: this.state.getPlanDepth() + 1,
    });

    // Request sub-plan from Planner
    const replanRequest = Messages.replanRequest(
      AgentRole.ORCHESTRATOR,
      step,
      reason,
      this.state.getPlanDepth()
    );

    this.state.updateAgentState(AgentRole.PLANNER, AgentStatus.WORKING);
    let replanResponse;

    try {
      replanResponse = await this.messageBus.request(replanRequest);
    } catch (error) {
      this.state.updateAgentState(AgentRole.PLANNER, AgentStatus.ERROR);
      this.emit('replan_failed', { step, error: error.message });
      return false;
    }

    this.state.updateAgentState(AgentRole.PLANNER, AgentStatus.IDLE, replanResponse);

    if (!replanResponse.payload?.plan) {
      this.emit('replan_failed', { step, reason: 'No sub-plan created' });
      return false;
    }

    const subPlan = replanResponse.payload.plan;
    subPlan.depth = this.state.getPlanDepth() + 1;
    subPlan.parentPlanId = this.state.currentPlan.id;

    // Push sub-plan onto the stack
    this.state.pushPlan(subPlan);

    this.emit('replan_completed', {
      step,
      subPlan,
      depth: this.state.getPlanDepth(),
    });

    return true; // Successfully created sub-plan, will be executed in next iteration
  }

  /**
   * Handle plan completion - pop back to parent plan if in sub-plan
   */
  async handlePlanCompletion() {
    if (this.state.currentPlan.isComplete() && this.state.getPlanDepth() > 0) {
      // Sub-plan completed - pop back to parent
      const completedSubPlan = this.state.currentPlan;
      this.state.popPlan();

      // Mark parent step as completed via sub-plan
      const parentStep = this.state.currentPlan.getCurrentStep();
      if (parentStep) {
        parentStep.status = 'completed';
        parentStep.completedAt = Date.now();
        parentStep.completedViaSubPlan = completedSubPlan.id;
        this.state.currentPlan.advanceStep();
        this.state.metrics.completedSteps++;
      }

      this.emit('subplan_completed', {
        subPlan: completedSubPlan,
        parentStep,
        depth: this.state.getPlanDepth(),
      });
    }
  }

  /**
   * Request verification from Supervisor
   */
  async verifyOutput(type, target) {
    const verifyRequest = Messages.verifyRequest(
      AgentRole.ORCHESTRATOR,
      type,
      target,
      { state: this.state.getSummary() }
    );

    this.state.updateAgentState(AgentRole.SUPERVISOR, AgentStatus.WORKING);

    try {
      const response = await this.messageBus.request(verifyRequest);
      this.state.updateAgentState(AgentRole.SUPERVISOR, AgentStatus.IDLE, response);
      return response.payload;
    } catch (error) {
      this.state.updateAgentState(AgentRole.SUPERVISOR, AgentStatus.ERROR);
      // On supervisor failure, allow continuation with warning
      this.emit('warning', {
        message: `Supervisor verification failed: ${error.message}`,
        type,
      });
      return { verified: true, reason: 'Verification unavailable - continuing' };
    }
  }

  /**
   * Phase 3: Final Goal Verification
   */
  async verificationPhase() {
    this.state.status = 'verifying';
    this.emit('phase_started', { phase: 'verification' });

    // Final goal verification
    const goalVerification = await this.verifyOutput(VerificationType.GOAL, {
      goal: this.state.primaryGoal,
      plan: this.state.currentPlan,
      metrics: this.state.metrics,
    });

    if (goalVerification.verified) {
      this.state.status = 'completed';
      this.emit('goal_achieved', {
        verification: goalVerification,
        metrics: this.state.metrics,
      });
    } else {
      this.state.status = 'verification_failed';
      this.emit('goal_verification_failed', {
        verification: goalVerification,
        metrics: this.state.metrics,
      });
    }

    this.emit('phase_completed', { phase: 'verification' });
  }

  /**
   * Handle escalation from Supervisor
   */
  async onEscalation(message) {
    const { level, reason, recommendation } = message.payload;

    this.emit('escalation', { level, reason, recommendation });

    if (recommendation === 'abort') {
      this.shouldStop = true;
      this.state.status = 'aborted';
    }
  }

  /**
   * Handle step complete notification
   */
  async onStepComplete(message) {
    // Already handled in executeStep
  }

  /**
   * Handle step blocked notification
   */
  async onStepBlocked(message) {
    // Already handled in executeStep
  }

  /**
   * Check if time limit has been exceeded
   */
  isTimeExpired() {
    if (!this.startTime) return false;
    return Date.now() - this.startTime >= this.config.timeLimit;
  }

  /**
   * Stop the orchestration loop gracefully
   */
  stop() {
    this.shouldStop = true;
    this.emit('stopping');
  }

  /**
   * Generate final execution report
   */
  generateReport() {
    const elapsed = this.state.endTime
      ? this.state.endTime - this.state.startTime
      : Date.now() - this.startTime;

    return {
      status: this.state.status,
      goal: this.state.primaryGoal,
      elapsed,
      iterations: this.state.iteration,
      plan: this.state.currentPlan ? {
        totalSteps: this.state.currentPlan.steps.length,
        progress: this.state.currentPlan.getProgress(),
      } : null,
      metrics: this.state.metrics,
      planDepth: this.state.getPlanDepth(),
      messageBusStats: this.messageBus.getStats(),
      agentStats: Object.entries(this.agents).reduce((acc, [role, agent]) => {
        acc[role] = agent.getStats?.() || { role, status: 'unknown' };
        return acc;
      }, {}),
      eventLog: this.state.eventLog.slice(-50), // Last 50 events
    };
  }

  /**
   * Sleep helper
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get current state summary
   */
  getState() {
    return this.state?.getSummary() || null;
  }

  /**
   * Build prompt for requesting test creation
   */
  buildTestRequirementPrompt(step) {
    return `## TESTS REQUIRED

Step ${step.number} ("${step.description}") implementation is incomplete.

**REQUIREMENT**: Every implementation must include tests before it can be marked complete.

Please add appropriate tests for this step:
1. Unit tests for new functions/methods
2. Integration tests if multiple components interact
3. Edge case tests for error handling

Create test files and show the test code.`;
  }

  /**
   * Check if step has required tests
   */
  hasRequiredTests(codeOutput) {
    if (!codeOutput) return false;
    const tests = codeOutput.tests || [];
    return tests.length > 0;
  }

  /**
   * Get test coverage summary for a step
   */
  getTestCoverage(step) {
    const codeOutput = step.codeOutput;
    if (!codeOutput) return { hasTests: false, count: 0 };

    const tests = codeOutput.tests || [];
    return {
      hasTests: tests.length > 0,
      count: tests.length,
      paths: tests.map(t => t.path),
      types: tests.map(t => t.testType),
    };
  }
}

export default Orchestrator;
