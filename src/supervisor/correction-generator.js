/**
 * Correction Generator
 * Generates correction prompts for off-track worker responses
 */

/**
 * Generate a correction prompt based on assessment
 * @param {Object} assessment - The assessment result
 * @param {Object} context - Context for generating the correction
 * @returns {string|null} Correction prompt or null if none needed
 */
export function generateCorrection(assessment, context) {
  const { goal, phase, thresholds, consecutiveIssues, totalCorrections, avgScore } = context;

  switch (assessment.action) {
    case 'CONTINUE':
      return null;

    case 'REMIND':
      return generateReminder(assessment, goal, phase);

    case 'CORRECT':
      return generateCourseCorrection(assessment, goal, phase, consecutiveIssues, thresholds);

    case 'REFOCUS':
      return generateRefocus(assessment, goal, consecutiveIssues, thresholds);

    case 'CRITICAL':
      return generateCriticalWarning(assessment, goal, consecutiveIssues, thresholds, avgScore);

    case 'ABORT':
      return generateAbort(consecutiveIssues, totalCorrections, avgScore);

    default:
      return null;
  }
}

function generateReminder(assessment, goal, phase) {
  return `## Quick Reminder

${assessment.reason || 'Stay focused on the goal.'}

**Goal:** ${goal}
**Current focus:** ${phase}

Continue working.`;
}

function generateCourseCorrection(assessment, goal, phase, consecutiveIssues, thresholds) {
  const productiveWarning = !assessment.productive ? '⚠️ Take concrete action, not just planning.' : '';
  const relevantWarning = !assessment.relevant ? "⚠️ This work doesn't appear relevant to the goal." : '';

  return `## Course Correction

${assessment.reason || 'Your recent work may not be aligned with the goal.'}

**Your goal is:** ${goal}
**You should be working on:** ${phase}

Score: ${assessment.score}/100
Consecutive issues: ${consecutiveIssues}/${thresholds.abort}
${productiveWarning}
${relevantWarning}

Refocus and take your next action toward the goal.`;
}

function generateRefocus(assessment, goal, consecutiveIssues, thresholds) {
  return `## CRITICAL: REFOCUS REQUIRED

You have drifted from the assigned task for ${consecutiveIssues} consecutive responses.

**STOP ALL CURRENT WORK IMMEDIATELY.**

Your ONLY objective is: ${goal}

Before taking ANY action, you MUST:
1. Acknowledge this correction explicitly
2. State what you were doing wrong
3. List exactly 3 steps to get back on track
4. Execute the FIRST step immediately

WARNING: Continued drift will result in session termination.
Current alignment score: ${assessment.score}/100
Consecutive issues: ${consecutiveIssues}/${thresholds.abort}`;
}

function generateCriticalWarning(assessment, goal, consecutiveIssues, thresholds, avgScore) {
  return `## CRITICAL ESCALATION - FINAL WARNING

This is a CRITICAL escalation. You have failed to maintain goal focus for ${consecutiveIssues} consecutive responses.

Consecutive off-track responses: ${consecutiveIssues}/${thresholds.abort} (ABORT threshold)
Average alignment score: ${avgScore || assessment.score}/100

⚠️ ONE MORE OFF-TRACK RESPONSE WILL TERMINATE THIS SESSION ⚠️

You MUST immediately:
1. STOP all current work
2. Acknowledge you have drifted off-task
3. State the EXACT goal: "${goal}"
4. Take ONE concrete action directly toward that goal

This is not a suggestion. Failure to comply will result in session termination.`;
}

function generateAbort(consecutiveIssues, totalCorrections, avgScore) {
  return `## SESSION TERMINATED

This session is being terminated due to inability to maintain goal focus.

Final Statistics:
- Consecutive issues: ${consecutiveIssues}
- Total corrections issued: ${totalCorrections}
- Average alignment score: ${avgScore || 'N/A'}/100

Please provide a final summary of:
1. What was accomplished (if anything)
2. What went wrong
3. Recommendations for retry`;
}

/**
 * Check for stagnation based on idle time
 * @param {number} lastRelevantAction - Timestamp of last relevant action
 * @param {number} maxIdleMs - Maximum idle time in milliseconds
 * @param {Object} context - Context for stagnation check
 * @returns {Object} Stagnation check result
 */
export function checkStagnation(lastRelevantAction, maxIdleMs, context) {
  const { primaryGoal, consecutiveIssues, thresholds } = context;
  const idle = Date.now() - lastRelevantAction;

  if (idle > maxIdleMs) {
    return {
      isStagnant: true,
      idleTime: idle,
      prompt: `## Stagnation Alert

No significant progress detected for ${Math.round(idle / 60000)} minutes.

**Goal:** ${primaryGoal}
**Consecutive issues:** ${consecutiveIssues}/${thresholds.abort}

Are you stuck? If so:
1. Explain what's blocking you
2. Try an alternative approach
3. Move to the next sub-task if current one is blocked

Take action now. Continued stagnation will escalate to session termination.`,
    };
  }

  return { isStagnant: false };
}
