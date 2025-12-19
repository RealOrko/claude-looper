/**
 * Tests for ws-connection-handler.js
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  generateClientId,
  setupClientHandlers,
  handleClientMessage,
  HeartbeatManager,
  TimeUpdateManager,
} from '../ws-connection-handler.js';

describe('ws-connection-handler', () => {
  describe('generateClientId', () => {
    it('should generate unique client IDs', () => {
      const id1 = generateClientId();
      const id2 = generateClientId();

      expect(id1).toMatch(/^client_\d+_[a-z0-9]+$/);
      expect(id2).toMatch(/^client_\d+_[a-z0-9]+$/);
      expect(id1).not.toBe(id2);
    });
  });

  describe('setupClientHandlers', () => {
    it('should assign clientId to websocket', () => {
      const ws = { on: vi.fn(), readyState: 1, OPEN: 1, send: vi.fn() };
      const clients = new Set([ws]);

      vi.spyOn(console, 'log').mockImplementation(() => {});
      setupClientHandlers(ws, { clients, onMessage: vi.fn() });

      expect(ws.clientId).toMatch(/^client_/);
    });

    it('should register event handlers', () => {
      const ws = { on: vi.fn(), readyState: 1, OPEN: 1, send: vi.fn() };
      const clients = new Set([ws]);

      vi.spyOn(console, 'log').mockImplementation(() => {});
      setupClientHandlers(ws, { clients, onMessage: vi.fn() });

      const handlers = {};
      ws.on.mock.calls.forEach(([event, handler]) => {
        handlers[event] = handler;
      });

      expect(handlers.message).toBeDefined();
      expect(handlers.close).toBeDefined();
      expect(handlers.error).toBeDefined();
      expect(handlers.pong).toBeDefined();
    });

    it('should send state to new client if provided', () => {
      const ws = { on: vi.fn(), readyState: 1, OPEN: 1, bufferedAmount: 0, send: vi.fn() };
      const clients = new Set([ws]);
      const state = { status: 'executing' };

      vi.spyOn(console, 'log').mockImplementation(() => {});
      setupClientHandlers(ws, { clients, state, onMessage: vi.fn() });

      expect(ws.send).toHaveBeenCalledTimes(1);
      const sent = JSON.parse(ws.send.mock.calls[0][0]);
      expect(sent.type).toBe('state');
      expect(sent.data).toEqual(state);
    });

    it('should send recent history if provided', () => {
      const ws = { on: vi.fn(), readyState: 1, OPEN: 1, bufferedAmount: 0, send: vi.fn() };
      const clients = new Set([ws]);
      const eventHistory = [{ type: 'test', data: {} }];

      vi.spyOn(console, 'log').mockImplementation(() => {});
      setupClientHandlers(ws, { clients, eventHistory, onMessage: vi.fn() });

      expect(ws.send).toHaveBeenCalledTimes(1);
      const sent = JSON.parse(ws.send.mock.calls[0][0]);
      expect(sent.type).toBe('history');
    });

    it('should handle close event by removing from clients', () => {
      const ws = { on: vi.fn(), clientId: 'test' };
      const clients = new Set([ws]);

      vi.spyOn(console, 'log').mockImplementation(() => {});
      setupClientHandlers(ws, { clients, onMessage: vi.fn() });

      const closeHandler = ws.on.mock.calls.find(([e]) => e === 'close')[1];
      closeHandler();

      expect(clients.has(ws)).toBe(false);
    });

    it('should handle error event', () => {
      const ws = { on: vi.fn(), clientId: 'test' };
      const clients = new Set([ws]);

      vi.spyOn(console, 'log').mockImplementation(() => {});
      vi.spyOn(console, 'error').mockImplementation(() => {});
      setupClientHandlers(ws, { clients, onMessage: vi.fn() });

      const errorHandler = ws.on.mock.calls.find(([e]) => e === 'error')[1];
      errorHandler(new Error('Test error'));

      expect(clients.has(ws)).toBe(false);
    });

    it('should set isAlive true and handle pong', () => {
      const ws = { on: vi.fn() };
      const clients = new Set([ws]);

      vi.spyOn(console, 'log').mockImplementation(() => {});
      setupClientHandlers(ws, { clients, onMessage: vi.fn() });

      expect(ws.isAlive).toBe(true);

      ws.isAlive = false;
      const pongHandler = ws.on.mock.calls.find(([e]) => e === 'pong')[1];
      pongHandler();

      expect(ws.isAlive).toBe(true);
    });

    it('should call onMessage with parsed message', () => {
      const ws = { on: vi.fn(), readyState: 1, OPEN: 1, bufferedAmount: 0, send: vi.fn() };
      const clients = new Set([ws]);
      const onMessage = vi.fn();

      vi.spyOn(console, 'log').mockImplementation(() => {});
      setupClientHandlers(ws, { clients, onMessage });

      const messageHandler = ws.on.mock.calls.find(([e]) => e === 'message')[1];
      messageHandler(Buffer.from(JSON.stringify({ type: 'test' })));

      expect(onMessage).toHaveBeenCalledWith(ws, { type: 'test' });
    });

    it('should handle invalid JSON in message', () => {
      const ws = { on: vi.fn() };
      const clients = new Set([ws]);
      const onMessage = vi.fn();

      vi.spyOn(console, 'log').mockImplementation(() => {});
      vi.spyOn(console, 'error').mockImplementation(() => {});
      setupClientHandlers(ws, { clients, onMessage });

      const messageHandler = ws.on.mock.calls.find(([e]) => e === 'message')[1];
      messageHandler(Buffer.from('not json'));

      expect(onMessage).not.toHaveBeenCalled();
      expect(console.error).toHaveBeenCalled();
    });
  });

  describe('handleClientMessage', () => {
    let ws;

    beforeEach(() => {
      ws = { readyState: 1, OPEN: 1, bufferedAmount: 0, send: vi.fn(), clientId: 'test' };
    });

    it('should handle ping message', () => {
      handleClientMessage(ws, { type: 'ping' }, {});

      expect(ws.send).toHaveBeenCalledTimes(1);
      const sent = JSON.parse(ws.send.mock.calls[0][0]);
      expect(sent.type).toBe('pong');
      expect(sent.data.timestamp).toBeDefined();
    });

    it('should handle getState message', () => {
      const state = { status: 'idle' };
      handleClientMessage(ws, { type: 'getState' }, { state });

      const sent = JSON.parse(ws.send.mock.calls[0][0]);
      expect(sent.type).toBe('state');
      expect(sent.data).toEqual(state);
    });

    it('should handle getHistory message', () => {
      const eventHistory = { events: [{ type: 'a' }, { type: 'b' }] };
      handleClientMessage(ws, { type: 'getHistory', limit: 1 }, { eventHistory });

      const sent = JSON.parse(ws.send.mock.calls[0][0]);
      expect(sent.type).toBe('history');
      expect(sent.data).toHaveLength(1);
    });

    it('should handle getHistory with array eventHistory', () => {
      const eventHistory = [{ type: 'a' }, { type: 'b' }];
      handleClientMessage(ws, { type: 'getHistory' }, { eventHistory });

      const sent = JSON.parse(ws.send.mock.calls[0][0]);
      expect(sent.type).toBe('history');
    });

    it('should handle getMetrics message', () => {
      const getMetrics = vi.fn(() => ({ uptime: 1000 }));
      handleClientMessage(ws, { type: 'getMetrics' }, { getMetrics });

      expect(getMetrics).toHaveBeenCalled();
      const sent = JSON.parse(ws.send.mock.calls[0][0]);
      expect(sent.type).toBe('metrics');
      expect(sent.data.uptime).toBe(1000);
    });

    it('should emit clientMessage for unknown types', () => {
      const emit = vi.fn();
      handleClientMessage(ws, { type: 'custom', data: 'test' }, { emit });

      expect(emit).toHaveBeenCalledWith('clientMessage', {
        clientId: 'test',
        message: { type: 'custom', data: 'test' },
      });
    });
  });

  describe('HeartbeatManager', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should ping clients periodically', () => {
      const ws1 = { isAlive: true, ping: vi.fn(), terminate: vi.fn() };
      const ws2 = { isAlive: true, ping: vi.fn(), terminate: vi.fn() };
      const clients = new Set([ws1, ws2]);

      const manager = new HeartbeatManager(clients, 1000);
      manager.start();

      vi.advanceTimersByTime(1000);

      expect(ws1.isAlive).toBe(false);
      expect(ws1.ping).toHaveBeenCalled();
      expect(ws2.isAlive).toBe(false);
      expect(ws2.ping).toHaveBeenCalled();

      manager.stop();
    });

    it('should terminate dead clients', () => {
      const deadClient = { isAlive: false, ping: vi.fn(), terminate: vi.fn() };
      const clients = new Set([deadClient]);

      const manager = new HeartbeatManager(clients, 1000);
      manager.start();

      vi.advanceTimersByTime(1000);

      expect(deadClient.terminate).toHaveBeenCalled();
      expect(clients.has(deadClient)).toBe(false);

      manager.stop();
    });

    it('should not start multiple intervals', () => {
      const clients = new Set();
      const manager = new HeartbeatManager(clients, 1000);

      manager.start();
      manager.start();
      manager.start();

      // Should only have one interval
      manager.stop();
    });

    it('should stop interval', () => {
      const clients = new Set();
      const manager = new HeartbeatManager(clients, 1000);

      manager.start();
      manager.stop();

      expect(manager._intervalId).toBe(null);
    });
  });

  describe('TimeUpdateManager', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should call callback with elapsed time', () => {
      const callback = vi.fn();
      const manager = new TimeUpdateManager({ interval: 100 });

      manager.start(callback);
      vi.advanceTimersByTime(100);

      expect(callback).toHaveBeenCalledWith(expect.any(Number));
      manager.stop();
    });

    it('should track start time', () => {
      vi.setSystemTime(5000);
      const manager = new TimeUpdateManager();

      manager.start(() => {});
      expect(manager.startTime).toBe(5000);

      manager.stop();
    });

    it('should not start multiple intervals', () => {
      const manager = new TimeUpdateManager();

      manager.start(() => {});
      const firstInterval = manager._intervalId;

      manager.start(() => {});
      expect(manager._intervalId).toBe(firstInterval);

      manager.stop();
    });

    it('should stop and clear state', () => {
      const manager = new TimeUpdateManager();

      manager.start(() => {});
      manager.stop();

      expect(manager._intervalId).toBe(null);
      expect(manager.startTime).toBe(null);
    });

    it('should allow setting start time externally', () => {
      const manager = new TimeUpdateManager();
      manager.setStartTime(12345);

      expect(manager.startTime).toBe(12345);
    });

    it('should report isRunning status', () => {
      const manager = new TimeUpdateManager();

      expect(manager.isRunning).toBe(false);

      manager.start(() => {});
      expect(manager.isRunning).toBe(true);

      manager.stop();
      expect(manager.isRunning).toBe(false);
    });

    it('should use default interval', () => {
      const manager = new TimeUpdateManager();
      expect(manager.interval).toBe(1000);
    });
  });
});
