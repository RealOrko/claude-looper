/**
 * Message Classes for Inter-Agent Communication
 *
 * Provides the message structure for agent communication.
 */

/**
 * Generate a unique message ID
 * @returns {string} Unique message identifier
 */
function generateMessageId() {
  return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Base message structure for inter-agent communication
 */
export class AgentMessage {
  constructor(type, fromAgent, toAgent, payload = {}) {
    this.id = generateMessageId();
    this.type = type;
    this.from = fromAgent;
    this.to = toAgent;
    this.payload = payload;
    this.timestamp = Date.now();
    this.correlationId = null; // For request-response matching
  }

  /**
   * Create a response to this message
   * @param {string} type - Response message type
   * @param {Object} payload - Response payload
   * @returns {AgentMessage} Response message
   */
  createResponse(type, payload) {
    const response = new AgentMessage(type, this.to, this.from, payload);
    response.correlationId = this.id;
    return response;
  }
}

export default { AgentMessage };
