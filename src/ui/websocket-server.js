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

  _send(ws, type, data) {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type, data, timestamp: Date.now() }));
    }
  }

  broadcast(type, data) {
    const message = { type, data, timestamp: Date.now() };
    const messageStr = JSON.stringify(message);

    // Add to history
    this._addToHistory(type, data);

    // Update internal state based on event type
    this._updateState(type, data);

    // Broadcast to all connected clients
    for (const client of this.clients) {
      if (client.readyState === client.OPEN) {
        client.send(messageStr);
      }
    }

    // Emit for local listeners
    this.emit('broadcast', { type, data });
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

      case 'planning':
        this.state.status = 'planning';
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
        this.state.completedSteps.push(data.step);
        this.state.currentStep = null;
        this.metrics.stepsCompleted++;
        this._updatePlanStepStatus(data.step?.number, 'completed');
        this._addLog('success', `Completed step ${data.step?.number}: ${data.step?.description}`);
        break;

      case 'step_failed':
      case 'step_rejected':
        this.state.failedSteps.push({ ...data.step, reason: data.reason });
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

      case 'smoke_tests_complete':
        this.state.verification = {
          ...this.state.verification,
          smokeTests: data.result,
        };
        const testIcon = data.result?.passed ? '✓' : '✗';
        this._addLog(data.result?.passed ? 'success' : 'warning',
          `${testIcon} Smoke tests: ${data.result?.summary || (data.result?.passed ? 'Passed' : 'Failed')}`);
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
      const step = this.state.plan.steps.find(s => s.number === stepNumber);
      if (step) {
        step.status = status;
        if (reason) step.failReason = reason;
      }
    }
  }

  _addLog(level, message) {
    const log = {
      id: Date.now() + Math.random(),
      level,
      message,
      timestamp: Date.now(),
    };
    this.state.logs.push(log);

    // Keep logs manageable
    if (this.state.logs.length > 500) {
      this.state.logs = this.state.logs.slice(-500);
    }
  }

  _broadcastStateUpdate() {
    const stateMessage = JSON.stringify({
      type: 'stateUpdate',
      data: this.state,
      timestamp: Date.now()
    });

    for (const client of this.clients) {
      if (client.readyState === client.OPEN) {
        client.send(stateMessage);
      }
    }
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
  createHandlers(existingHandlers = {}) {
    return {
      onProgress: (data) => {
        existingHandlers.onProgress?.(data);
        this.broadcast('progress', data);
      },
      onMessage: (data) => {
        existingHandlers.onMessage?.(data);
        this.broadcast('message', data);
      },
      onError: (data) => {
        existingHandlers.onError?.(data);
        this.broadcast('error', data);
      },
      onSupervision: (data) => {
        existingHandlers.onSupervision?.(data);
        this.broadcast('supervision', data);
      },
      onEscalation: (data) => {
        existingHandlers.onEscalation?.(data);
        this.broadcast('escalation', data);
      },
      onVerification: (data) => {
        existingHandlers.onVerification?.(data);
        this.broadcast('verification', data);
      },
      onComplete: (report) => {
        existingHandlers.onComplete?.(report);
        this.broadcast('complete', report);
      },
    };
  }

  async stop() {
    if (!this.isRunning) return;

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
