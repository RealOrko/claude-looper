/**
 * WebSocket Progress Event Handler - Handles progress events and updates state.
 */

import { createInitialState, updatePlanStepStatus, addLogEntry } from './ws-state.js';

/**
 * Handle progress events and update state.
 * @param {object} state - Current state
 * @param {object} data - Progress event data
 * @param {object} callbacks - Optional { onStartTimeUpdates, onStopTimeUpdates }
 * @returns {object} Updated state
 */
export function handleProgressEvent(state, data, callbacks = {}) {
  const type = data.type;
  let newState = { ...state };

  switch (type) {
    case 'initialized':
      newState = {
        ...createInitialState(), status: 'initializing', goal: data.goal,
        subGoals: data.subGoals || [], timeLimit: data.timeLimit,
        session: data.sessionId, workingDirectory: data.workingDirectory,
      };
      newState.logs = addLogEntry(newState.logs, 'info', 'Agent initialized');
      break;
    case 'started':
      newState.status = 'executing';
      newState.timeElapsed = 0;
      newState.logs = addLogEntry(newState.logs, 'info', 'Execution started');
      callbacks.onStartTimeUpdates?.();
      break;
    case 'planning':
      newState.status = 'planning';
      newState.logs = addLogEntry(newState.logs, 'info', data.message || 'Creating execution plan...');
      callbacks.onStartTimeUpdates?.();
      break;
    case 'plan_created':
      newState.plan = data.plan;
      newState.status = 'executing';
      newState.logs = addLogEntry(newState.logs, 'info', `Plan created with ${data.plan?.steps?.length || 0} steps`);
      break;
    case 'step_started':
      newState.currentStep = data.step;
      newState.logs = addLogEntry(newState.logs, 'info', `Starting step ${data.step?.number}: ${data.step?.description}`);
      break;
    case 'step_complete':
      newState.completedSteps = [...newState.completedSteps, data.step];
      newState.currentStep = null;
      newState.plan = updatePlanStepStatus(newState.plan, data.step?.number, 'completed');
      newState.logs = addLogEntry(newState.logs, 'success', `Completed step ${data.step?.number}: ${data.step?.description}`);
      break;
    case 'step_failed':
    case 'step_rejected':
      newState.failedSteps = [...newState.failedSteps, { ...data.step, reason: data.reason }];
      newState.currentStep = null;
      newState.plan = updatePlanStepStatus(newState.plan, data.step?.number, 'failed', data.reason);
      newState.logs = addLogEntry(newState.logs, 'error', `Failed step ${data.step?.number}: ${data.reason}`);
      break;
    case 'step_blocked':
      newState.plan = updatePlanStepStatus(newState.plan, data.step?.number, 'blocked', data.reason);
      newState.logs = addLogEntry(newState.logs, 'warning', `Blocked step ${data.step?.number}: ${data.reason}`);
      break;
    case 'step_verification_pending':
    case 'step_verification_started':
      newState.logs = addLogEntry(newState.logs, 'info', `Verifying step ${data.step?.number}...`);
      break;
    case 'subplan_created':
      newState.logs = addLogEntry(newState.logs, 'info', `Sub-plan created with ${data.subPlan?.steps?.length || 0} sub-steps`);
      break;
    case 'final_verification_started':
      newState.status = 'verifying';
      newState.logs = addLogEntry(newState.logs, 'info', 'Running final verification...');
      break;
    case 'goal_verification_complete': {
      newState.verification = { ...newState.verification, goal: data.result };
      const icon = data.result?.achieved ? '✓' : '✗';
      const lvl = data.result?.achieved ? 'success' : 'warning';
      newState.logs = addLogEntry(newState.logs, lvl, `${icon} Goal: ${data.result?.achieved ? 'Achieved' : 'Not achieved'} (${data.result?.confidence})`);
      break;
    }
    case 'final_verification_passed':
      newState.logs = addLogEntry(newState.logs, 'success', 'FINAL VERIFICATION PASSED');
      break;
    case 'final_verification_failed':
      newState.logs = addLogEntry(newState.logs, 'error', `FINAL VERIFICATION FAILED: ${data.reason || 'see report'}`);
      break;
    case 'retry_loop_started':
      newState.retryMode = { enabled: true, currentAttempt: 0, maxAttempts: data.maxAttempts, overallTimeLimit: data.overallTimeLimit, attempts: [] };
      newState.logs = addLogEntry(newState.logs, 'info', `Retry mode: Max ${data.maxAttempts} attempts`);
      break;
    case 'attempt_starting':
      newState.retryMode = { ...newState.retryMode, currentAttempt: data.attemptNumber, timeRemaining: data.timeRemaining };
      newState.logs = addLogEntry(newState.logs, 'info', `Starting attempt ${data.attemptNumber}/${data.maxAttempts}`);
      break;
    case 'attempt_completed': {
      newState.retryMode = {
        ...newState.retryMode,
        attempts: [...newState.retryMode.attempts, { number: data.attemptNumber, status: data.status, confidence: data.confidence, duration: data.duration, completedSteps: data.completedSteps, failedSteps: data.failedSteps }],
      };
      newState.logs = addLogEntry(newState.logs, data.confidence === 'HIGH' ? 'success' : 'info', `Attempt ${data.attemptNumber}: ${data.confidence} confidence`);
      break;
    }
    case 'retry_loop_completed': {
      newState.status = data.overallSuccess ? 'completed' : 'failed';
      newState.logs = addLogEntry(newState.logs, data.overallSuccess ? 'success' : 'warning', `Retry loop complete: ${data.finalConfidence} confidence after ${data.totalAttempts} attempts`);
      callbacks.onStopTimeUpdates?.();
      break;
    }
    case 'time_exhausted':
      newState.logs = addLogEntry(newState.logs, 'warning', `Time exhausted after ${data.totalAttempts} attempts`);
      break;
    case 'fix_cycle_started':
      newState.logs = addLogEntry(newState.logs, 'info', `Fix cycle ${data.cycle}: ${data.issues?.length || 0} issues`);
      break;
  }

  // Update progress/timing/iteration
  if (data.planProgress) newState.progress = Math.round((data.planProgress.current / data.planProgress.total) * 100);
  if (data.progress !== undefined) newState.progress = data.progress;
  if (data.elapsed !== undefined) newState.timeElapsed = data.elapsed;
  if (data.remaining !== undefined) newState.timeRemaining = data.remaining;
  if (data.iteration !== undefined) newState.iteration = data.iteration;

  return newState;
}

