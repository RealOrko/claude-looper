/**
 * WebSocket message handlers - Process different message types
 */
import { initialState, detectStepChanges } from './initialState.js';

/** Merge metrics from server state with client-side metrics */
export function mergeMetrics(prevMetrics, newState) {
  return {
    ...prevMetrics,
    ...newState.metrics,
    supervisionChecks: prevMetrics?.supervisionChecks ?? 0,
    interventions: prevMetrics?.interventions ?? 0,
    stepsCompleted: newState.completedSteps?.length || newState.metrics?.stepsCompleted || 0,
    stepsFailed: newState.failedSteps?.length || newState.metrics?.stepsFailed || 0,
    iterations: newState.iteration || newState.metrics?.iterations || 0,
    elapsedTime: newState.timeElapsed || newState.metrics?.elapsedTime || 0,
  };
}

/** Handle full state updates (init, state, stateUpdate) */
export function handleStateMessage(prev, messageData) {
  const newState = messageData || initialState;
  const stepChanges = detectStepChanges(prev.plan, newState.plan);
  const mergedMetrics = mergeMetrics(prev.metrics, newState);

  return {
    ...newState,
    errors: prev.errors || [],
    metrics: mergedMetrics,
    stepChanges: {
      lastUpdated: Date.now(),
      ...stepChanges,
    },
  };
}

/** Handle history message - rebuild logs from event history */
export function handleHistoryMessage(prev, historyData) {
  if (!Array.isArray(historyData)) return prev;

  const logs = historyData
    .filter(e => e.type === 'message' || e.type === 'progress')
    .map(e => ({
      id: e.timestamp + Math.random(),
      timestamp: e.timestamp,
      level: e.type === 'message' ? 'output' : 'info',
      message: e.data?.content?.substring(0, 200) || e.data?.message || '',
      full: e.data?.content,
    }));

  return {
    ...prev,
    logs: [...prev.logs, ...logs].slice(-1000),
  };
}

/** Handle progress message - extract specific fields */
export function handleProgressMessage(prev, eventData, timestamp) {
  const eventType = eventData?.type;

  const logEntry = {
    id: Date.now() + Math.random(),
    timestamp,
    level: getProgressLogLevel(eventType),
    message: eventData?.message || eventType?.replace(/_/g, ' ') || 'progress update',
  };

  const updates = extractProgressUpdates(prev, eventData, eventType);

  return {
    ...prev,
    ...updates,
    logs: [...prev.logs.slice(-999), logEntry],
  };
}

function getProgressLogLevel(eventType) {
  if (eventType?.includes('failed') || eventType?.includes('error')) return 'error';
  if (eventType?.includes('complete') || eventType?.includes('passed')) return 'success';
  if (eventType?.includes('warning') || eventType?.includes('blocked')) return 'warning';
  return 'info';
}

function extractProgressUpdates(prev, eventData, eventType) {
  const updates = {};

  if (eventData?.iteration !== undefined) {
    updates.iteration = eventData.iteration;
    updates.metrics = { ...prev.metrics, iterations: eventData.iteration };
  }

  if (eventData?.planProgress?.percentComplete !== undefined) {
    updates.progress = eventData.planProgress.percentComplete;
  } else if (eventData?.progress?.overallProgress !== undefined) {
    updates.progress = eventData.progress.overallProgress;
  } else if (typeof eventData?.progress === 'number') {
    updates.progress = eventData.progress;
  }

  if (eventData?.planProgress?.current !== undefined) {
    updates.currentStep = eventData.planProgress.current;
  }

  if (eventData?.time?.elapsedMs !== undefined) {
    updates.timeElapsed = eventData.time.elapsedMs;
    updates.metrics = { ...(updates.metrics || prev.metrics), elapsedTime: eventData.time.elapsedMs };
  } else if (eventData?.elapsed !== undefined) {
    updates.timeElapsed = eventData.elapsed;
  }

  if (eventData?.time?.remaining !== undefined) {
    updates.timeRemaining = eventData.time.remaining;
  } else if (eventData?.remaining !== undefined) {
    updates.timeRemaining = eventData.remaining;
  }

  if (eventData?.sessionId !== undefined) {
    updates.session = eventData.sessionId;
  }

  // Handle status changes
  if (eventType === 'planning' || eventType === 'plan_created') {
    updates.status = eventType === 'planning' ? 'planning' : 'executing';
  } else if (eventType === 'verification_started' || eventType === 'step_verification_started') {
    updates.status = 'verifying';
  } else if (eventType === 'final_verification_passed') {
    updates.status = 'completed';
  } else if (eventType === 'final_verification_failed') {
    updates.status = 'failed';
  }

  return updates;
}

/** Handle regular message (adds to logs) */
export function handleMessageMessage(prev, data, timestamp) {
  const newLog = {
    id: Date.now() + Math.random(),
    timestamp,
    level: 'output',
    message: data?.content?.substring(0, 500) || '',
    full: data?.content,
    iteration: data?.iteration,
  };

  return {
    ...prev,
    logs: [...prev.logs.slice(-999), newLog],
  };
}

/** Handle error message */
export function handleErrorMessage(prev, data, timestamp) {
  return {
    ...prev,
    errors: [...prev.errors, {
      error: data?.error,
      retry: data?.retry,
      timestamp,
    }],
  };
}

/** Handle supervision message */
export function handleSupervisionMessage(prev, data) {
  return {
    ...prev,
    supervision: data,
    metrics: {
      ...prev.metrics,
      supervisionChecks: (prev.metrics?.supervisionChecks ?? 0) + 1,
      interventions: data?.needsIntervention
        ? (prev.metrics?.interventions ?? 0) + 1
        : (prev.metrics?.interventions ?? 0),
    },
  };
}

/** Handle escalation message */
export function handleEscalationMessage(prev, data, timestamp) {
  const newLog = {
    id: Date.now() + Math.random(),
    timestamp,
    level: 'error',
    message: `Escalation (${data?.type}): ${data?.message || ''}`,
  };

  return {
    ...prev,
    logs: [...prev.logs.slice(-999), newLog],
  };
}

/** Handle verification message */
export function handleVerificationMessage(prev, data) {
  return { ...prev, verification: data };
}

/** Handle complete message */
export function handleCompleteMessage(prev, data) {
  return {
    ...prev,
    status: data?.status === 'completed' ? 'completed' : 'failed',
    finalReport: data,
  };
}

/** Handle metrics message */
export function handleMetricsMessage(prev, data) {
  return { ...prev, serverMetrics: data };
}

export default {
  handleStateMessage,
  handleHistoryMessage,
  handleProgressMessage,
  handleMessageMessage,
  handleErrorMessage,
  handleSupervisionMessage,
  handleEscalationMessage,
  handleVerificationMessage,
  handleCompleteMessage,
  handleMetricsMessage,
  mergeMetrics,
};
