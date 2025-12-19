/**
 * Plan Parser - Parses Claude's plan responses and decomposition responses
 */

export class PlanParser {
  constructor(complexityEstimator, dependencyAnalyzer) {
    this.complexityEstimator = complexityEstimator;
    this.dependencyAnalyzer = dependencyAnalyzer;
  }

  /** Build the planning prompt */
  buildPlanningPrompt(goal, context, workingDirectory) {
    const contextSection = context ? `Context: ${context}\n` : '';

    return `PLAN THIS GOAL: ${goal}
${contextSection}Working dir: ${workingDirectory}

Rules:
- 3-10 concrete, actionable steps
- Each step independently completable
- Mark complexity: simple/medium/complex

Output EXACTLY:
ANALYSIS: [1-2 sentence analysis]
PLAN:
1. [Step] | [complexity]
2. [Step] | [complexity]
...
TOTAL_STEPS: [N]`;
  }

  /** Build the sub-plan prompt for blocked steps */
  buildSubPlanPrompt(goal, blockedStep, blockReason, workingDirectory) {
    return `You are a planning assistant. A step has been blocked and needs an alternative approach.

## ORIGINAL GOAL
${goal}

## BLOCKED STEP
Step ${blockedStep.number}: ${blockedStep.description}

## BLOCK REASON
${blockReason}

## WORKING DIRECTORY
${workingDirectory}

## YOUR TASK

Create an alternative approach to accomplish what the blocked step was trying to do.
Break it down into 2-5 smaller, more specific steps that work around the blocker.

Think about:
- What alternative methods could achieve the same outcome?
- Can we break this into smaller pieces that are less likely to fail?
- Is there a prerequisite we missed?

Output your plan in EXACTLY this format:

ANALYSIS: [Brief analysis of the problem and your approach]

PLAN:
1. [Step description] | [simple/medium/complex]
2. [Step description] | [simple/medium/complex]
...

TOTAL_STEPS: [number]

Keep to 2-5 steps. Be specific and actionable.`;
  }

  /** Build the decomposition prompt for complex steps */
  buildDecompositionPrompt(goal, step, workingDirectory) {
    return `You are a planning assistant. Break down this complex step into smaller, more manageable subtasks.

## ORIGINAL GOAL
${goal}

## STEP TO DECOMPOSE
Step ${step.number}: ${step.description}
Complexity: ${step.complexity}

## WORKING DIRECTORY
${workingDirectory}

## YOUR TASK

This step is complex and should be broken into smaller pieces. Create 2-4 subtasks that:
1. Are independently completable
2. Can potentially run in parallel if they don't depend on each other
3. Together fully accomplish the original step

Output in EXACTLY this format:

ANALYSIS: [Why this needs decomposition and your approach]

SUBTASKS:
1. [Subtask description] | [simple/medium]
2. [Subtask description] | [simple/medium]
...

PARALLEL_SAFE: [YES/NO] - Can these subtasks run in parallel?`;
  }

  /** Parse Claude's plan response */
  parsePlan(response, originalGoal) {
    const plan = { goal: originalGoal, analysis: '', steps: [], totalSteps: 0, raw: response };
    const lines = response.split('\n');
    let inPlanSection = false;

    for (const line of lines) {
      const trimmed = line.trim();

      if (trimmed.startsWith('ANALYSIS:')) {
        plan.analysis = trimmed.substring('ANALYSIS:'.length).trim();
        continue;
      }

      if (trimmed === 'PLAN:') {
        inPlanSection = true;
        continue;
      }

      if (trimmed.startsWith('TOTAL_STEPS:')) {
        const match = trimmed.match(/(\d+)/);
        if (match) plan.totalSteps = parseInt(match[1], 10);
        inPlanSection = false;
        continue;
      }

      if (inPlanSection) {
        const stepMatch = trimmed.match(/^(\d+)\.\s*(.+?)(?:\s*\|\s*(simple|medium|complex))?$/i);
        if (stepMatch) {
          const description = stepMatch[2].trim();
          let complexity = stepMatch[3]?.toLowerCase();
          if (!complexity && this.complexityEstimator) {
            complexity = this.complexityEstimator.estimateComplexity(description);
            complexity = this.complexityEstimator.refineComplexity(complexity, description);
          }
          plan.steps.push({
            number: parseInt(stepMatch[1], 10),
            description,
            complexity: complexity || 'medium',
            status: 'pending',
          });
        }
      }
    }

    // Fallback parsing
    if (plan.steps.length === 0) {
      const numberedItems = response.match(/^\d+\.\s*.+$/gm);
      if (numberedItems) {
        plan.steps = numberedItems.map((item, i) => {
          const description = item.replace(/^\d+\.\s*/, '').replace(/\|.*$/, '').trim();
          let complexity = 'medium';
          if (this.complexityEstimator) {
            complexity = this.complexityEstimator.estimateComplexity(description);
            complexity = this.complexityEstimator.refineComplexity(complexity, description);
          }
          return { number: i + 1, description, complexity, status: 'pending' };
        });
      }
    }

    plan.totalSteps = plan.steps.length;

    if (plan.steps.length > 0 && this.dependencyAnalyzer) {
      plan.steps = this.dependencyAnalyzer.analyzeDependencies(plan.steps);
      plan.executionStats = this.dependencyAnalyzer.getExecutionStats(plan.steps);
    }

    return plan;
  }

  /** Parse decomposition response into subtasks */
  parseDecomposition(response, parentStep) {
    const subtasks = [];
    const lines = response.split('\n');
    let inSubtasksSection = false;
    let parallelSafe = false;

    for (const line of lines) {
      const trimmed = line.trim();

      if (trimmed.startsWith('SUBTASKS:')) {
        inSubtasksSection = true;
        continue;
      }

      if (trimmed.startsWith('PARALLEL_SAFE:')) {
        parallelSafe = trimmed.toUpperCase().includes('YES');
        inSubtasksSection = false;
        continue;
      }

      if (inSubtasksSection) {
        const match = trimmed.match(/^(\d+)\.\s*(.+?)(?:\s*\|\s*(simple|medium))?$/i);
        if (match) {
          subtasks.push({
            number: parentStep.number + (parseInt(match[1], 10) / 10),
            description: match[2].trim(),
            complexity: (match[3] || 'simple').toLowerCase(),
            status: 'pending',
            isSubtask: true,
            parentStepNumber: parentStep.number,
          });
        }
      }
    }

    if (subtasks.length === 0) return null;

    return { parentStep, subtasks, parallelSafe, raw: response };
  }
}

export default PlanParser;
