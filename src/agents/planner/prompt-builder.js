/**
 * Prompt Builder Module
 *
 * Builds prompts for plan generation and re-planning.
 */

import { MIN_PLAN_STEPS, MAX_PLAN_STEPS, MAX_SUBPLAN_STEPS } from './quality-assessment.js';

/**
 * Build the main planning prompt
 * @param {string} goal - The goal to plan for
 * @param {Object} context - Additional context
 * @returns {string} The planning prompt
 */
export function buildPlanningPrompt(goal, context = {}) {
  const contextSection = context.additionalContext
    ? `\n## ADDITIONAL CONTEXT\n${context.additionalContext}`
    : '';

  const workingDir = context.workingDirectory || process.cwd();

  return `You are an expert software architect and planner. Your task is to analyze a goal and create a detailed, executable plan.

## GOAL
${goal}
${contextSection}

## WORKING DIRECTORY
${workingDir}

## PLANNING GUIDELINES

1. **Analyze First**: Before creating steps, briefly analyze:
   - What is the core objective?
   - What are the key components needed?
   - What dependencies exist between components?
   - What could potentially block progress?

2. **Create Actionable Steps**: Each step must be:
   - Concrete and specific (not vague like "implement feature")
   - Independently completable
   - Testable/verifiable
   - In logical dependency order

3. **Estimate Complexity**: Rate each step:
   - **simple**: Single file change, straightforward logic (< 30 min)
   - **medium**: Multiple files, moderate logic (30 min - 2 hours)
   - **complex**: Architectural changes, complex logic (2+ hours)

4. **Consider Testing**: Include testing steps where appropriate

5. **Step Count**: Create ${MIN_PLAN_STEPS}-${MAX_PLAN_STEPS} steps. Combine trivial steps, split complex ones.

## OUTPUT FORMAT

Respond in EXACTLY this format:

ANALYSIS:
[2-4 sentences analyzing the goal, key challenges, and approach]

PLAN:
1. [Step description] | [simple/medium/complex]
2. [Step description] | [simple/medium/complex]
3. [Step description] | [simple/medium/complex]
...

DEPENDENCIES:
[List any external dependencies or prerequisites, or "None"]

RISKS:
[List potential blockers or risks, or "None identified"]

TOTAL_STEPS: [number]

Begin your analysis and planning now.`;
}

/**
 * Get depth label for a given depth level
 * @param {number} depth - The depth level
 * @returns {string} Human-readable depth label
 */
export function getDepthLabel(depth) {
  if (depth === 1) return 'SUB-PLAN';
  if (depth === 2) return 'SUB-SUB-PLAN';
  return 'LEVEL-3 RECOVERY PLAN';
}

/**
 * Build sub-plan prompt for blocked step
 * @param {Object} blockedStep - The step that was blocked
 * @param {string} reason - The reason for the block
 * @param {number} depth - Current plan depth
 * @returns {string} The sub-plan prompt
 */
export function buildSubPlanPrompt(blockedStep, reason, depth) {
  const depthLabel = getDepthLabel(depth);

  const depthWarning = depth >= 2
    ? '\n⚠️ WARNING: This is a deep re-planning level. Keep the plan minimal and focused.'
    : '';

  return `You are an expert software architect. A step in the execution plan has been blocked and needs an alternative approach.

## BLOCKED STEP
Step: ${blockedStep.description}
Complexity: ${blockedStep.complexity}

## BLOCK REASON
${reason}

## CURRENT DEPTH
Creating: ${depthLabel} (Level ${depth} of max 3)
${depthWarning}

## YOUR TASK

Create an alternative approach to accomplish what the blocked step was trying to do. This ${depthLabel.toLowerCase()} should:

1. **Work around the blocker**: Address the specific reason for the block
2. **Be more granular**: Break into smaller, more achievable sub-steps
3. **Have fallbacks**: Consider what could go wrong and how to handle it
4. **Stay focused**: Only address the blocked step's objective

Think about:
- What alternative methods could achieve the same outcome?
- Is there a simpler approach we missed?
- Can we use different tools or libraries?
- Should we create a minimal implementation first?

## OUTPUT FORMAT

Respond in EXACTLY this format:

ANALYSIS:
[Brief analysis of why the step was blocked and your alternative approach]

ALTERNATIVE_APPROACH:
[1-2 sentences describing the new strategy]

PLAN:
1. [Sub-step description] | [simple/medium/complex]
2. [Sub-step description] | [simple/medium/complex]
...

TOTAL_STEPS: [number]

Keep to 2-${MAX_SUBPLAN_STEPS} steps maximum. Be specific and actionable.`;
}

