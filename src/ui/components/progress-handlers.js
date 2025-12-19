/**
 * Progress Event Handlers - Handle progress events for the InkDashboard
 */

/**
 * Handle progress event and update state
 * @param {object} state - Dashboard state to update
 * @param {object} data - Progress event data
 * @param {Function} addLog - Function to add log entries
 * @returns {object} Updated state
 */
export function handleProgressEvent(state, data, addLog) {
  if (data?.type === 'started') {
    state.status = 'running';
    state.startTime = Date.now();
    addLog('info', 'Starting autonomous execution...');
  } else if (data.type === 'planning') {
    state.status = 'planning';
    addLog('info', data.message || 'Creating execution plan...');
  } else if (data.type === 'plan_created') {
    state.plan = data.plan;
    state.currentStep = 1;
    const stepCount = data.plan?.steps?.length || 0;
    addLog('success', `Plan created with ${stepCount} steps`);
  } else if (data.type === 'resuming') {
    addLog('info', data.message || 'Resuming session...');
  } else if (data.type === 'plan_restored') {
    handlePlanRestored(state, data, addLog);
  } else if (data.type === 'step_verification_pending') {
    if (data.step) {
      addLog('info', `Verifying step ${data.step.number}...`);
    }
  } else if (data.type === 'step_verification_started') {
    state.status = 'verifying';
  } else if (data.type === 'step_complete') {
    handleStepComplete(state, data, addLog);
  } else if (data.type === 'step_rejected') {
    state.status = 'running';
    if (data.step) {
      addLog('warning', `Step ${data.step.number} rejected: ${data.reason}`);
    }
  } else if (data.type === 'step_blocked_replanning') {
    if (data.step) {
      addLog('warning', `Step ${data.step.number} blocked, creating sub-plan...`);
    }
  } else if (data.type === 'subplan_creating') {
    state.status = 'planning';
    addLog('info', 'Creating alternative approach...');
  } else if (data.type === 'subplan_created') {
    handleSubplanCreated(state, data, addLog);
  } else if (data.type === 'subplan_failed') {
    handleSubplanFailed(state, data, addLog);
  } else if (data.type === 'step_failed') {
    handleStepFailed(state, data, addLog);
  } else if (data.type === 'step_blocked') {
    handleStepBlocked(state, data, addLog);
  } else if (data.type === 'iteration_complete') {
    handleIterationComplete(state, data);
  } else if (data.type === 'verification_started') {
    state.status = 'verifying';
    addLog('info', 'Verifying completion claim...');
  } else if (data.type === 'plan_review_started') {
    addLog('info', 'Reviewing execution plan...');
  } else if (data.type === 'plan_review_complete') {
    const status = data.review?.approved ? 'approved' : 'flagged';
    addLog(data.review?.approved ? 'success' : 'warning', `Plan review: ${status}`);
  } else if (data.type === 'plan_review_warning') {
    handlePlanReviewWarning(data, addLog);
  } else if (data.type === 'final_verification_started') {
    state.status = 'verifying';
    addLog('info', 'Running final verification...');
  } else if (data.type === 'goal_verification_complete') {
    handleGoalVerificationComplete(data, addLog);
  } else if (data.type === 'final_verification_passed') {
    state.status = 'completed';
    addLog('success', 'Final verification PASSED');
  } else if (data.type === 'final_verification_failed') {
    state.status = 'error';
    addLog('error', `Final verification FAILED: ${data.reason?.substring(0, 60) || 'see report'}`);
  }

  return state;
}

function handlePlanRestored(state, data, addLog) {
  state.plan = data.plan;
  state.currentStep = data.currentStep || 1;
  const completed = data.completedSteps?.length || 0;
  const total = data.plan?.steps?.length || 0;
  state.progress = total > 0 ? Math.round((completed / total) * 100) : 0;
  addLog('success', `Resumed: ${completed}/${total} steps completed, continuing from step ${state.currentStep}`);
}

function handleStepComplete(state, data, addLog) {
  state.status = 'running';
  if (data.step) {
    const verified = data.verification ? ' (verified)' : '';
    addLog('success', `Step ${data.step.number} complete${verified}`);
    if (state.plan && state.plan.steps) {
      const stepIndex = state.plan.steps.findIndex(s => s.number === data.step.number);
      if (stepIndex >= 0) {
        state.plan.steps[stepIndex].status = 'completed';
      }
    }
  }
  if (data.progress) {
    state.currentStep = data.progress.current;
    state.progress = data.progress.percentComplete;
  }
}

function handleSubplanCreated(state, data, addLog) {
  state.status = 'running';
  const stepCount = data.subPlan?.steps?.length || 0;
  addLog('success', `Sub-plan created with ${stepCount} sub-steps`);
  state.subPlan = data.subPlan;
  state.subPlanParent = data.parentStep;
}

function handleSubplanFailed(state, data, addLog) {
  state.status = 'running';
  state.subPlan = null;
  state.subPlanParent = null;
  if (data.step) {
    addLog('error', `Sub-plan failed: ${data.reason}`);
  }
  if (data.progress) {
    state.currentStep = data.progress.current;
    state.progress = data.progress.percentComplete;
  }
}

function handleStepFailed(state, data, addLog) {
  if (data.step) {
    addLog('error', `Step ${data.step.number} failed: ${data.reason}`);
    if (state.plan && state.plan.steps) {
      const stepIndex = state.plan.steps.findIndex(s => s.number === data.step.number);
      if (stepIndex >= 0) {
        state.plan.steps[stepIndex].status = 'failed';
        state.plan.steps[stepIndex].failReason = data.reason;
      }
    }
  }
  if (data.progress) {
    state.currentStep = data.progress.current;
    state.progress = data.progress.percentComplete;
  }
}

function handleStepBlocked(state, data, addLog) {
  if (data.step) {
    addLog('warning', `Step ${data.step.number} blocked: ${data.reason}`);
  }
  if (data.progress) {
    state.currentStep = data.progress.current;
  }
}

function handleIterationComplete(state, data) {
  state.iteration = data.iteration;
  state.progress = data.planProgress?.percentComplete || data.progress?.overallProgress || 0;
  state.sessionId = data.sessionId;
  if (data.time) {
    state.elapsed = data.time.elapsedMs || 0;
    state.remaining = data.time.remaining || '';
  }
  if (data.planProgress) {
    state.currentStep = data.planProgress.current;
  }
}

function handlePlanReviewWarning(data, addLog) {
  if (data.issues?.length > 0) {
    addLog('warning', `Plan issues: ${data.issues.slice(0, 2).join(', ')}`);
  }
  if (data.missingSteps?.length > 0) {
    addLog('warning', `Missing steps: ${data.missingSteps.slice(0, 2).join(', ')}`);
  }
}

function handleGoalVerificationComplete(data, addLog) {
  const result = data.result;
  if (result?.achieved) {
    addLog('success', `Goal verified (${result.confidence} confidence)`);
  } else {
    addLog('warning', `Goal not verified: ${result?.reason?.substring(0, 60) || 'unknown'}`);
  }
}

export default { handleProgressEvent };
