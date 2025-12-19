/**
 * Output Handlers - CLI output formatters for different modes
 *
 * Handles:
 * - JSON mode output
 * - Quiet mode output
 * - Verbose mode output
 */

import { colors, style } from './ui/terminal.js';

/** Simple log for non-dashboard modes */
export function log(message, type = 'reset') {
  const typeColors = {
    reset: style.reset, red: colors.red, green: colors.green,
    yellow: colors.yellow, cyan: colors.cyan, dim: colors.gray,
  };
  console.log(`${typeColors[type] || style.reset}${message}${style.reset}`);
}

// JSON mode handlers
export const jsonHandlers = {
  progress: (data) => console.log(JSON.stringify({ type: 'progress', ...data })),
  message: (data) => console.log(JSON.stringify({ type: 'message', iteration: data.iteration })),
  error: (data) => console.log(JSON.stringify({ type: 'error', ...data })),
  supervision: (data) => console.log(JSON.stringify({ type: 'supervision', ...data })),
  escalation: (data) => console.log(JSON.stringify({ type: 'escalation', ...data })),
  verification: (data) => console.log(JSON.stringify({ type: 'verification', ...data })),
  complete: (report) => console.log(JSON.stringify({ type: 'complete', ...report })),
};

// Quiet mode handlers
export const quietHandlers = {
  progress: () => {},
  message: () => {},
  error: (data) => console.error(`Error: ${data.error}`),
  supervision: () => {},
  escalation: () => {},
  verification: () => {},
  complete: (report) => {
    console.log(`Status: ${report.status}`);
    console.log(`Progress: ${report.goal?.progress || 0}%`);
    console.log(`Iterations: ${report.session?.iterations || 0}`);
    if (report.abortReason) console.log(`Abort Reason: ${report.abortReason}`);
  },
};

// Verbose mode handlers
export const verboseHandlers = {
  progress: verboseProgress,
  message: (data) => {
    console.log(`\n[CLAUDE OUTPUT - Iteration ${data.iteration}]`);
    console.log('─'.repeat(60));
    console.log(data.content || '(no content)');
    console.log('─'.repeat(60));
  },
  error: (data) => {
    console.error(`\n[ERROR] ${data.error}`);
    if (data.retry) console.error(`  Retry attempt: ${data.retry}`);
  },
  supervision: (data) => {
    const a = data.assessment || {};
    console.log(`\n[SUPERVISION] Action: ${a.action || 'unknown'}, Score: ${a.score || 'N/A'}`);
    if (a.reason) console.log(`  Reason: ${a.reason}`);
    if (data.consecutiveIssues) console.log(`  Consecutive issues: ${data.consecutiveIssues}`);
  },
  escalation: (data) => {
    console.log(`\n[ESCALATION] Type: ${data.type}`);
    if (data.message) console.log(`  Message: ${data.message}`);
  },
  verification: (data) => {
    console.log(`\n[VERIFICATION] Passed: ${data.passed}`);
    if (data.layers) console.log(`  Layers: ${JSON.stringify(data.layers, null, 2)}`);
  },
  complete: verboseComplete,
};