/**
 * Build adaptive sub-plan prompt with learnings from previous attempts
 * @param {Object} blockedStep - The blocked step
 * @param {string} reason - Block reason
 * @param {number} depth - Plan depth
 * @param {Object[]} previousAttempts - Array of previous attempt info
 * @param {Object} executionContext - Context with successful approaches
 * @returns {string} The adaptive prompt
 */
export function buildAdaptiveSubPlanPrompt(blockedStep, reason, depth, previousAttempts, executionContext = {}) {
  const depthLabel = getDepthLabel(depth);

  const previousAttemptsSection = previousAttempts.length > 0
    ? `\n## PREVIOUS ATTEMPTS (DO NOT REPEAT THESE)\n${previousAttempts.map((a, i) =>
        `Attempt ${i + 1}: ${a.approach} - FAILED because: ${a.failureReason}`
      ).join('\n')}`
    : '';

  const successfulApproaches = executionContext.successfulApproaches || [];
  const successfulApproachesSection = successfulApproaches.length > 0
    ? `\n## SUCCESSFUL PATTERNS (Consider these)\n${successfulApproaches.slice(-3).map(a =>
        `- ${a.description}`
      ).join('\n')}`
    : '';

  const maxSteps = Math.max(2, MAX_SUBPLAN_STEPS - depth);

  return `You are an expert software architect. A step has been blocked multiple times and needs a fresh approach.

## BLOCKED STEP
Step: ${blockedStep.description}
Complexity: ${blockedStep.complexity}

## BLOCK REASON
${reason}

## CURRENT DEPTH
Creating: ${depthLabel} (Level ${depth} of max 3)
${previousAttemptsSection}
${successfulApproachesSection}

## YOUR TASK

Create a DIFFERENT approach that avoids the previous failure patterns. Think creatively:
- Can we achieve the same goal through a completely different method?
- Is there a simpler version we can implement first?
- Can we skip this and handle it differently later?
- Is there a workaround that doesn't require what was blocked?

## OUTPUT FORMAT

Respond in EXACTLY this format:

ANALYSIS:
[Why previous approaches failed and what new direction you'll take]

ALTERNATIVE_APPROACH:
[1-2 sentences describing the NEW strategy]

PLAN:
1. [Sub-step description] | [simple/medium/complex]
2. [Sub-step description] | [simple/medium/complex]
...

TOTAL_STEPS: [number]

Keep to 2-${maxSteps} steps maximum.`;
}

/**
 * Format plan for display
 * @param {Object} plan - The execution plan
 * @returns {string} Formatted plan string
 */
export function formatPlanForDisplay(plan) {
  const depthLabel = plan.depth === 0 ? 'MAIN PLAN' :
                     plan.depth === 1 ? 'SUB-PLAN' :
                     plan.depth === 2 ? 'SUB-SUB-PLAN' :
                     'LEVEL-3 PLAN';

  const header = `═══ ${depthLabel} ═══`;
  const goal = `Goal: ${plan.goal}`;
  const analysis = `Analysis: ${plan.analysis}`;

  const steps = plan.steps.map(s => {
    const statusIcon = s.status === 'completed' ? '✓' :
                      s.status === 'failed' ? '✗' :
                      s.status === 'in_progress' ? '→' : ' ';
    return `  ${statusIcon} ${s.number}. ${s.description} [${s.complexity}]`;
  }).join('\n');

  return `${header}\n${goal}\n${analysis}\n\nSteps:\n${steps}`;
}

export default {
  buildPlanningPrompt,
  buildSubPlanPrompt,
  buildAdaptiveSubPlanPrompt,
  formatPlanForDisplay,
  getDepthLabel,
};
