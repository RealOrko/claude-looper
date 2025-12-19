/**
 * Gap Plan Builder
 * Builds context and plans for addressing verification gaps
 */

/**
 * Build verification details string
 * @param {Object} cycleVerification - Cycle verification result
 * @returns {string} Formatted verification details
 */
export function buildVerificationDetails(cycleVerification) {
  if (!cycleVerification) return '';

  const gv = cycleVerification.goalVerification || {};
  return `
- Goal achieved: ${gv.achieved || 'unknown'}
- Confidence: ${gv.confidence || 'unknown'}
- Functional: ${gv.functional || 'unknown'}
- Verification gaps: ${gv.gaps || 'none specified'}
- Recommendation: ${gv.recommendation || 'none'}`;
}

/**
 * Build gap context for new plan creation
 * @param {number} cycle - Current goal achievement cycle
 * @param {Object} progress - Current progress object with completed/total
 * @param {Array} failedSteps - Array of failed step objects
 * @param {string} gaps - Gap description string
 * @param {string} verificationDetails - Formatted verification details
 * @returns {string} Formatted gap context
 */
export function buildGapContext(cycle, progress, failedSteps, gaps, verificationDetails) {
  const failedDescriptions = failedSteps.map(s => s.description).join(', ') || 'none';

  return `
PREVIOUS ATTEMPT (Cycle ${cycle}):
- Completed: ${progress.completed}/${progress.total} steps
- Failed steps: ${failedDescriptions}
${verificationDetails}

CRITICAL GAPS TO ADDRESS:
${gaps}

YOUR TASK: The goal was NOT achieved. Address the gaps above and complete the goal. Focus on what's missing or broken.`;
}

/**
 * Extract gaps string from verification and failed steps
 * @param {Object} cycleVerification - Cycle verification result
 * @param {Array} failedSteps - Array of failed step objects
 * @returns {string} Gap description string
 */
export function extractGaps(cycleVerification, failedSteps) {
  const verificationGaps = cycleVerification?.goalVerification?.gaps;
  if (verificationGaps) {
    return verificationGaps;
  }
  if (failedSteps.length > 0) {
    return failedSteps.map(s => s.description).join(', ');
  }
  return 'verification failed';
}

/**
 * Build sub-plan prompt for blocked step
 * @param {Object} pendingSubPlan - Pending sub-plan info with step and reason
 * @param {Object} subPlan - Created sub-plan with steps array
 * @returns {string} Formatted prompt for sub-plan execution
 */
export function buildSubPlanPrompt(pendingSubPlan, subPlan) {
  const stepList = subPlan.steps.map(s => `${s.number}. ${s.description}`).join('\n');
  const firstStep = subPlan.steps[0]?.description;

  return `## Alternative Approach Required

The previous step was blocked: "${pendingSubPlan.reason}"

I've created an alternative approach with ${subPlan.totalSteps} sub-steps:
${stepList}

Let's start with sub-step 1: ${firstStep}

Begin working on this sub-step now.`;
}
