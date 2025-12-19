/**
 * Tests for Enums Module
 */

import { describe, it, expect } from 'vitest';
import {
  MessageType,
  AgentRole,
  AgentStatus,
  PlanDepth,
  VerificationType,
  WorkflowPhase,
  FixCycleStatus,
} from '../enums.js';

describe('MessageType', () => {
  it('should define all planning message types', () => {
    expect(MessageType.PLAN_REQUEST).toBe('plan_request');
    expect(MessageType.PLAN_RESPONSE).toBe('plan_response');
    expect(MessageType.REPLAN_REQUEST).toBe('replan_request');
    expect(MessageType.SUBPLAN_REQUEST).toBe('subplan_request');
    expect(MessageType.SUBPLAN_RESPONSE).toBe('subplan_response');
  });

  it('should define all coding message types', () => {
    expect(MessageType.CODE_REQUEST).toBe('code_request');
    expect(MessageType.CODE_RESPONSE).toBe('code_response');
    expect(MessageType.CODE_FIX_REQUEST).toBe('code_fix_request');
  });

  it('should define all testing message types', () => {
    expect(MessageType.TEST_REQUEST).toBe('test_request');
    expect(MessageType.TEST_RESPONSE).toBe('test_response');
    expect(MessageType.FIX_PLAN).toBe('fix_plan');
  });

  it('should define all supervision message types', () => {
    expect(MessageType.VERIFY_REQUEST).toBe('verify_request');
    expect(MessageType.VERIFY_RESPONSE).toBe('verify_response');
    expect(MessageType.CORRECTION).toBe('correction');
    expect(MessageType.ESCALATION).toBe('escalation');
  });

  it('should define all orchestration message types', () => {
    expect(MessageType.STEP_COMPLETE).toBe('step_complete');
    expect(MessageType.STEP_BLOCKED).toBe('step_blocked');
    expect(MessageType.GOAL_COMPLETE).toBe('goal_complete');
    expect(MessageType.ABORT).toBe('abort');
  });
});

describe('AgentRole', () => {
  it('should define all agent roles', () => {
    expect(AgentRole.PLANNER).toBe('planner');
    expect(AgentRole.CODER).toBe('coder');
    expect(AgentRole.TESTER).toBe('tester');
    expect(AgentRole.SUPERVISOR).toBe('supervisor');
    expect(AgentRole.ORCHESTRATOR).toBe('orchestrator');
  });
});

describe('AgentStatus', () => {
  it('should define all status states', () => {
    expect(AgentStatus.IDLE).toBe('idle');
    expect(AgentStatus.WORKING).toBe('working');
    expect(AgentStatus.WAITING).toBe('waiting');
    expect(AgentStatus.BLOCKED).toBe('blocked');
    expect(AgentStatus.ERROR).toBe('error');
  });
});

describe('PlanDepth', () => {
  it('should define depth levels', () => {
    expect(PlanDepth.ROOT).toBe(0);
    expect(PlanDepth.LEVEL_1).toBe(1);
    expect(PlanDepth.LEVEL_2).toBe(2);
    expect(PlanDepth.LEVEL_3).toBe(3);
  });

  it('should have LEVEL_3 as maximum depth', () => {
    expect(PlanDepth.LEVEL_3).toBeGreaterThan(PlanDepth.LEVEL_2);
    expect(PlanDepth.LEVEL_3).toBeGreaterThan(PlanDepth.LEVEL_1);
    expect(PlanDepth.LEVEL_3).toBeGreaterThan(PlanDepth.ROOT);
  });
});

describe('VerificationType', () => {
  it('should define all verification types', () => {
    expect(VerificationType.PLAN).toBe('plan');
    expect(VerificationType.PLAN_PRE).toBe('plan_pre');
    expect(VerificationType.CODE).toBe('code');
    expect(VerificationType.TEST).toBe('test');
    expect(VerificationType.STEP).toBe('step');
    expect(VerificationType.GOAL).toBe('goal');
    expect(VerificationType.PROGRESS).toBe('progress');
  });
});

describe('WorkflowPhase', () => {
  it('should define all workflow phases', () => {
    expect(WorkflowPhase.INITIALIZING).toBe('initializing');
    expect(WorkflowPhase.PLANNING).toBe('planning');
    expect(WorkflowPhase.PLAN_REVIEW).toBe('plan_review');
    expect(WorkflowPhase.EXECUTING).toBe('executing');
    expect(WorkflowPhase.TESTING).toBe('testing');
    expect(WorkflowPhase.FIXING).toBe('fixing');
    expect(WorkflowPhase.VERIFYING).toBe('verifying');
    expect(WorkflowPhase.REPLANNING).toBe('replanning');
  });

  it('should define terminal phases', () => {
    expect(WorkflowPhase.COMPLETED).toBe('completed');
    expect(WorkflowPhase.FAILED).toBe('failed');
    expect(WorkflowPhase.ABORTED).toBe('aborted');
    expect(WorkflowPhase.TIME_EXPIRED).toBe('time_expired');
  });
});

describe('FixCycleStatus', () => {
  it('should define all fix cycle statuses', () => {
    expect(FixCycleStatus.NOT_STARTED).toBe('not_started');
    expect(FixCycleStatus.IN_PROGRESS).toBe('in_progress');
    expect(FixCycleStatus.RESOLVED).toBe('resolved');
    expect(FixCycleStatus.MAX_ATTEMPTS_REACHED).toBe('max_attempts_reached');
  });
});
