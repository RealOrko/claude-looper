/**
 * Repetition Detector
 * Detects repetitive behavior patterns and suggests recovery actions
 */

/**
 * Calculate string similarity using Jaccard index
 * @param {string} str1 - First string
 * @param {string} str2 - Second string
 * @returns {number} Similarity score 0-1
 */
export function stringSimilarity(str1, str2) {
  const words1 = new Set(str1.split(/\s+/).filter(w => w.length > 3));
  const words2 = new Set(str2.split(/\s+/).filter(w => w.length > 3));
  if (words1.size === 0 || words2.size === 0) return 0;
  const intersection = [...words1].filter(w => words2.has(w)).length;
  const union = new Set([...words1, ...words2]).size;
  return intersection / union;
}

/**
 * Detect repetitive behavior patterns in assessment history
 * @param {Array} assessmentHistory - Assessment history array
 * @returns {Object} Repetitive behavior analysis
 */
export function detectRepetitiveBehavior(assessmentHistory) {
  if (assessmentHistory.length < 5) {
    return { isRepetitive: false };
  }

  const recent = assessmentHistory.slice(-10);
  const patterns = analyzePatterns(recent);
  const isRepetitive = patterns.scoreStuck || patterns.repeatedCorrections || patterns.similarContent;

  return {
    isRepetitive,
    patterns,
    suggestion: isRepetitive ? generateRecoverySuggestion(patterns) : null,
  };
}

/**
 * Analyze patterns in recent assessments
 */
function analyzePatterns(recent) {
  const scores = recent.map(a => a.assessment.score);
  const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
  const variance = scores.reduce((sum, s) => sum + Math.pow(s - avgScore, 2), 0) / scores.length;
  const scoreStuck = variance < 25 && avgScore < 70;

  const actions = recent.map(a => a.assessment.action);
  const actionCounts = actions.reduce((acc, action) => {
    acc[action] = (acc[action] || 0) + 1;
    return acc;
  }, {});

  const repeatedCorrections = Object.entries(actionCounts)
    .filter(([action, count]) => action !== 'CONTINUE' && count >= 3)
    .length > 0;

  const snippets = recent.map(a => a.responseSnippet?.toLowerCase() || '');
  let similarityCount = 0;
  for (let i = 1; i < snippets.length; i++) {
    if (stringSimilarity(snippets[i], snippets[i - 1]) > 0.7) {
      similarityCount++;
    }
  }
  const similarContent = similarityCount >= 3;

  return {
    scoreStuck,
    repeatedCorrections,
    similarContent,
    avgScore,
    scoreVariance: variance,
  };
}

/**
 * Generate recovery suggestion based on patterns
 */
export function generateRecoverySuggestion(patterns) {
  if (patterns.repeatedCorrections) {
    return `You've received multiple corrections without changing approach. Try a completely different strategy:
1. List 3 alternative approaches you haven't tried
2. Pick the most promising one
3. Execute it immediately`;
  }

  if (patterns.similarContent) {
    return `Your responses are too similar - you may be in a loop. Break out by:
1. Stop the current activity completely
2. Re-read the original goal
3. Start fresh with a different first step`;
  }

  if (patterns.scoreStuck) {
    return `Progress has plateaued. To advance:
1. Identify what specific blocker is preventing progress
2. If technical: try a workaround or simplification
3. If unclear requirements: state assumptions and proceed`;
  }

  return 'Consider taking a different approach to make progress.';
}

/**
 * Suggest automatic recovery action
 * @param {Object} repetitiveAnalysis - Result from detectRepetitiveBehavior
 * @param {Object} context - Context including currentStep and primaryGoal
 * @returns {Object|null} Recovery action or null
 */
export function suggestAutoRecovery(repetitiveAnalysis, context) {
  if (!repetitiveAnalysis.isRepetitive) return null;

  const { currentStep, primaryGoal } = context;
  const recoveryActions = [];

  if (currentStep && repetitiveAnalysis.patterns.repeatedCorrections) {
    recoveryActions.push({
      action: 'SKIP_STEP',
      reason: 'Step appears blocked after multiple attempts',
      prompt: `This step appears blocked. Let's mark it as blocked and move to the next step.

Say "STEP BLOCKED: Unable to complete after multiple attempts" to proceed.`,
    });
  }

  if (repetitiveAnalysis.patterns.similarContent) {
    recoveryActions.push({
      action: 'CONTEXT_RESET',
      reason: 'Repetitive responses detected',
      prompt: `You appear to be in a loop. Let me reset context.

Current goal: ${primaryGoal}
${currentStep ? `Current step: ${currentStep.description}` : ''}

Start fresh: What is ONE concrete action you can take RIGHT NOW to make progress?`,
    });
  }

  if (repetitiveAnalysis.patterns.scoreStuck && repetitiveAnalysis.patterns.avgScore < 50) {
    recoveryActions.push({
      action: 'SIMPLIFY',
      reason: 'Consistently low alignment scores',
      prompt: `Progress is stalled. Let's simplify:

1. What is the MINIMUM viable action to advance the goal?
2. Ignore edge cases and optimizations for now
3. Execute the simplest possible next step

What is that one simple action?`,
    });
  }

  return recoveryActions[0] || null;
}
