/**
 * Dashboard Module - Re-exports
 */

export { MAX_SCORE_HISTORY, MAX_MESSAGES, LOGO, MINI_LOGO, STATUS_COLORS, LOG_TYPE_COLORS } from './constants.js';
export { createInitialState, updateScoreHistory, initializeState } from './state.js';
export { parseTimeLimit, formatDuration, calculateTimeInfo, getTimeColor } from './time-utils.js';
export { handleProgressUpdate, handleSupervisionUpdate, buildEscalationDisplay, buildVerificationDisplay } from './event-handlers.js';
export { renderHeader, getStatusBadge, renderStatus, renderEscalation, renderVerification } from './renderers.js';
export { renderReport } from './report-renderer.js';
