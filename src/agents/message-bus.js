/**
 * Message Bus - Inter-agent communication system
 *
 * Provides a centralized message passing system for agents to communicate.
 * Supports request-response patterns, broadcasts, and event subscriptions.
 */

import { EventEmitter } from 'events';
import { AgentMessage, MessageType, AgentRole } from './interfaces.js';

// Memory limits
const MAX_MESSAGE_HISTORY = 100;
const MAX_PENDING_REQUESTS = 50;

/**
 * Message Bus for agent communication
 */
export class MessageBus extends EventEmitter {
  constructor() {
    super();
    this.agents = new Map(); // role -> agent instance
    this.messageHistory = [];
    this.pendingRequests = new Map(); // correlationId -> { resolve, reject, timeout }
    this.subscriptions = new Map(); // messageType -> Set of handlers
    this.requestTimeout = 5 * 60 * 1000; // 5 minutes default
  }

  /**
   * Register an agent with the message bus
   */
  registerAgent(role, agent) {
    this.agents.set(role, agent);
    this.emit('agent_registered', { role, agentId: agent.getId?.() || role });
  }

  /**
   * Unregister an agent
   */
  unregisterAgent(role) {
    this.agents.delete(role);
    this.emit('agent_unregistered', { role });
  }

  /**
   * Get a registered agent
   */
  getAgent(role) {
    return this.agents.get(role);
  }

  /**
   * Subscribe to a message type
   */
  subscribe(messageType, handler) {
    if (!this.subscriptions.has(messageType)) {
      this.subscriptions.set(messageType, new Set());
    }
    this.subscriptions.get(messageType).add(handler);

    // Return unsubscribe function
    return () => {
      this.subscriptions.get(messageType)?.delete(handler);
    };
  }

  /**
   * Send a message to a specific agent
   */
  async send(message) {
    this.recordMessage(message);

    const targetAgent = this.agents.get(message.to);
    if (!targetAgent) {
      throw new Error(`Target agent not found: ${message.to}`);
    }

    this.emit('message_sent', {
      id: message.id,
      type: message.type,
      from: message.from,
      to: message.to,
    });

    // If it's a response to a pending request, resolve the promise
    if (message.correlationId && this.pendingRequests.has(message.correlationId)) {
      const pending = this.pendingRequests.get(message.correlationId);
      clearTimeout(pending.timeout);
      this.pendingRequests.delete(message.correlationId);
      pending.resolve(message);
      return message;
    }

    // Deliver to target agent
    try {
      const result = await targetAgent.handleMessage(message);
      this.emit('message_delivered', {
        id: message.id,
        type: message.type,
        to: message.to,
      });
      return result;
    } catch (error) {
      this.emit('message_failed', {
        id: message.id,
        type: message.type,
        to: message.to,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Send a request and wait for response
   */
  async request(message, timeout = null) {
    this.recordMessage(message);

    const actualTimeout = timeout || this.requestTimeout;

    return new Promise((resolve, reject) => {
      // Set up timeout
      const timeoutId = setTimeout(() => {
        this.pendingRequests.delete(message.id);
        reject(new Error(`Request timed out after ${actualTimeout}ms: ${message.type}`));
      }, actualTimeout);

      // Store pending request
      this.pendingRequests.set(message.id, {
        resolve,
        reject,
        timeout: timeoutId,
        message,
      });

      // Trim pending requests if too many
      if (this.pendingRequests.size > MAX_PENDING_REQUESTS) {
        const oldestKey = this.pendingRequests.keys().next().value;
        const oldest = this.pendingRequests.get(oldestKey);
        clearTimeout(oldest.timeout);
        this.pendingRequests.delete(oldestKey);
        oldest.reject(new Error('Request dropped due to queue overflow'));
      }

      // Send the message and resolve with the response
      this.send(message).then(response => {
        // If the response is a message object (from agent handler), resolve with it
        if (response && !this.pendingRequests.has(message.id)) {
          // Already resolved via correlationId path
          return;
        }
        if (response) {
          clearTimeout(timeoutId);
          this.pendingRequests.delete(message.id);
          resolve(response);
        }
      }).catch(error => {
        clearTimeout(timeoutId);
        this.pendingRequests.delete(message.id);
        reject(error);
      });
    });
  }

  /**
   * Broadcast a message to all agents
   */
  async broadcast(message) {
    this.recordMessage(message);

    const results = [];
    for (const [role, agent] of this.agents) {
      if (role !== message.from) {
        try {
          const broadcastMsg = new AgentMessage(
            message.type,
            message.from,
            role,
            message.payload
          );
          const result = await agent.handleMessage(broadcastMsg);
          results.push({ role, success: true, result });
        } catch (error) {
          results.push({ role, success: false, error: error.message });
        }
      }
    }

    this.emit('broadcast_complete', {
      type: message.type,
      from: message.from,
      results,
    });

    return results;
  }

  /**
   * Notify all subscribers of a message type
   */
  notify(messageType, data) {
    const handlers = this.subscriptions.get(messageType);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(data);
        } catch (error) {
          this.emit('handler_error', {
            messageType,
            error: error.message,
          });
        }
      }
    }
  }

  /**
   * Record a message in history
   */
  recordMessage(message) {
    this.messageHistory.push({
      id: message.id,
      type: message.type,
      from: message.from,
      to: message.to,
      timestamp: message.timestamp,
      correlationId: message.correlationId,
    });

    // Trim history
    if (this.messageHistory.length > MAX_MESSAGE_HISTORY) {
      this.messageHistory = this.messageHistory.slice(-MAX_MESSAGE_HISTORY);
    }
  }

  /**
   * Get message history (optionally filtered)
   */
  getHistory(filter = {}) {
    let history = [...this.messageHistory];

    if (filter.type) {
      history = history.filter(m => m.type === filter.type);
    }
    if (filter.from) {
      history = history.filter(m => m.from === filter.from);
    }
    if (filter.to) {
      history = history.filter(m => m.to === filter.to);
    }
    if (filter.since) {
      history = history.filter(m => m.timestamp >= filter.since);
    }

    return history;
  }

  /**
   * Get statistics
   */
  getStats() {
    const messagesByType = {};
    const messagesByAgent = {};

    for (const msg of this.messageHistory) {
      messagesByType[msg.type] = (messagesByType[msg.type] || 0) + 1;
      messagesByAgent[msg.from] = (messagesByAgent[msg.from] || 0) + 1;
    }

    return {
      registeredAgents: Array.from(this.agents.keys()),
      totalMessages: this.messageHistory.length,
      pendingRequests: this.pendingRequests.size,
      messagesByType,
      messagesByAgent,
      subscriptionCount: Array.from(this.subscriptions.values())
        .reduce((sum, set) => sum + set.size, 0),
    };
  }

  /**
   * Clear all pending requests (for shutdown)
   */
  clearPending() {
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('Message bus shutting down'));
    }
    this.pendingRequests.clear();
  }

  /**
   * Reset the message bus
   */
  reset() {
    this.clearPending();
    this.messageHistory = [];
    this.subscriptions.clear();
    // Note: agents are NOT cleared - they need to be explicitly unregistered
  }
}

