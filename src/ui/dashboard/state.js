/**
 * Dashboard State - State creation and management
 */

import { MAX_SCORE_HISTORY } from './constants.js';

/**
 * Create initial dashboard state
 * @returns {object} Initial state object
 */
export function createInitialState() {
  return {
    goal: '',
    subGoals: [],
    timeLimit: '',
    startTime: null,
    iteration: 0,
    progress: 0,
    status: 'initializing',
    phase: '',
    sessionId: null,
    scoreHistory: [],
    lastScore: null,
    consecutiveIssues: 0,
    messages: [],
    verification: null,
    error: null,
  };
}

/**
 * Update score history with new score
 * @param {object} state - Dashboard state
 * @param {number} score - New score value
 */
export function updateScoreHistory(state, score) {
  if (score !== undefined) {
    state.scoreHistory.push(score);
    if (state.scoreHistory.length > MAX_SCORE_HISTORY) {
      state.scoreHistory = state.scoreHistory.slice(-MAX_SCORE_HISTORY);
    }
    state.lastScore = score;
  }
}

/**
 * Initialize state with data
 * @param {object} state - Dashboard state
 * @param {object} data - Initialization data
 */
export function initializeState(state, data) {
  state.goal = data.goal;
  state.subGoals = data.subGoals || [];
  state.timeLimit = data.timeLimit;
  state.startTime = Date.now();
  state.status = 'initialized';
}

export default { createInitialState, updateScoreHistory, initializeState };
