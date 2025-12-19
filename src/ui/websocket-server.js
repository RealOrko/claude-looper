/**
 * WebSocket Server for Real-time Agent Visualization
 *
 * This module provides a WebSocket server that broadcasts real-time events
 * from the agent runner to connected clients (e.g., React UI).
 *
 * Events broadcast:
 * - progress: Step progress, planning updates, verification status
 * - message: Claude's output/responses
 * - error: Error events
 * - supervision: Supervisor assessments
 * - escalation: Critical issues
 * - verification: Verification results
 * - complete: Final report
 * - metrics: Performance metrics
 * - state: Full state snapshots
 */

import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import express from 'express';
import { EventEmitter } from 'events';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class AgentWebSocketServer extends EventEmitter {
  constructor(options = {}) {
    super();
    this.port = options.port || process.env.WS_PORT || 3000;
    this.app = express();
    this.server = createServer(this.app);
    this.wss = null;
    this.clients = new Set();
    this.eventHistory = [];
    this.maxHistorySize = options.maxHistorySize || 1000;
    this.state = this._createInitialState();
    this.isRunning = false;

    // Metrics tracking
    this.metrics = {
      startTime: null,
      messagesProcessed: 0,
      stepsCompleted: 0,
      stepsFailed: 0,
      errorsEncountered: 0,
      supervisionEvents: 0,
      clientConnections: 0,
    };

    // Debounce state broadcasts to prevent overwhelming clients
    this._broadcastPending = false;
    this._broadcastTimer = null;
    this._stateVersion = 0;

    // Time update interval for live elapsed time in web UI
    this._timeUpdateInterval = null;
    this._executionStartTime = null;
  }

  _createInitialState() {
    return {
      status: 'idle', // idle, initializing, planning, executing, verifying, completed, failed
      goal: null,
      subGoals: [],
      plan: null,
      currentStep: null,
      completedSteps: [],
      failedSteps: [],
      progress: 0,
      timeLimit: null,
      timeElapsed: 0,
      timeRemaining: null,
      iteration: 0,
      session: null,
      lastMessage: null,
      lastError: null,
      supervision: null,
      verification: null,
      retryMode: {
        enabled: false,
        currentAttempt: 0,
        maxAttempts: 0,
        attempts: [],
      },
      logs: [],
    };
  }

  async start() {
    if (this.isRunning) {
      console.log(`WebSocket server already running on port ${this.port}`);
      return this.port;
    }

    // Setup express routes
    this._setupRoutes();

    // Create WebSocket server
    this.wss = new WebSocketServer({ server: this.server });

    // Handle WebSocket connections
    this.wss.on('connection', (ws, req) => {
      this._handleConnection(ws, req);
    });

    // Start HTTP server
    return new Promise((resolve, reject) => {
      this.server.listen(this.port, () => {
        this.isRunning = true;
        this.metrics.startTime = Date.now();

        // Display prominent UI URL message
        console.log(`\n${'─'.repeat(60)}`);
        console.log(`  📊  AGENT VISUALIZATION UI`);
        console.log(`  🌐  Open in browser: \x1b[36m\x1b[1mhttp://localhost:${this.port}\x1b[0m`);
        console.log(`${'─'.repeat(60)}\n`);

        this.emit('started', { port: this.port, url: `http://localhost:${this.port}` });
        resolve(this.port);
      });

      this.server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
          // Try next port
          this.port++;
          this.server.listen(this.port);
        } else {
          reject(err);
        }
      });
    });
  }

  _setupRoutes() {
    // Serve static files from the React build directory
    const staticPath = join(__dirname, '../web/dist');
    this.app.use(express.static(staticPath));

    // API endpoints
    this.app.get('/api/state', (req, res) => {
      res.json(this.state);
    });

    this.app.get('/api/history', (req, res) => {
      const limit = parseInt(req.query.limit) || 100;
      const offset = parseInt(req.query.offset) || 0;
      res.json({
        events: this.eventHistory.slice(offset, offset + limit),
        total: this.eventHistory.length,
      });
    });

    this.app.get('/api/metrics', (req, res) => {
      res.json(this._getMetrics());
    });

    this.app.get('/api/health', (req, res) => {
      res.json({
        status: 'ok',
        uptime: this.metrics.startTime ? Date.now() - this.metrics.startTime : 0,
        clients: this.clients.size,
      });
    });

    // Serve React app for all other routes (SPA support)
    this.app.get('/{*path}', (req, res) => {
      res.sendFile(join(staticPath, 'index.html'));
    });
  }

  _handleConnection(ws, req) {
    this.clients.add(ws);
    this.metrics.clientConnections++;

    const clientId = `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    ws.clientId = clientId;

    console.log(`WebSocket client connected: ${clientId} (total: ${this.clients.size})`);

    // Send current state to new client
    this._send(ws, 'state', this.state);

    // Send recent history
    const recentHistory = this.eventHistory.slice(-100);
    if (recentHistory.length > 0) {
      this._send(ws, 'history', recentHistory);
    }

    // Handle messages from client
    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        this._handleClientMessage(ws, message);
      } catch (e) {
        console.error('Invalid message from client:', e.message);
      }
    });

    // Handle disconnection
    ws.on('close', () => {
      this.clients.delete(ws);
      console.log(`WebSocket client disconnected: ${clientId} (remaining: ${this.clients.size})`);
    });

    // Handle errors
    ws.on('error', (err) => {
      console.error(`WebSocket error for client ${clientId}:`, err.message);
      this.clients.delete(ws);
    });

    // Ping to keep connection alive
    ws.isAlive = true;
    ws.on('pong', () => {
      ws.isAlive = true;
    });
  }

  _handleClientMessage(ws, message) {
    switch (message.type) {
      case 'ping':
        this._send(ws, 'pong', { timestamp: Date.now() });
        break;
      case 'getState':
        this._send(ws, 'state', this.state);
        break;
      case 'getHistory':
        const limit = message.limit || 100;
        this._send(ws, 'history', this.eventHistory.slice(-limit));
        break;
      case 'getMetrics':
        this._send(ws, 'metrics', this._getMetrics());
        break;
      default:
        // Forward to event listeners (for potential control commands)
        this.emit('clientMessage', { clientId: ws.clientId, message });
    }
  }

  /**
   * Send a message to a single client with backpressure handling
   * Returns true if message was sent, false if client was skipped due to backpressure
   */
  _send(ws, type, data) {
    if (ws.readyState !== ws.OPEN) {
      return false;
    }

    // Check for backpressure - bufferedAmount indicates how much data is queued
    // Skip clients with large buffers to prevent event loop blocking
    const MAX_BUFFER_SIZE = 1024 * 1024; // 1MB max buffer before skipping
    if (ws.bufferedAmount > MAX_BUFFER_SIZE) {
      // Track skipped messages for monitoring
      ws._skippedMessages = (ws._skippedMessages || 0) + 1;
      return false;
    }

    try {
      ws.send(JSON.stringify({ type, data, timestamp: Date.now() }));
      return true;
    } catch (err) {
      console.error('WebSocket send error:', err.message);
      return false;
    }
  }

  /**
   * Broadcast a message to all clients with backpressure handling
   * Slow clients will be skipped to prevent blocking
   */
  broadcast(type, data) {
    const message = { type, data, timestamp: Date.now() };
    const messageStr = JSON.stringify(message);

    // Add to history
    this._addToHistory(type, data);

    // Update internal state based on event type
    this._updateState(type, data);

    // Broadcast to all connected clients with backpressure handling
    const MAX_BUFFER_SIZE = 1024 * 1024; // 1MB max buffer before skipping
    let sentCount = 0;
    let skippedCount = 0;

    for (const client of this.clients) {
      if (client.readyState !== client.OPEN) {
        continue;
      }

      // Check for backpressure
      if (client.bufferedAmount > MAX_BUFFER_SIZE) {
        client._skippedMessages = (client._skippedMessages || 0) + 1;
        skippedCount++;
        continue;
      }

      try {
        client.send(messageStr);
        sentCount++;
      } catch (err) {
        console.error('WebSocket broadcast error:', err.message);
      }
    }

    // Log if clients are being skipped (indicates slow clients)
    if (skippedCount > 0) {
      console.warn(`Broadcast skipped ${skippedCount} slow clients (type: ${type})`);
    }

    // Emit for local listeners
    this.emit('broadcast', { type, data, sentCount, skippedCount });
  }

  _addToHistory(type, data) {
    this.eventHistory.push({
      type,
      data,
      timestamp: Date.now(),
    });

    // Trim history if too large
    if (this.eventHistory.length > this.maxHistorySize) {
      this.eventHistory = this.eventHistory.slice(-this.maxHistorySize);
    }
  }

  _updateState(type, data) {
    this.metrics.messagesProcessed++;

    switch (type) {
      case 'progress':
        this._handleProgressEvent(data);
        break;
      case 'message':
        this.state.lastMessage = {
          content: data.content,
          iteration: data.iteration,
          timestamp: Date.now(),
        };
        this.state.iteration = data.iteration || this.state.iteration;
        // Add to logs
        this._addLog('message', data.content?.substring(0, 200) + '...');
        break;
      case 'error':
        this.state.lastError = {
          error: data.error,
          timestamp: Date.now(),
        };
        this.metrics.errorsEncountered++;
        this._addLog('error', data.error);
        break;
      case 'supervision':
        this.state.supervision = data;
        this.metrics.supervisionEvents++;
        this._addLog('supervision', `${data.assessment?.action || 'unknown'}: ${data.assessment?.reason || ''}`);
        break;
      case 'escalation':
        this._addLog('escalation', data.message || data.type);
        break;
      case 'verification':
        this.state.verification = data;
        this._addLog('verification', `Passed: ${data.passed}`);
        break;
      case 'complete':
        this.state.status = data.status === 'completed' ? 'completed' : 'failed';
        this.state.finalReport = data;
        this._stopTimeUpdates(); // Stop time updates when completed
        this._addLog('complete', `Status: ${data.status}`);
        break;
    }

    // Broadcast state update
    this._broadcastStateUpdate();
  }

  _handleProgressEvent(data) {
    const type = data.type;

    switch (type) {
      case 'initialized':
        this.state = {
          ...this._createInitialState(),
          status: 'initializing',
          goal: data.goal,
          subGoals: data.subGoals || [],
          timeLimit: data.timeLimit,
          session: data.sessionId,
          workingDirectory: data.workingDirectory,
        };
        this._addLog('info', 'Agent initialized');
        break;

      case 'started':
        // Execution started - start time tracking
        this._executionStartTime = Date.now();
        this.state.status = 'executing';
        this.state.timeElapsed = 0;
        this._startTimeUpdates();
        this._addLog('info', 'Execution started');
        break;

      case 'planning':
        this.state.status = 'planning';
        // Start time tracking if not already started
        if (!this._executionStartTime) {
          this._executionStartTime = Date.now();
          this._startTimeUpdates();
        }
        this._addLog('info', data.message || 'Creating execution plan...');
        break;

      case 'plan_created':
        this.state.plan = data.plan;
        this.state.status = 'executing';
        this._addLog('info', `Plan created with ${data.plan?.steps?.length || 0} steps`);
        break;

      case 'step_started':
        this.state.currentStep = data.step;
        this._addLog('info', `Starting step ${data.step?.number}: ${data.step?.description}`);
        break;

      case 'step_complete':
        // Create new array to prevent race conditions with broadcasts
        this.state.completedSteps = [...this.state.completedSteps, data.step];
        this.state.currentStep = null;
        this.metrics.stepsCompleted++;
        this._updatePlanStepStatus(data.step?.number, 'completed');
        this._addLog('success', `Completed step ${data.step?.number}: ${data.step?.description}`);
        break;

      case 'step_failed':
      case 'step_rejected':
        // Create new array to prevent race conditions with broadcasts
        this.state.failedSteps = [...this.state.failedSteps, { ...data.step, reason: data.reason }];
        this.state.currentStep = null;
        this.metrics.stepsFailed++;
        this._updatePlanStepStatus(data.step?.number, 'failed', data.reason);
        this._addLog('error', `Failed step ${data.step?.number}: ${data.reason}`);
        break;

      case 'step_blocked':
        this._updatePlanStepStatus(data.step?.number, 'blocked', data.reason);
        this._addLog('warning', `Blocked step ${data.step?.number}: ${data.reason}`);
        break;

      case 'step_verification_pending':
      case 'step_verification_started':
        this._addLog('info', `Verifying step ${data.step?.number}...`);
        break;

      case 'subplan_created':
        this._addLog('info', `Sub-plan created with ${data.subPlan?.steps?.length || 0} sub-steps`);
        break;

      case 'final_verification_started':
        this.state.status = 'verifying';
        this._addLog('info', 'Running final verification...');
        break;

      case 'goal_verification_complete':
        this.state.verification = {
          ...this.state.verification,
          goal: data.result,
        };
        const goalIcon = data.result?.achieved ? '✓' : '✗';
        this._addLog(data.result?.achieved ? 'success' : 'warning',
          `${goalIcon} Goal: ${data.result?.achieved ? 'Achieved' : 'Not achieved'} (${data.result?.confidence})`);
        break;

      case 'final_verification_passed':
        this._addLog('success', 'FINAL VERIFICATION PASSED');
        break;

      case 'final_verification_failed':
        this._addLog('error', `FINAL VERIFICATION FAILED: ${data.reason || 'see report'}`);
        break;

      case 'retry_loop_started':
        this.state.retryMode = {
          enabled: true,
          currentAttempt: 0,
          maxAttempts: data.maxAttempts,
          overallTimeLimit: data.overallTimeLimit,
          attempts: [],
        };
        this._addLog('info', `Retry mode: Max ${data.maxAttempts} attempts`);
        break;

      case 'attempt_starting':
        this.state.retryMode.currentAttempt = data.attemptNumber;
        this.state.retryMode.timeRemaining = data.timeRemaining;
        this._addLog('info', `Starting attempt ${data.attemptNumber}/${data.maxAttempts}`);
        break;

      case 'attempt_completed':
        this.state.retryMode.attempts.push({
          number: data.attemptNumber,
          status: data.status,
          confidence: data.confidence,
          duration: data.duration,
          completedSteps: data.completedSteps,
          failedSteps: data.failedSteps,
        });
        this._addLog(data.confidence === 'HIGH' ? 'success' : 'info',
          `Attempt ${data.attemptNumber}: ${data.confidence} confidence`);
        break;

      case 'retry_loop_completed':
        this.state.status = data.overallSuccess ? 'completed' : 'failed';
        this._stopTimeUpdates(); // Stop time updates when completed
        this._addLog(data.overallSuccess ? 'success' : 'warning',
          `Retry loop complete: ${data.finalConfidence} confidence after ${data.totalAttempts} attempts`);
        break;

      case 'time_exhausted':
        this._addLog('warning', `Time exhausted after ${data.totalAttempts} attempts`);
        break;

      case 'fix_cycle_started':
        this._addLog('info', `Fix cycle ${data.cycle}: ${data.issues?.length || 0} issues`);
        break;
    }

    // Update progress percentage
    if (data.planProgress) {
      this.state.progress = Math.round((data.planProgress.current / data.planProgress.total) * 100);
    }
    if (data.progress !== undefined) {
      this.state.progress = data.progress;
    }

    // Update timing
    if (data.elapsed !== undefined) {
      this.state.timeElapsed = data.elapsed;
    }
    if (data.remaining !== undefined) {
      this.state.timeRemaining = data.remaining;
    }

    // Update iteration
    if (data.iteration !== undefined) {
      this.state.iteration = data.iteration;
    }
  }

  _updatePlanStepStatus(stepNumber, status, reason) {
    if (this.state.plan?.steps) {
      // Create a new steps array to ensure React detects the change
      // This prevents race conditions where the broadcast sees stale data
      this.state.plan = {
        ...this.state.plan,
        steps: this.state.plan.steps.map(step => {
          if (step.number === stepNumber) {
            return {
              ...step,
              status,
              ...(reason ? { failReason: reason } : {}),
            };
          }
          return step;
        }),
      };
    }
  }

  _addLog(level, message) {
    const log = {
      id: Date.now() + Math.random(),
      level,
      message,
      timestamp: Date.now(),
    };
    // Create new array to prevent race conditions with broadcasts
    // Also keep logs manageable by limiting to last 500
    const newLogs = [...this.state.logs, log];
    this.state.logs = newLogs.length > 500 ? newLogs.slice(-500) : newLogs;
  }

  /**
   * Create a deep snapshot of the current state for atomic broadcast
   * This ensures all clients receive a consistent state even if updates
   * happen during the broadcast iteration
   */
  _createStateSnapshot() {
    return {
      ...this.state,
      // Deep copy nested objects that change frequently
      plan: this.state.plan ? {
        ...this.state.plan,
        steps: this.state.plan.steps ? this.state.plan.steps.map(s => ({ ...s })) : [],
      } : null,
      completedSteps: [...this.state.completedSteps],
      failedSteps: this.state.failedSteps.map(s => ({ ...s })),
      subGoals: [...this.state.subGoals],
      logs: this.state.logs.map(l => ({ ...l })),
      lastMessage: this.state.lastMessage ? { ...this.state.lastMessage } : null,
      lastError: this.state.lastError ? { ...this.state.lastError } : null,
      supervision: this.state.supervision ? { ...this.state.supervision } : null,
      verification: this.state.verification ? { ...this.state.verification } : null,
      retryMode: {
        ...this.state.retryMode,
        attempts: this.state.retryMode.attempts.map(a => ({ ...a })),
      },
    };
  }

  _broadcastStateUpdate() {
    // Increment state version for change tracking
    this._stateVersion++;

    // Use debounced broadcasts to prevent overwhelming clients
    if (this._broadcastPending) {
      // Update already scheduled, it will pick up the latest state
      return;
    }

    this._broadcastPending = true;

    // Clear any existing timer
    if (this._broadcastTimer) {
      clearTimeout(this._broadcastTimer);
    }

    // Batch rapid updates into a single broadcast
    this._broadcastTimer = setTimeout(() => {
      this._broadcastPending = false;
      this._broadcastTimer = null;

      // Update timeElapsed before broadcasting if execution is running
      if (this._executionStartTime && ['executing', 'planning', 'verifying'].includes(this.state.status)) {
        this.state.timeElapsed = Date.now() - this._executionStartTime;
      }

      // Create a snapshot of state for atomic broadcast
      // This ensures all clients receive the same consistent state
      const stateSnapshot = this._createStateSnapshot();

      const stateMessage = JSON.stringify({
        type: 'stateUpdate',
        data: stateSnapshot,
        timestamp: Date.now(),
        version: this._stateVersion,
      });

      // Broadcast with backpressure handling
      const MAX_BUFFER_SIZE = 1024 * 1024; // 1MB max buffer before skipping
      let skippedCount = 0;

      for (const client of this.clients) {
        if (client.readyState !== client.OPEN) {
          continue;
        }

        // Check for backpressure - skip clients with large buffers
        if (client.bufferedAmount > MAX_BUFFER_SIZE) {
          client._skippedMessages = (client._skippedMessages || 0) + 1;
          skippedCount++;
          continue;
        }

        try {
          client.send(stateMessage);
        } catch (err) {
          // Don't let send errors stop other broadcasts
          console.error('WebSocket send error:', err.message);
        }
      }

      // Log if clients are being skipped (indicates slow clients)
      if (skippedCount > 0) {
        console.warn(`State broadcast skipped ${skippedCount} slow clients`);
      }
    }, 50); // 50ms debounce - allows batching without feeling sluggish
  }

  /**
   * Start periodic time updates to keep elapsed time accurate in web UI
   */
  _startTimeUpdates() {
    if (this._timeUpdateInterval) return;

    this._timeUpdateInterval = setInterval(() => {
      if (this._executionStartTime && ['executing', 'planning', 'verifying'].includes(this.state.status)) {
        this.state.timeElapsed = Date.now() - this._executionStartTime;

        // Calculate remaining time if timeLimit is set
        if (this.state.timeLimit) {
          const limitMs = this._parseTimeLimit(this.state.timeLimit);
          this.state.timeRemaining = Math.max(0, limitMs - this.state.timeElapsed);
        }

        // Broadcast updated time (will be debounced)
        this._broadcastStateUpdate();
      }
    }, 1000); // Update every second
  }

  /**
   * Stop periodic time updates
   */
  _stopTimeUpdates() {
    if (this._timeUpdateInterval) {
      clearInterval(this._timeUpdateInterval);
      this._timeUpdateInterval = null;
    }
  }

  /**
   * Parse time limit string to milliseconds
   */
  _parseTimeLimit(str) {
    if (!str) return 0;
    const match = str.match(/^(\d+)(m|h|d)?$/);
    if (!match) return 2 * 60 * 60 * 1000; // default 2h

    const value = parseInt(match[1], 10);
    const unit = match[2] || 'h';
    const multipliers = { m: 60 * 1000, h: 60 * 60 * 1000, d: 24 * 60 * 60 * 1000 };
    return value * multipliers[unit];
  }

  _getMetrics() {
    const now = Date.now();
    return {
      ...this.metrics,
      uptime: this.metrics.startTime ? now - this.metrics.startTime : 0,
      connectedClients: this.clients.size,
      eventsInHistory: this.eventHistory.length,
      state: {
        status: this.state.status,
        progress: this.state.progress,
        stepsTotal: this.state.plan?.steps?.length || 0,
        stepsCompleted: this.state.completedSteps.length,
        stepsFailed: this.state.failedSteps.length,
      },
    };
  }

  // Create handler functions that integrate with the existing runner pattern
  // Each handler is wrapped in try-catch to ensure:
  // 1. Dashboard handler errors don't prevent WebSocket broadcasts
  // 2. WebSocket errors don't prevent dashboard updates
  createHandlers(existingHandlers = {}) {
    return {
      onProgress: (data) => {
        // Call existing handler first (dashboard), catch any errors
        try {
          existingHandlers.onProgress?.(data);
        } catch (err) {
          console.error('Handler onProgress error:', err.message);
        }
        // Always broadcast to WebSocket clients
        try {
          this.broadcast('progress', data);
        } catch (err) {
          console.error('Broadcast progress error:', err.message);
        }
      },
      onMessage: (data) => {
        try {
          existingHandlers.onMessage?.(data);
        } catch (err) {
          console.error('Handler onMessage error:', err.message);
        }
        try {
          this.broadcast('message', data);
        } catch (err) {
          console.error('Broadcast message error:', err.message);
        }
      },
      onError: (data) => {
        try {
          existingHandlers.onError?.(data);
        } catch (err) {
          console.error('Handler onError error:', err.message);
        }
        try {
          this.broadcast('error', data);
        } catch (err) {
          console.error('Broadcast error error:', err.message);
        }
      },
      onSupervision: (data) => {
        try {
          existingHandlers.onSupervision?.(data);
        } catch (err) {
          console.error('Handler onSupervision error:', err.message);
        }
        try {
          this.broadcast('supervision', data);
        } catch (err) {
          console.error('Broadcast supervision error:', err.message);
        }
      },
      onEscalation: (data) => {
        try {
          existingHandlers.onEscalation?.(data);
        } catch (err) {
          console.error('Handler onEscalation error:', err.message);
        }
        try {
          this.broadcast('escalation', data);
        } catch (err) {
          console.error('Broadcast escalation error:', err.message);
        }
      },
      onVerification: (data) => {
        try {
          existingHandlers.onVerification?.(data);
        } catch (err) {
          console.error('Handler onVerification error:', err.message);
        }
        try {
          this.broadcast('verification', data);
        } catch (err) {
          console.error('Broadcast verification error:', err.message);
        }
      },
      onComplete: (report) => {
        try {
          existingHandlers.onComplete?.(report);
        } catch (err) {
          console.error('Handler onComplete error:', err.message);
        }
        try {
          this.broadcast('complete', report);
        } catch (err) {
          console.error('Broadcast complete error:', err.message);
        }
      },
    };
  }

  async stop() {
    if (!this.isRunning) return;

    // Stop time updates
    this._stopTimeUpdates();

    // Clear broadcast timer
    if (this._broadcastTimer) {
      clearTimeout(this._broadcastTimer);
      this._broadcastTimer = null;
    }
    this._broadcastPending = false;

    // Close all WebSocket connections
    for (const client of this.clients) {
      client.close(1000, 'Server shutting down');
    }
    this.clients.clear();

    // Close WebSocket server
    if (this.wss) {
      await new Promise((resolve) => this.wss.close(resolve));
    }

    // Close HTTP server
    await new Promise((resolve) => this.server.close(resolve));

    this.isRunning = false;
    this._executionStartTime = null;
    this.emit('stopped');
    console.log('WebSocket server stopped');
  }

  // Start heartbeat interval to check client connections
  startHeartbeat(interval = 30000) {
    this.heartbeatInterval = setInterval(() => {
      for (const ws of this.clients) {
        if (!ws.isAlive) {
          ws.terminate();
          this.clients.delete(ws);
          continue;
        }
        ws.isAlive = false;
        ws.ping();
      }
    }, interval);
  }

  stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }
  }
}

// Factory function for easy integration
export function createAgentWebSocketServer(options = {}) {
  return new AgentWebSocketServer(options);
}

export default AgentWebSocketServer;