/**
 * Helper to create standard messages
 */
export const Messages = {
  /**
   * Create a plan request message
   */
  planRequest(fromAgent, goal, context = {}) {
    return new AgentMessage(
      MessageType.PLAN_REQUEST,
      fromAgent,
      AgentRole.PLANNER,
      { goal, context }
    );
  },

  /**
   * Create a code request message
   */
  codeRequest(fromAgent, step, context = {}) {
    return new AgentMessage(
      MessageType.CODE_REQUEST,
      fromAgent,
      AgentRole.CODER,
      { step, context }
    );
  },

  /**
   * Create a code fix request message
   */
  codeFixRequest(fromAgent, step, fixPlan) {
    return new AgentMessage(
      MessageType.CODE_FIX_REQUEST,
      fromAgent,
      AgentRole.CODER,
      { step, fixPlan }
    );
  },

  /**
   * Create a test request message
   */
  testRequest(fromAgent, step, codeOutput) {
    return new AgentMessage(
      MessageType.TEST_REQUEST,
      fromAgent,
      AgentRole.TESTER,
      { step, codeOutput }
    );
  },

  /**
   * Create a verification request message
   */
  verifyRequest(fromAgent, type, target, context = {}) {
    return new AgentMessage(
      MessageType.VERIFY_REQUEST,
      fromAgent,
      AgentRole.SUPERVISOR,
      { type, target, context }
    );
  },

  /**
   * Create a replan request message
   */
  replanRequest(fromAgent, blockedStep, reason, depth) {
    return new AgentMessage(
      MessageType.REPLAN_REQUEST,
      fromAgent,
      AgentRole.PLANNER,
      { blockedStep, reason, depth }
    );
  },

  /**
   * Create a step complete message
   */
  stepComplete(fromAgent, step, results) {
    return new AgentMessage(
      MessageType.STEP_COMPLETE,
      fromAgent,
      AgentRole.ORCHESTRATOR,
      { step, results }
    );
  },

  /**
   * Create a step blocked message
   */
  stepBlocked(fromAgent, step, reason) {
    return new AgentMessage(
      MessageType.STEP_BLOCKED,
      fromAgent,
      AgentRole.ORCHESTRATOR,
      { step, reason }
    );
  },

  /**
   * Create a correction message
   */
  correction(targetAgent, reason, instructions) {
    return new AgentMessage(
      MessageType.CORRECTION,
      AgentRole.SUPERVISOR,
      targetAgent,
      { reason, instructions }
    );
  },

  /**
   * Create an escalation message
   */
  escalation(level, reason, recommendation) {
    return new AgentMessage(
      MessageType.ESCALATION,
      AgentRole.SUPERVISOR,
      AgentRole.ORCHESTRATOR,
      { level, reason, recommendation }
    );
  },
};

export default MessageBus;
