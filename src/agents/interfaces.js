/**
 * Multi-Agent Architecture - Core Interfaces and Protocols
 *
 * This file re-exports all interface types from the modular structure.
 * The architecture follows a real-world development workflow:
 *
 * - Planner (Opus): Creates execution plans from goals
 * - Coder (Opus): Implements code based on plan steps
 * - Tester (Sonnet): Tests code and generates fix plans
 * - Supervisor (Sonnet): Verifies outputs and decides next actions
 *
 * Recursive re-planning supports up to 3 levels deep.
 */

// Re-export everything from the modular interfaces
export {
  // Enums and constants
  MessageType,
  AgentRole,
  AgentStatus,
  PlanDepth,
  VerificationType,
  WorkflowPhase,
  FixCycleStatus,
} from './interfaces/enums.js';

export { AgentMessage } from './interfaces/messages.js';

export { BaseAgent } from './interfaces/base-agent.js';

export { PlanStep, ExecutionPlan } from './interfaces/plan-types.js';

export { TestResult, VerificationResult } from './interfaces/result-types.js';

export {
  OrchestrationState,
  TimeBudgetManager,
  WorkflowLoop,
} from './interfaces/orchestration.js';

// Default export for backwards compatibility
import {
  MessageType,
  AgentRole,
  AgentStatus,
  PlanDepth,
  VerificationType,
  WorkflowPhase,
  FixCycleStatus,
} from './interfaces/enums.js';
import { AgentMessage } from './interfaces/messages.js';
import { BaseAgent } from './interfaces/base-agent.js';
import { PlanStep, ExecutionPlan } from './interfaces/plan-types.js';
import { TestResult, VerificationResult } from './interfaces/result-types.js';
import {
  OrchestrationState,
  TimeBudgetManager,
  WorkflowLoop,
} from './interfaces/orchestration.js';

export default {
  MessageType,
  AgentRole,
  AgentStatus,
  PlanDepth,
  VerificationType,
  WorkflowPhase,
  FixCycleStatus,
  AgentMessage,
  BaseAgent,
  PlanStep,
  ExecutionPlan,
  TestResult,
  VerificationResult,
  OrchestrationState,
  TimeBudgetManager,
  WorkflowLoop,
};