function verboseProgress(data) {
  console.log(`\n[PROGRESS] ${data.type || 'update'}`);
  const handlers = {
    planning: () => console.log(`  ${data.message || 'Creating execution plan...'}`),
    plan_created: () => {
      console.log(`  Plan created with ${data.plan?.steps?.length || 0} steps`);
      data.plan?.steps?.forEach(s => console.log(`    ${s.number}. ${s.description} [${s.complexity}]`));
    },
    step_verification_pending: () => console.log(`  ⋯ Verifying step ${data.step?.number}...`),
    step_verification_started: () => console.log(`  ⋯ Step verification in progress...`),
    step_complete: () => {
      const verified = data.verification ? ' (verified)' : '';
      console.log(`  ✓ Step ${data.step?.number} complete${verified}: ${data.step?.description}`);
    },
    step_rejected: () => console.log(`  ✗ Step ${data.step?.number} rejected: ${data.reason}`),
    step_blocked_replanning: () => console.log(`  ⚠ Step ${data.step?.number} blocked, creating sub-plan...`),
    subplan_creating: () => console.log(`  ⋯ Creating alternative approach...`),
    subplan_created: () => {
      console.log(`  ✓ Sub-plan created with ${data.subPlan?.steps?.length || 0} sub-steps`);
      data.subPlan?.steps?.forEach(s => console.log(`      ${s.number}. ${s.description}`));
    },
    subplan_failed: () => console.log(`  ✗ Sub-plan failed: ${data.reason}`),
    step_failed: () => console.log(`  ✗ Step ${data.step?.number} failed: ${data.reason}`),
    step_blocked: () => console.log(`  ✗ Step ${data.step?.number} blocked: ${data.reason}`),
    plan_review_started: () => console.log(`  ⋯ Reviewing execution plan...`),
    plan_review_complete: () => console.log(`  ${data.review?.approved ? '✓ approved' : '⚠ flagged'}`),
    plan_review_warning: () => {
      if (data.issues?.length) console.log(`  ⚠ Plan issues: ${data.issues.join(', ')}`);
      if (data.missingSteps?.length) console.log(`  ⚠ Missing steps: ${data.missingSteps.join(', ')}`);
      if (data.suggestions?.length) console.log(`  💡 Suggestions: ${data.suggestions.join(', ')}`);
    },
    final_verification_started: () => console.log(`  ⋯ Running final verification...`),
    goal_verification_complete: () => {
      const r = data.result;
      console.log(`  ${r?.achieved ? '✓' : '✗'} Goal verified: ${r?.achieved ? 'Yes' : 'No'} (${r?.confidence || 'unknown'} confidence)`);
      if (r?.gaps) console.log(`    Gaps: ${r.gaps}`);
      console.log(`    Recommendation: ${r?.recommendation || 'unknown'}`);
    },
    final_verification_passed: () => console.log(`  ✓ FINAL VERIFICATION PASSED`),
    final_verification_failed: () => console.log(`  ✗ FINAL VERIFICATION FAILED: ${data.reason || 'see report'}`),
    retry_loop_started: () => console.log(`\n[RETRY MODE] Max attempts: ${data.maxAttempts}, Time limit: ${Math.round(data.overallTimeLimit / 60000)}m`),
    attempt_starting: () => {
      console.log(`\n${'─'.repeat(60)}`);
      console.log(`[ATTEMPT ${data.attemptNumber}/${data.maxAttempts}] Starting...`);
      console.log(`  Time remaining: ${Math.round(data.timeRemaining / 60000)}m`);
      console.log(`  Time budget: ${Math.round(data.timeLimitForAttempt / 60000)}m`);
      if (data.hasFailureContext) console.log(`  Building on previous attempt(s)`);
    },
    attempt_completed: () => {
      const icon = data.confidence === 'HIGH' ? '✓' : data.passed ? '◐' : '✗';
      console.log(`\n[ATTEMPT ${data.attemptNumber}] ${icon} Completed`);
      console.log(`  Status: ${data.status}, Confidence: ${data.confidence}`);
      console.log(`  Steps: ${data.completedSteps} completed, ${data.failedSteps} failed`);
      console.log(`  Duration: ${Math.round(data.duration / 1000)}s`);
      if (data.willRetry) console.log(`  → Will retry (confidence not HIGH)`);
    },
    retry_loop_completed: () => {
      console.log(`\n${'═'.repeat(60)}`);
      console.log(`[RETRY LOOP COMPLETE] Attempts: ${data.totalAttempts}, Confidence: ${data.finalConfidence}`);
      console.log(`  Success: ${data.overallSuccess ? 'Yes' : 'No'}, Duration: ${Math.round(data.totalDuration / 1000)}s`);
    },
    time_exhausted: () => console.log(`\n[TIME EXHAUSTED] Completed ${data.totalAttempts} attempt(s)`),
  };

  if (handlers[data.type]) {
    handlers[data.type]();
  } else {
    if (data.iteration) console.log(`  Iteration: ${data.iteration}`);
    if (data.planProgress) console.log(`  Plan: ${data.planProgress.current}/${data.planProgress.total} steps`);
    if (data.progress) console.log(`  Progress: ${JSON.stringify(data.progress)}`);
    if (data.sessionId) console.log(`  Session: ${data.sessionId}`);
  }
}

function verboseComplete(report) {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`[COMPLETE] Status: ${report.status}`);
  console.log(`  Progress: ${report.goal?.progress || 0}%`);
  console.log(`  Iterations: ${report.session?.iterations || 0}`);
  console.log(`  Time: ${report.time?.elapsed || 'N/A'}`);

  if (report.plan) {
    console.log(`  Plan: ${report.plan.completed}/${report.plan.totalSteps} steps completed`);
    if (report.plan.failed > 0) {
      console.log(`  Failed Steps: ${report.plan.failed}`);
      for (const step of report.plan.steps || []) {
        if (step.status === 'failed' && step.failReason) {
          console.log(`    ✗ Step ${step.number}: ${step.failReason}`);
        }
      }
    }
  }

  if (report.finalVerification) {
    const fv = report.finalVerification;
    console.log(`\n  Final Verification:`);
    console.log(`    ${fv.goalAchieved ? '✓' : '✗'} Goal Achieved: ${fv.goalAchieved ? 'Yes' : 'No'}`);
    console.log(`      Confidence: ${fv.confidence || 'Unknown'}`);
    console.log(`      Recommendation: ${fv.recommendation || 'Unknown'}`);
    if (fv.gaps) console.log(`    ⚠ Gaps: ${fv.gaps}`);
    console.log(`    ${fv.overallPassed ? '✓' : '✗'} Overall: ${fv.overallPassed ? 'PASSED' : 'FAILED'}`);
  }

  if (report.abortReason) console.log(`  Abort Reason: ${report.abortReason}`);
  console.log('═'.repeat(60));
}

/** Get handlers based on output mode */
export function getHandlers(mode) {
  switch (mode) {
    case 'json': return jsonHandlers;
    case 'quiet': return quietHandlers;
    case 'verbose': return verboseHandlers;
    default: return {};
  }
}

export default { log, jsonHandlers, quietHandlers, verboseHandlers, getHandlers };