/** Handle message event and update state. */
export function handleMessageEvent(state, data) {
  return {
    ...state,
    lastMessage: { content: data.content, iteration: data.iteration, timestamp: Date.now() },
    iteration: data.iteration || state.iteration,
    logs: addLogEntry(state.logs, 'message', data.content?.substring(0, 200) + '...'),
  };
}

/** Handle error event and update state. */
export function handleErrorEvent(state, data) {
  return {
    ...state,
    lastError: { error: data.error, timestamp: Date.now() },
    logs: addLogEntry(state.logs, 'error', data.error),
  };
}

/** Handle supervision event and update state. */
export function handleSupervisionEvent(state, data) {
  return {
    ...state,
    supervision: data,
    logs: addLogEntry(state.logs, 'supervision', `${data.assessment?.action || 'unknown'}: ${data.assessment?.reason || ''}`),
  };
}

/** Handle escalation event and update state. */
export function handleEscalationEvent(state, data) {
  return { ...state, logs: addLogEntry(state.logs, 'escalation', data.message || data.type) };
}

/** Handle verification event and update state. */
export function handleVerificationEvent(state, data) {
  return { ...state, verification: data, logs: addLogEntry(state.logs, 'verification', `Passed: ${data.passed}`) };
}

/** Handle complete event and update state. */
export function handleCompleteEvent(state, data, callbacks = {}) {
  callbacks.onStopTimeUpdates?.();
  return {
    ...state,
    status: data.status === 'completed' ? 'completed' : 'failed',
    finalReport: data,
    logs: addLogEntry(state.logs, 'complete', `Status: ${data.status}`),
  };
}

export default {
  handleProgressEvent, handleMessageEvent, handleErrorEvent,
  handleSupervisionEvent, handleEscalationEvent, handleVerificationEvent, handleCompleteEvent,
};
