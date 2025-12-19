/**
 * Interfaces Module Index
 *
 * Re-exports all interface types for the multi-agent architecture.
 */

// Enums and constants
export {
  MessageType,
  AgentRole,
  AgentStatus,
  PlanDepth,
  VerificationType,
  WorkflowPhase,
  FixCycleStatus,
} from './enums.js';

// Message types
export { AgentMessage } from './messages.js';

// Base agent
export { BaseAgent } from './base-agent.js';

// Plan types
export { PlanStep, ExecutionPlan } from './plan-types.js';

// Result types
export { TestResult, VerificationResult } from './result-types.js';

// Orchestration types
export {
  OrchestrationState,
  TimeBudgetManager,
  WorkflowLoop,
} from './orchestration.js';
