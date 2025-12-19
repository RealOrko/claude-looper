/**
 * Base Agent Interface
 *
 * All agents must extend this base class.
 */

import { AgentStatus } from './enums.js';

/**
 * Base Agent Interface
 * All agents must implement this interface
 */
export class BaseAgent {
  constructor(role, client, config = {}) {
    this.role = role;
    this.client = client;
    this.config = config;
    this.status = AgentStatus.IDLE;
    this.lastActivity = Date.now();
    this.messageHandlers = new Map();
    this.outputHistory = [];
    this.maxHistorySize = 50;
  }

  /**
   * Get agent identifier
   * @returns {string} Agent ID
   */
  getId() {
    return `${this.role}_${this.client?.getSessionId() || 'no_session'}`;
  }

  /**
   * Register a message handler
   * @param {string} messageType - The message type to handle
   * @param {Function} handler - The handler function
   */
  onMessage(messageType, handler) {
    this.messageHandlers.set(messageType, handler);
  }

  /**
   * Process an incoming message
   * @param {AgentMessage} message - The message to process
   * @returns {Promise<*>} Handler result
   */
  async handleMessage(message) {
    const handler = this.messageHandlers.get(message.type);
    if (handler) {
      this.status = AgentStatus.WORKING;
      this.lastActivity = Date.now();
      try {
        const result = await handler(message);
        this.recordOutput(message, result);
        return result;
      } finally {
        this.status = AgentStatus.IDLE;
      }
    }
    throw new Error(`No handler for message type: ${message.type}`);
  }

  /**
   * Record output for supervisor verification
   * @param {AgentMessage} inputMessage - The input message
   * @param {*} output - The output produced
   */
  recordOutput(inputMessage, output) {
    this.outputHistory.push({
      timestamp: Date.now(),
      input: inputMessage,
      output,
      verified: false,
    });

    // Trim history
    if (this.outputHistory.length > this.maxHistorySize) {
      this.outputHistory = this.outputHistory.slice(-this.maxHistorySize);
    }
  }

  /**
   * Get unverified outputs for supervisor review
   * @returns {Object[]} Unverified outputs
   */
  getUnverifiedOutputs() {
    return this.outputHistory.filter(o => !o.verified);
  }

  /**
   * Mark outputs as verified
   * @param {number[]} outputIds - Timestamps of outputs to mark verified
   */
  markVerified(outputIds) {
    for (const entry of this.outputHistory) {
      if (outputIds.includes(entry.timestamp)) {
        entry.verified = true;
      }
    }
  }

  /**
   * Abstract method - must be implemented by subclasses
   * @param {Object} task - The task to execute
   * @returns {Promise<*>} Task result
   */
  async execute(task) {
    throw new Error('execute() must be implemented by subclass');
  }

  /**
   * Get agent statistics
   * @returns {Object} Agent stats
   */
  getStats() {
    return {
      role: this.role,
      status: this.status,
      lastActivity: this.lastActivity,
      outputCount: this.outputHistory.length,
      unverifiedCount: this.getUnverifiedOutputs().length,
    };
  }
}

export default { BaseAgent };
