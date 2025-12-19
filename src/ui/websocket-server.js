/**
 * WebSocket Server for Real-time Agent Visualization
 *
 * Broadcasts real-time events from the agent runner to connected clients.
 */

import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import express from 'express';
import { EventEmitter } from 'events';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

import { createInitialState, createStateSnapshot, parseTimeLimit } from './websocket/ws-state.js';
import {
  handleProgressEvent, handleMessageEvent, handleErrorEvent,
  handleSupervisionEvent, handleEscalationEvent, handleVerificationEvent,
  handleCompleteEvent,
} from './websocket/ws-progress-handler.js';
import {
  broadcastToClients, broadcastStateUpdate, EventHistory, DebouncedBroadcaster,
} from './websocket/ws-broadcaster.js';
import {
  setupClientHandlers, handleClientMessage, HeartbeatManager, TimeUpdateManager,
} from './websocket/ws-connection-handler.js';
import { createMetrics, getFormattedMetrics, createEventHandlers } from './websocket/ws-metrics.js';

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
    this.eventHistory = new EventHistory(options.maxHistorySize || 1000);
    this.state = createInitialState();
    this.isRunning = false;
    this.metrics = createMetrics();
    this._broadcaster = new DebouncedBroadcaster({ debounceMs: 50 });
    this._timeManager = new TimeUpdateManager({ interval: 1000 });
    this._heartbeatManager = null;
  }

  async start() {
    if (this.isRunning) {
      console.log(`WebSocket server already running on port ${this.port}`);
      return this.port;
    }

    this._setupRoutes();
    this.wss = new WebSocketServer({ server: this.server });
    this.wss.on('connection', (ws) => this._handleConnection(ws));

    return new Promise((resolve, reject) => {
      this.server.listen(this.port, () => {
        this.isRunning = true;
        this.metrics.startTime = Date.now();
        console.log(`\n${'─'.repeat(60)}`);
        console.log(`  📊  AGENT VISUALIZATION UI`);
        console.log(`  🌐  Open in browser: \x1b[36m\x1b[1mhttp://localhost:${this.port}\x1b[0m`);
        console.log(`${'─'.repeat(60)}\n`);
        this.emit('started', { port: this.port, url: `http://localhost:${this.port}` });
        resolve(this.port);
      });
      this.server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') { this.port++; this.server.listen(this.port); }
        else reject(err);
      });
    });
  }

  _setupRoutes() {
    const staticPath = join(__dirname, '../web/dist');
    this.app.use(express.static(staticPath));
    this.app.get('/api/state', (req, res) => res.json(this.state));
    this.app.get('/api/history', (req, res) => {
      const limit = parseInt(req.query.limit) || 100;
      const offset = parseInt(req.query.offset) || 0;
      res.json({ events: this.eventHistory.getRecent(limit, offset), total: this.eventHistory.length });
    });
    this.app.get('/api/metrics', (req, res) => res.json(this._getMetrics()));
    this.app.get('/api/health', (req, res) => {
      res.json({ status: 'ok', uptime: this.metrics.startTime ? Date.now() - this.metrics.startTime : 0, clients: this.clients.size });
    });
    this.app.get('/{*path}', (req, res) => res.sendFile(join(staticPath, 'index.html')));
  }

  _handleConnection(ws) {
    this.clients.add(ws);
    this.metrics.clientConnections++;
    setupClientHandlers(ws, {
      clients: this.clients,
      state: this.state,
      eventHistory: this.eventHistory.events,
      onMessage: (client, message) => {
        handleClientMessage(client, message, {
          state: this.state, eventHistory: this.eventHistory,
          getMetrics: () => this._getMetrics(),
          emit: (event, data) => this.emit(event, data),
        });
      },
    });
  }

  broadcast(type, data) {
    this.eventHistory.add(type, data);
    this._updateState(type, data);
    const result = broadcastToClients(this.clients, type, data);
    this.emit('broadcast', { type, data, ...result });
  }

  _updateState(type, data) {
    this.metrics.messagesProcessed++;
    const callbacks = { onStartTimeUpdates: () => this._startTimeUpdates(), onStopTimeUpdates: () => this._stopTimeUpdates() };

    switch (type) {
      case 'progress':
        this.state = handleProgressEvent(this.state, data, callbacks);
        if (data.type === 'step_complete') this.metrics.stepsCompleted++;
        if (data.type === 'step_failed' || data.type === 'step_rejected') this.metrics.stepsFailed++;
        break;
      case 'message': this.state = handleMessageEvent(this.state, data); break;
      case 'error': this.state = handleErrorEvent(this.state, data); this.metrics.errorsEncountered++; break;
      case 'supervision': this.state = handleSupervisionEvent(this.state, data); this.metrics.supervisionEvents++; break;
      case 'escalation': this.state = handleEscalationEvent(this.state, data); break;
      case 'verification': this.state = handleVerificationEvent(this.state, data); break;
      case 'complete': this.state = handleCompleteEvent(this.state, data, callbacks); break;
    }
    this._broadcastStateUpdate();
  }

  _broadcastStateUpdate() {
    this._broadcaster.schedule((version) => {
      if (this._timeManager.startTime && ['executing', 'planning', 'verifying'].includes(this.state.status)) {
        this.state.timeElapsed = Date.now() - this._timeManager.startTime;
      }
      broadcastStateUpdate(this.clients, createStateSnapshot(this.state), version);
    });
  }

  _startTimeUpdates() {
    if (this._timeManager.isRunning) return;
    this._timeManager.start((elapsed) => {
      if (['executing', 'planning', 'verifying'].includes(this.state.status)) {
        this.state.timeElapsed = elapsed;
        if (this.state.timeLimit) {
          this.state.timeRemaining = Math.max(0, parseTimeLimit(this.state.timeLimit) - elapsed);
        }
        this._broadcastStateUpdate();
      }
    });
  }

  _stopTimeUpdates() { this._timeManager.stop(); }

  _getMetrics() {
    return getFormattedMetrics(this.metrics, { clients: this.clients, eventHistory: this.eventHistory, state: this.state });
  }

  createHandlers(existingHandlers = {}) {
    return createEventHandlers(existingHandlers, (type, data) => this.broadcast(type, data));
  }

  async stop() {
    if (!this.isRunning) return;
    this._stopTimeUpdates();
    this._broadcaster.cancel();
    this.stopHeartbeat();
    for (const client of this.clients) client.close(1000, 'Server shutting down');
    this.clients.clear();
    if (this.wss) await new Promise((resolve) => this.wss.close(resolve));
    await new Promise((resolve) => this.server.close(resolve));
    this.isRunning = false;
    this.emit('stopped');
    console.log('WebSocket server stopped');
  }

  startHeartbeat(interval = 30000) {
    if (!this._heartbeatManager) this._heartbeatManager = new HeartbeatManager(this.clients, interval);
    this._heartbeatManager.start();
  }

  stopHeartbeat() { if (this._heartbeatManager) this._heartbeatManager.stop(); }
}

export function createAgentWebSocketServer(options = {}) { return new AgentWebSocketServer(options); }
export default AgentWebSocketServer;
