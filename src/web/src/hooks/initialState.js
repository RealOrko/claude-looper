/**
 * Initial state for WebSocket connection
 */

export const initialState = {
  status: 'idle',
  goal: null,
  subGoals: [],
  timeLimit: null,
  plan: null,
  currentStep: null,
  completedSteps: [],
  failedSteps: [],
  logs: [],
  progress: 0,
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
  errors: [],
  stepChanges: {
    lastUpdated: null,
    changedSteps: [],
    newSteps: [],
    statusTransitions: [],
  },
  metrics: {
    iterations: 0,
    tokensIn: 0,
    tokensOut: 0,
    startTime: null,
    elapsedTime: 0,
    stepsCompleted: 0,
    stepsFailed: 0,
    supervisionChecks: 0,
    interventions: 0,
  },
};

/**
 * Helper to detect step changes between old and new plan state
 * @param {object} prevPlan - Previous plan state
 * @param {object} newPlan - New plan state
 * @returns {object} Step changes object
 */
export function detectStepChanges(prevPlan, newPlan) {
  const changedSteps = [];
  const newSteps = [];
  const statusTransitions = [];

  if (!newPlan?.steps) {
    return { changedSteps, newSteps, statusTransitions };
  }

  const prevStepsMap = new Map(
    (prevPlan?.steps || []).map(s => [s.number, s])
  );

  for (const step of newPlan.steps) {
    const prevStep = prevStepsMap.get(step.number);

    if (!prevStep) {
      newSteps.push(step.number);
      changedSteps.push(step.number);
    } else if (prevStep.status !== step.status) {
      changedSteps.push(step.number);
      statusTransitions.push({
        stepNumber: step.number,
        from: prevStep.status,
        to: step.status,
        timestamp: Date.now(),
      });
    }
  }

  return { changedSteps, newSteps, statusTransitions };
}

export default { initialState, detectStepChanges };
