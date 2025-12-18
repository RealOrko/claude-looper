/**
 * Multi-Agent Architecture Module
 *
 * Exports all agent interfaces, message protocols, and orchestration components.
 */

// Core interfaces and data structures
export {
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
} from './interfaces.js';

// Message bus for inter-agent communication
export { MessageBus, Messages } from './message-bus.js';

// Main orchestration loop
export { Orchestrator } from './orchestrator.js';

// Agent implementations
export { PlannerAgent, PlanQualityAssessment, DependencyTracker } from './planner-agent.js';
export { CoderAgent, CodeOutput } from './coder-agent.js';
export {
  TesterAgent,
  TestExecutionResult,
  DetailedFixPlan,
  TestCoverageAnalysis,
  IssueSeverity,
  IssueCategory,
} from './tester-agent.js';
export {
  SupervisorAgent,
  EscalationLevel,
  QualityGateType,
  QualityThresholds,
  QualityGateResult,
  ProgressMonitor,
} from './supervisor-agent.js';

// Default export
import { Orchestrator } from './orchestrator.js';
export default Orchestrator;
