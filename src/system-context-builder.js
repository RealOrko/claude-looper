/**
 * System Context Builder - builds system prompts for autonomous execution
 */

export class SystemContextBuilder {
  constructor(runner) {
    this.runner = runner;
  }

  /** Build system context for autonomous execution */
  build(primaryGoal, subGoals, workingDirectory) {
    const stepContext = this.buildStepContext();
    const subGoalsSection = this.buildSubGoalsSection(subGoals);

    return `# AUTONOMOUS EXECUTION MODE

You are running in AUTONOMOUS MODE. This means:
- You will work CONTINUOUSLY without waiting for user input
- After each action, IMMEDIATELY proceed to the next step
- You have a TIME LIMIT - work efficiently
- A supervisor is monitoring your progress

## PRIMARY GOAL
${primaryGoal}

${subGoalsSection}${stepContext}## WORKING DIRECTORY
${workingDirectory}

## RULES

1. **Work Autonomously**: Don't wait for input - determine and execute the next step
2. **Take Action**: Use tools. Don't just plan - execute.
3. **Report Progress**: State what you did and what you'll do next
4. **Signal Step Completion**: Say "STEP COMPLETE" when the current step is done
5. **Signal Blockers**: Say "STEP BLOCKED: [reason]" if you cannot proceed
6. **Signal Task Completion**: Say "TASK COMPLETE" when ALL steps are done
7. **Stay Focused**: Every action should advance the current step

Begin immediately.`;
  }

  /** Build step context section */
  buildStepContext() {
    const r = this.runner;
    const currentStep = r.planner?.getCurrentStep();
    const planProgress = r.planner?.getProgress();

    if (!currentStep || !planProgress) return '';

    const completedSteps = r.planner.plan.steps
      .filter(s => s.status === 'completed')
      .map(s => `  ✓ ${s.number}. ${s.description}`)
      .join('\n');

    return `
## CURRENT STEP (${planProgress.current} of ${planProgress.total})
${currentStep.description}
Complexity: ${currentStep.complexity}

${completedSteps ? `## COMPLETED STEPS\n${completedSteps}\n` : ''}`;
  }

  /** Build sub-goals section */
  buildSubGoalsSection(subGoals) {
    if (subGoals.length === 0) return '';
    return `## SUB-GOALS (Complete in order)
${subGoals.map((g, i) => `${i + 1}. ${g}`).join('\n')}
`;
  }
}

export default SystemContextBuilder;
