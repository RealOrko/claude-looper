/**
 * WebSocket Metrics Management
 *
 * Handles metrics tracking and handler creation for the WebSocket server.
 */

/**
 * Create initial metrics object.
 */
export function createMetrics() {
  return {
    startTime: null,
    messagesProcessed: 0,
    stepsCompleted: 0,
    stepsFailed: 0,
    errorsEncountered: 0,
    supervisionEvents: 0,
    clientConnections: 0,
  };
}

/**
 * Get formatted metrics with calculated fields.
 *
 * @param {object} metrics - Raw metrics object
 * @param {object} context - Context with clients, eventHistory, state
 * @returns {object} Formatted metrics
 */
export function getFormattedMetrics(metrics, context) {
  const { clients, eventHistory, state } = context;
  return {
    ...metrics,
    uptime: metrics.startTime ? Date.now() - metrics.startTime : 0,
    connectedClients: clients.size,
    eventsInHistory: eventHistory.length,
    state: {
      status: state.status,
      progress: state.progress,
      stepsTotal: state.plan?.steps?.length || 0,
      stepsCompleted: state.completedSteps.length,
      stepsFailed: state.failedSteps.length,
    },
  };
}

/**
 * Create wrapped event handlers that call both existing handlers and broadcast.
 *
 * @param {object} existingHandlers - Existing event handlers
 * @param {Function} broadcast - Broadcast function
 * @returns {object} Wrapped handlers
 */
export function createEventHandlers(existingHandlers, broadcast) {
  const wrapHandler = (name, eventType) => (data) => {
    try {
      existingHandlers[name]?.(data);
    } catch (err) {
      console.error(`Handler ${name} error:`, err.message);
    }
    try {
      broadcast(eventType, data);
    } catch (err) {
      console.error(`Broadcast ${eventType} error:`, err.message);
    }
  };

  return {
    onProgress: wrapHandler('onProgress', 'progress'),
    onMessage: wrapHandler('onMessage', 'message'),
    onError: wrapHandler('onError', 'error'),
    onSupervision: wrapHandler('onSupervision', 'supervision'),
    onEscalation: wrapHandler('onEscalation', 'escalation'),
    onVerification: wrapHandler('onVerification', 'verification'),
    onComplete: wrapHandler('onComplete', 'complete'),
  };
}

export default {
  createMetrics,
  getFormattedMetrics,
  createEventHandlers,
};
