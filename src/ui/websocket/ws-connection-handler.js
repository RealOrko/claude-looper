/**
 * WebSocket Connection Handler
 *
 * Handles client connections, message handling, and heartbeat.
 */

import { sendToClient } from './ws-broadcaster.js';

/**
 * Generate a unique client ID.
 */
export function generateClientId() {
  return `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Setup WebSocket client event handlers.
 *
 * @param {WebSocket} ws - WebSocket client
 * @param {object} options - Handler options
 * @param {Set<WebSocket>} options.clients - Set of all clients
 * @param {object} options.state - Current state object
 * @param {Array} options.eventHistory - Event history array
 * @param {Function} options.onMessage - Message handler callback
 * @param {Function} options.getMetrics - Function to get metrics
 */
export function setupClientHandlers(ws, options) {
  const { clients, onMessage } = options;

  // Assign client ID
  const clientId = generateClientId();
  ws.clientId = clientId;

  console.log(`WebSocket client connected: ${clientId} (total: ${clients.size})`);

  // Send current state to new client
  if (options.state) {
    sendToClient(ws, 'state', options.state);
  }

  // Send recent history
  if (options.eventHistory?.length > 0) {
    const recentHistory = options.eventHistory.slice(-100);
    if (recentHistory.length > 0) {
      sendToClient(ws, 'history', recentHistory);
    }
  }

  // Handle messages from client
  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());
      if (onMessage) {
        onMessage(ws, message);
      }
    } catch (e) {
      console.error('Invalid message from client:', e.message);
    }
  });

  // Handle disconnection
  ws.on('close', () => {
    clients.delete(ws);
    console.log(`WebSocket client disconnected: ${clientId} (remaining: ${clients.size})`);
  });

  // Handle errors
  ws.on('error', (err) => {
    console.error(`WebSocket error for client ${clientId}:`, err.message);
    clients.delete(ws);
  });

  // Ping to keep connection alive
  ws.isAlive = true;
  ws.on('pong', () => {
    ws.isAlive = true;
  });

  return clientId;
}

/**
 * Handle client message.
 *
 * @param {WebSocket} ws - WebSocket client
 * @param {object} message - Parsed message object
 * @param {object} context - Context with state, history, getMetrics, emit
 */
export function handleClientMessage(ws, message, context) {
  const { state, eventHistory, getMetrics, emit } = context;

  switch (message.type) {
    case 'ping':
      sendToClient(ws, 'pong', { timestamp: Date.now() });
      break;

    case 'getState':
      sendToClient(ws, 'state', state);
      break;

    case 'getHistory': {
      const limit = message.limit || 100;
      const events = Array.isArray(eventHistory) ? eventHistory : eventHistory?.events;
      sendToClient(ws, 'history', (events || []).slice(-limit));
      break;
    }

    case 'getMetrics':
      if (getMetrics) {
        sendToClient(ws, 'metrics', getMetrics());
      }
      break;

    default:
      // Forward to event listeners for potential control commands
      if (emit) {
        emit('clientMessage', { clientId: ws.clientId, message });
      }
  }
}

/**
 * HeartbeatManager class for managing client heartbeats.
 */
export class HeartbeatManager {
  constructor(clients, interval = 30000) {
    this.clients = clients;
    this.interval = interval;
    this._intervalId = null;
  }

  /**
   * Start heartbeat interval.
   */
  start() {
    if (this._intervalId) return;

    this._intervalId = setInterval(() => {
      for (const ws of this.clients) {
        if (!ws.isAlive) {
          ws.terminate();
          this.clients.delete(ws);
          continue;
        }
        ws.isAlive = false;
        ws.ping();
      }
    }, this.interval);
  }

  /**
   * Stop heartbeat interval.
   */
  stop() {
    if (this._intervalId) {
      clearInterval(this._intervalId);
      this._intervalId = null;
    }
  }
}

/**
 * TimeUpdateManager class for managing periodic time updates.
 */
export class TimeUpdateManager {
  constructor(options = {}) {
    this.interval = options.interval || 1000;
    this._intervalId = null;
    this._startTime = null;
    this._callback = null;
  }

  /**
   * Start time updates.
   * @param {Function} callback - Called each interval with elapsed time
   */
  start(callback) {
    if (this._intervalId) return;

    this._startTime = Date.now();
    this._callback = callback;

    this._intervalId = setInterval(() => {
      if (this._callback && this._startTime) {
        const elapsed = Date.now() - this._startTime;
        this._callback(elapsed);
      }
    }, this.interval);
  }

  /**
   * Stop time updates.
   */
  stop() {
    if (this._intervalId) {
      clearInterval(this._intervalId);
      this._intervalId = null;
    }
    this._startTime = null;
  }

  /**
   * Get current start time.
   */
  get startTime() {
    return this._startTime;
  }

  /**
   * Set start time externally (for resumption).
   */
  setStartTime(time) {
    this._startTime = time;
  }

  /**
   * Check if running.
   */
  get isRunning() {
    return this._intervalId !== null;
  }
}

export default {
  generateClientId,
  setupClientHandlers,
  handleClientMessage,
  HeartbeatManager,
  TimeUpdateManager,
};
