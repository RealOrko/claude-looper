/**
 * Tests for interfaces.js - Core data structures and enums
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  MessageType,
  AgentRole,
  AgentStatus,
  PlanDepth,
  VerificationType,
  BaseAgent,
  AgentMessage,
  PlanStep,
  ExecutionPlan,
  TestResult,
  VerificationResult,
  OrchestrationState,
} from '../interfaces.js';

describe('MessageType enum', () => {
  it('should have all required message types', () => {
    expect(MessageType.PLAN_REQUEST).toBe('plan_request');
    expect(MessageType.PLAN_RESPONSE).toBe('plan_response');
    expect(MessageType.CODE_REQUEST).toBe('code_request');
    expect(MessageType.CODE_RESPONSE).toBe('code_response');
    expect(MessageType.TEST_REQUEST).toBe('test_request');
    expect(MessageType.TEST_RESPONSE).toBe('test_response');
    expect(MessageType.VERIFY_REQUEST).toBe('verify_request');
    expect(MessageType.VERIFY_RESPONSE).toBe('verify_response');
    expect(MessageType.ESCALATION).toBe('escalation');
  });
});

describe('AgentRole enum', () => {
  it('should have all agent roles', () => {
    expect(AgentRole.ORCHESTRATOR).toBe('orchestrator');
    expect(AgentRole.PLANNER).toBe('planner');
    expect(AgentRole.CODER).toBe('coder');
    expect(AgentRole.TESTER).toBe('tester');
    expect(AgentRole.SUPERVISOR).toBe('supervisor');
  });
});

describe('PlanDepth enum', () => {
  it('should have correct depth levels', () => {
    expect(PlanDepth.ROOT).toBe(0);
    expect(PlanDepth.LEVEL_1).toBe(1);
    expect(PlanDepth.LEVEL_2).toBe(2);
    expect(PlanDepth.LEVEL_3).toBe(3);
  });

  it('should limit recursive re-planning to 3 levels', () => {
    // LEVEL_3 is the maximum - no further recursion allowed
    expect(PlanDepth.LEVEL_3).toBe(3);
  });
});

describe('AgentMessage', () => {
  it('should create a message with required fields', () => {
    const msg = new AgentMessage(
      MessageType.PLAN_REQUEST,
      AgentRole.ORCHESTRATOR,
      AgentRole.PLANNER,
      { goal: 'test goal' }
    );

    expect(msg.id).toBeDefined();
    expect(msg.type).toBe(MessageType.PLAN_REQUEST);
    expect(msg.from).toBe(AgentRole.ORCHESTRATOR);
    expect(msg.to).toBe(AgentRole.PLANNER);
    expect(msg.payload.goal).toBe('test goal');
    expect(msg.timestamp).toBeDefined();
  });

  it('should create response messages correctly', () => {
    const request = new AgentMessage(
      MessageType.PLAN_REQUEST,
      AgentRole.ORCHESTRATOR,
      AgentRole.PLANNER,
      { goal: 'test' }
    );

    const response = request.createResponse(MessageType.PLAN_RESPONSE, { plan: {} });

    expect(response.type).toBe(MessageType.PLAN_RESPONSE);
    expect(response.from).toBe(AgentRole.PLANNER);
    expect(response.to).toBe(AgentRole.ORCHESTRATOR);
    expect(response.correlationId).toBe(request.id);
    expect(response.payload.plan).toBeDefined();
  });
});

describe('PlanStep', () => {
  it('should create a step with default values', () => {
    const step = new PlanStep(1, 'Implement feature', 'medium');

    expect(step.number).toBe(1);
    expect(step.description).toBe('Implement feature');
    expect(step.complexity).toBe('medium');
    expect(step.status).toBe('pending');
    expect(step.attempts).toBe(0);
    expect(step.maxAttempts).toBe(3);
  });

  it('should track retry capability', () => {
    const step = new PlanStep(1, 'Test step', 'low');

    expect(step.canRetry()).toBe(true);
    step.attempts = 3;
    expect(step.canRetry()).toBe(false);
  });

  it('should track sub-steps', () => {
    const step = new PlanStep(1, 'Parent step', 'high');
    const subStep = new PlanStep(1, 'Sub step', 'low');

    step.addSubStep(subStep);

    expect(step.hasSubSteps()).toBe(true);
    expect(subStep.depth).toBe(step.depth + 1);
    expect(subStep.parentStepId).toBe(step.id);
  });
});

describe('ExecutionPlan', () => {
  let plan;

  beforeEach(() => {
    plan = new ExecutionPlan('Test goal', 'Test analysis');
    plan.addStep('Step 1', 'low');
    plan.addStep('Step 2', 'medium');
    plan.addStep('Step 3', 'high');
  });

  it('should create a plan with goal and steps', () => {
    expect(plan.goal).toBe('Test goal');
    expect(plan.analysis).toBe('Test analysis');
    expect(plan.steps.length).toBe(3);
  });

  it('should track current step correctly', () => {
    expect(plan.currentStepIndex).toBe(0);
    expect(plan.getCurrentStep().description).toBe('Step 1');
  });

  it('should advance through steps', () => {
    plan.advanceStep();
    expect(plan.currentStepIndex).toBe(1);
    expect(plan.getCurrentStep().description).toBe('Step 2');
  });

  it('should report completion status', () => {
    expect(plan.isComplete()).toBe(false);

    plan.advanceStep();
    plan.advanceStep();
    plan.advanceStep();

    expect(plan.isComplete()).toBe(true);
  });

  it('should calculate progress', () => {
    const progress = plan.getProgress();
    expect(progress.current).toBe(1);
    expect(progress.total).toBe(3);
    expect(progress.percentComplete).toBe(0);

    plan.advanceStep();
    const progress2 = plan.getProgress();
    expect(progress2.percentComplete).toBe(33);

    plan.advanceStep();
    const progress3 = plan.getProgress();
    expect(progress3.percentComplete).toBe(67);

    plan.advanceStep();
    const progress4 = plan.getProgress();
    expect(progress4.percentComplete).toBe(100);
  });
});

describe('TestResult', () => {
  it('should create a test result', () => {
    const result = new TestResult('step_1', 'unit');

    expect(result.stepId).toBe('step_1');
    expect(result.testType).toBe('unit');
    expect(result.passed).toBe(false); // Default is false
    expect(result.issues).toEqual([]);
  });

  it('should add issues correctly', () => {
    const result = new TestResult('step_1', 'unit');
    result.addIssue('critical', 'Function throws error', 'src/app.js:25');

    expect(result.issues.length).toBe(1);
    expect(result.issues[0].severity).toBe('critical');
    expect(result.issues[0].description).toBe('Function throws error');
    expect(result.issues[0].location).toBe('src/app.js:25');
  });

  it('should add suggestions', () => {
    const result = new TestResult('step_1', 'unit');
    result.addSuggestion('Add more edge case tests', 'medium');

    expect(result.suggestions.length).toBe(1);
    expect(result.suggestions[0].description).toBe('Add more edge case tests');
    expect(result.suggestions[0].priority).toBe('medium');
  });

  it('should generate fix plan from issues', () => {
    const result = new TestResult('step_1', 'unit');
    result.addIssue('major', 'Missing null check');
    result.addIssue('minor', 'Could use better variable name');

    result.generateFixPlan();

    expect(result.fixPlan).toBeDefined();
    expect(result.fixPlan.issues.length).toBe(2);
    expect(result.fixPlan.priority).toBe('major'); // Has major issue
  });
});

describe('VerificationResult', () => {
  it('should create a verification result', () => {
    const result = new VerificationResult('plan', 'target_123');

    expect(result.type).toBe('plan');
    expect(result.targetId).toBe('target_123');
    expect(result.verified).toBe(false); // Default
    expect(result.score).toBe(0);
  });

  it('should set result correctly', () => {
    const result = new VerificationResult('code', 'target_456');
    result.setResult(true, 95, 'continue', 'Code looks good');

    expect(result.verified).toBe(true);
    expect(result.score).toBe(95);
    expect(result.recommendation).toBe('continue');
    expect(result.reason).toBe('Code looks good');
  });

  it('should record issues', () => {
    const result = new VerificationResult('code', 'target_789');
    result.addIssue('Code does not match requirements');

    expect(result.issues.length).toBe(1);
  });
});

describe('OrchestrationState', () => {
  let state;

  beforeEach(() => {
    state = new OrchestrationState('Build a web app');
  });

  it('should initialize with correct defaults', () => {
    expect(state.primaryGoal).toBe('Build a web app');
    expect(state.status).toBe('initializing');
    expect(state.iteration).toBe(0);
    expect(state.planStack.length).toBe(0);
  });

  it('should manage plan stack correctly', () => {
    const plan1 = new ExecutionPlan('Main plan', 'analysis');
    const plan2 = new ExecutionPlan('Sub plan', 'sub analysis');
    plan2.depth = 1;

    state.pushPlan(plan1);
    expect(state.currentPlan).toBe(plan1);
    expect(state.getPlanDepth()).toBe(0);

    state.pushPlan(plan2);
    expect(state.currentPlan).toBe(plan2);
    expect(state.getPlanDepth()).toBe(1);

    state.popPlan();
    expect(state.currentPlan).toBe(plan1);
    expect(state.getPlanDepth()).toBe(0);
  });

  it('should enforce 3-level depth limit', () => {
    const root = new ExecutionPlan('Root', ''); root.depth = 0;
    const l1 = new ExecutionPlan('L1', ''); l1.depth = 1;
    const l2 = new ExecutionPlan('L2', ''); l2.depth = 2;
    const l3 = new ExecutionPlan('L3', ''); l3.depth = 3;

    state.pushPlan(root);
    expect(state.canCreateSubPlan()).toBe(true);

    state.pushPlan(l1);
    expect(state.canCreateSubPlan()).toBe(true);

    state.pushPlan(l2);
    expect(state.canCreateSubPlan()).toBe(true);

    state.pushPlan(l3);
    expect(state.canCreateSubPlan()).toBe(false); // At max depth
  });

  it('should track agent states', () => {
    state.updateAgentState(AgentRole.PLANNER, 'working', { plan: {} });

    expect(state.agents[AgentRole.PLANNER].status).toBe('working');
    expect(state.agents[AgentRole.PLANNER].lastOutput).toBeDefined();
  });

  it('should provide summary', () => {
    const summary = state.getSummary();

    expect(summary.status).toBe('initializing');
    expect(summary.metrics).toBeDefined();
  });

  it('should log events', () => {
    state.logEvent('step_started', AgentRole.CODER, { step: 1 });

    expect(state.eventLog.length).toBe(1);
    expect(state.eventLog[0].type).toBe('step_started');
  });
});
