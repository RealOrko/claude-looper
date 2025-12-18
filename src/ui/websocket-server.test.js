/**
 * Tests for the WebSocket server module
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AgentWebSocketServer } from './websocket-server.js';
import WebSocket from 'ws';

describe('AgentWebSocketServer', () => {
  let server;
  let portCounter = 4000; // Start from port 4000 to avoid conflicts

  beforeEach(() => {
    // Use incrementing ports to avoid conflicts between tests
    portCounter += Math.floor(Math.random() * 100) + 1;
    server = new AgentWebSocketServer({ port: portCounter });
  });

  afterEach(async () => {
    if (server && server.isRunning) {
      server.stopHeartbeat();
      await server.stop();
    }
  });

  describe('initialization', () => {
    it('should create server with default state', () => {
      expect(server.state.status).toBe('idle');
      expect(server.clients.size).toBe(0);
      expect(server.eventHistory).toHaveLength(0);
    });

    it('should start and listen on a port', async () => {
      const port = await server.start();
      expect(port).toBeGreaterThan(0);
      expect(server.isRunning).toBe(true);
    });

    it('should stop cleanly', async () => {
      await server.start();
      await server.stop();
      expect(server.isRunning).toBe(false);
    });
  });

  describe('WebSocket connections', () => {
    it('should accept client connections', async () => {
      const port = await server.start();

      const client = new WebSocket(`ws://localhost:${port}`);
      await new Promise((resolve) => client.on('open', resolve));

      expect(server.clients.size).toBe(1);

      client.close();
      await new Promise((resolve) => setTimeout(resolve, 100));
    });

    it('should send initial state to new clients', async () => {
      const port = await server.start();

      const messages = [];
      const client = new WebSocket(`ws://localhost:${port}`);
      client.on('message', (data) => {
        messages.push(JSON.parse(data.toString()));
      });

      await new Promise((resolve) => client.on('open', resolve));
      await new Promise((resolve) => setTimeout(resolve, 100));

      const stateMessage = messages.find((m) => m.type === 'state');
      expect(stateMessage).toBeDefined();
      expect(stateMessage.data.status).toBe('idle');

      client.close();
    });
  });

  describe('broadcasting', () => {
    it('should broadcast progress events to clients', async () => {
      const port = await server.start();

      const messages = [];
      const client = new WebSocket(`ws://localhost:${port}`);
      client.on('message', (data) => {
        messages.push(JSON.parse(data.toString()));
      });

      await new Promise((resolve) => client.on('open', resolve));
      await new Promise((resolve) => setTimeout(resolve, 100));

      server.broadcast('progress', {
        type: 'initialized',
        goal: 'Test goal',
        sessionId: 'test-session',
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      const progressMessage = messages.find(
        (m) => m.type === 'progress' && m.data.type === 'initialized'
      );
      expect(progressMessage).toBeDefined();
      expect(progressMessage.data.goal).toBe('Test goal');

      client.close();
    });

    it('should update state on progress events', async () => {
      await server.start();

      server.broadcast('progress', {
        type: 'initialized',
        goal: 'Test goal',
        sessionId: 'test-session',
      });

      expect(server.state.status).toBe('initializing');
      expect(server.state.goal).toBe('Test goal');

      server.broadcast('progress', {
        type: 'planning',
        message: 'Creating plan...',
      });

      expect(server.state.status).toBe('planning');

      server.broadcast('progress', {
        type: 'plan_created',
        plan: {
          steps: [
            { number: 1, description: 'Step 1', complexity: 'low' },
            { number: 2, description: 'Step 2', complexity: 'medium' },
          ],
        },
      });

      expect(server.state.status).toBe('executing');
      expect(server.state.plan.steps).toHaveLength(2);
    });

    it('should track step progress', async () => {
      await server.start();

      server.broadcast('progress', {
        type: 'plan_created',
        plan: {
          steps: [
            { number: 1, description: 'Step 1', complexity: 'low' },
          ],
        },
      });

      server.broadcast('progress', {
        type: 'step_complete',
        step: { number: 1, description: 'Step 1' },
      });

      expect(server.state.completedSteps).toHaveLength(1);
      expect(server.metrics.stepsCompleted).toBe(1);
    });
  });

  describe('event history', () => {
    it('should store events in history', async () => {
      await server.start();

      server.broadcast('progress', { type: 'initialized' });
      server.broadcast('progress', { type: 'planning' });

      expect(server.eventHistory).toHaveLength(2);
      expect(server.eventHistory[0].type).toBe('progress');
    });

    it('should limit history size', async () => {
      portCounter += Math.floor(Math.random() * 100) + 1;
      server = new AgentWebSocketServer({ port: portCounter, maxHistorySize: 5 });
      await server.start();

      for (let i = 0; i < 10; i++) {
        server.broadcast('progress', { type: 'update', index: i });
      }

      expect(server.eventHistory).toHaveLength(5);
      expect(server.eventHistory[0].data.index).toBe(5);
    });
  });

  describe('handler wrapping', () => {
    it('should create handlers that wrap existing handlers', async () => {
      await server.start();

      const existingCalls = [];
      const existingHandlers = {
        onProgress: (data) => existingCalls.push({ type: 'progress', data }),
        onMessage: (data) => existingCalls.push({ type: 'message', data }),
      };

      const wrappedHandlers = server.createHandlers(existingHandlers);

      wrappedHandlers.onProgress({ type: 'test' });
      wrappedHandlers.onMessage({ content: 'hello' });

      expect(existingCalls).toHaveLength(2);
      expect(server.eventHistory).toHaveLength(2);
    });

    it('should work without existing handlers', async () => {
      await server.start();

      const wrappedHandlers = server.createHandlers({});

      wrappedHandlers.onProgress({ type: 'test' });

      expect(server.eventHistory).toHaveLength(1);
    });
  });

  describe('API endpoints', () => {
    it('should serve state via REST API', async () => {
      const port = await server.start();

      const response = await fetch(`http://localhost:${port}/api/state`);
      const data = await response.json();

      expect(data.status).toBe('idle');
    });

    it('should serve metrics via REST API', async () => {
      const port = await server.start();

      const response = await fetch(`http://localhost:${port}/api/metrics`);
      const data = await response.json();

      expect(data.connectedClients).toBe(0);
      expect(data.messagesProcessed).toBe(0);
    });

    it('should serve health status', async () => {
      const port = await server.start();

      const response = await fetch(`http://localhost:${port}/api/health`);
      const data = await response.json();

      expect(data.status).toBe('ok');
      expect(data.uptime).toBeGreaterThanOrEqual(0);
    });
  });
});
