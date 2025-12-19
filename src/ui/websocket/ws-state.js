/**
 * WebSocket State Management
 *
 * Handles state creation, snapshots, and utility functions.
 */

/** Create the initial state structure */
export function createInitialState() {
  return {
    status: 'idle', // idle, initializing, planning, executing, verifying, completed, failed
    goal: null,
    subGoals: [],
    plan: null,
    currentStep: null,
    completedSteps: [],
    failedSteps: [],
    progress: 0,
    timeLimit: null,
    timeElapsed: 0,
    timeRemaining: null,
    iteration: 0,
    session: null,
    lastMessage: null,
    lastError: null,
    supervision: null,
    verification: null,
    retryMode: {
      enabled: false,
      currentAttempt: 0,
      maxAttempts: 0,
      attempts: [],
    },
    logs: [],
  };
}

/**
 * Create a deep snapshot of state for atomic broadcast.
 * Ensures all clients receive consistent state even during updates.
 */
export function createStateSnapshot(state) {
  return {
    ...state,
    plan: state.plan ? {
      ...state.plan,
      steps: state.plan.steps ? state.plan.steps.map(s => ({ ...s })) : [],
    } : null,
    completedSteps: [...state.completedSteps],
    failedSteps: state.failedSteps.map(s => ({ ...s })),
    subGoals: [...state.subGoals],
    logs: state.logs.map(l => ({ ...l })),
    lastMessage: state.lastMessage ? { ...state.lastMessage } : null,
    lastError: state.lastError ? { ...state.lastError } : null,
    supervision: state.supervision ? { ...state.supervision } : null,
    verification: state.verification ? { ...state.verification } : null,
    retryMode: {
      ...state.retryMode,
      attempts: state.retryMode.attempts.map(a => ({ ...a })),
    },
  };
}

/**
 * Update plan step status immutably.
 * Returns a new plan object with the step status updated.
 */
export function updatePlanStepStatus(plan, stepNumber, status, reason) {
  if (!plan?.steps) return plan;

  return {
    ...plan,
    steps: plan.steps.map(step => {
      if (step.number === stepNumber) {
        return {
          ...step,
          status,
          ...(reason ? { failReason: reason } : {}),
        };
      }
      return step;
    }),
  };
}

/**
 * Add a log entry to state. Returns new logs array.
 * Keeps logs limited to last 500 entries.
 */
export function addLogEntry(logs, level, message) {
  const log = {
    id: Date.now() + Math.random(),
    level,
    message,
    timestamp: Date.now(),
  };
  const newLogs = [...logs, log];
  return newLogs.length > 500 ? newLogs.slice(-500) : newLogs;
}

/**
 * Parse time limit string to milliseconds.
 * Supports formats: "30m", "2h", "1d"
 */
export function parseTimeLimit(str) {
  if (!str) return 0;
  const match = str.match(/^(\d+)(m|h|d)?$/);
  if (!match) return 2 * 60 * 60 * 1000; // default 2h

  const value = parseInt(match[1], 10);
  const unit = match[2] || 'h';
  const multipliers = { m: 60 * 1000, h: 60 * 60 * 1000, d: 24 * 60 * 60 * 1000 };
  return value * multipliers[unit];
}

export default {
  createInitialState,
  createStateSnapshot,
  updatePlanStepStatus,
  addLogEntry,
  parseTimeLimit,
};
