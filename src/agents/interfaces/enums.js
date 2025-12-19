/**
 * Core Enums and Constants for Multi-Agent Architecture
 *
 * Defines the fundamental constants used throughout the orchestration system.
 */

/**
 * Message types for inter-agent communication
 */
export const MessageType = {
  // Planning messages
  PLAN_REQUEST: 'plan_request',
  PLAN_RESPONSE: 'plan_response',
  REPLAN_REQUEST: 'replan_request',
  SUBPLAN_REQUEST: 'subplan_request',
  SUBPLAN_RESPONSE: 'subplan_response',

  // Coding messages
  CODE_REQUEST: 'code_request',
  CODE_RESPONSE: 'code_response',
  CODE_FIX_REQUEST: 'code_fix_request',

  // Testing messages
  TEST_REQUEST: 'test_request',
  TEST_RESPONSE: 'test_response',
  FIX_PLAN: 'fix_plan',

  // Supervision messages
  VERIFY_REQUEST: 'verify_request',
  VERIFY_RESPONSE: 'verify_response',
  CORRECTION: 'correction',
  ESCALATION: 'escalation',

  // Orchestration messages
  STEP_COMPLETE: 'step_complete',
  STEP_BLOCKED: 'step_blocked',
  GOAL_COMPLETE: 'goal_complete',
  ABORT: 'abort',
};

/**
 * Agent roles in the system
 */
export const AgentRole = {
  PLANNER: 'planner',
  CODER: 'coder',
  TESTER: 'tester',
  SUPERVISOR: 'supervisor',
  ORCHESTRATOR: 'orchestrator',
};

/**
 * Agent status states
 */
export const AgentStatus = {
  IDLE: 'idle',
  WORKING: 'working',
  WAITING: 'waiting',
  BLOCKED: 'blocked',
  ERROR: 'error',
};

/**
 * Plan depth levels for recursive re-planning
 */
export const PlanDepth = {
  ROOT: 0,      // Main plan
  LEVEL_1: 1,   // Sub-plan for blocked step
  LEVEL_2: 2,   // Sub-sub-plan
  LEVEL_3: 3,   // Maximum depth - no further recursion
};

/**
 * Verification types for supervisor
 */
export const VerificationType = {
  PLAN: 'plan',
  PLAN_PRE: 'plan_pre',   // Pre-execution plan review
  CODE: 'code',
  TEST: 'test',
  STEP: 'step',
  GOAL: 'goal',
  PROGRESS: 'progress',   // Periodic progress check
};

/**
 * Workflow phases for the development loop
 */
export const WorkflowPhase = {
  INITIALIZING: 'initializing',
  PLANNING: 'planning',
  PLAN_REVIEW: 'plan_review',
  EXECUTING: 'executing',
  TESTING: 'testing',
  FIXING: 'fixing',
  VERIFYING: 'verifying',
  REPLANNING: 'replanning',
  COMPLETED: 'completed',
  FAILED: 'failed',
  ABORTED: 'aborted',
  TIME_EXPIRED: 'time_expired',
};

/**
 * Fix cycle status for test-fix loops
 */
export const FixCycleStatus = {
  NOT_STARTED: 'not_started',
  IN_PROGRESS: 'in_progress',
  RESOLVED: 'resolved',
  MAX_ATTEMPTS_REACHED: 'max_attempts_reached',
};

export default {
  MessageType,
  AgentRole,
  AgentStatus,
  PlanDepth,
  VerificationType,
  WorkflowPhase,
  FixCycleStatus,
};
