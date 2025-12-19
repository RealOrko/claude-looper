/**
 * Tests for ws-broadcaster.js
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  sendToClient,
  broadcastToClients,
  broadcastStateUpdate,
  EventHistory,
  DebouncedBroadcaster,
} from '../ws-broadcaster.js';

describe('ws-broadcaster', () => {
  describe('sendToClient', () => {
    it('should send message to open client', () => {
      const ws = { readyState: 1, OPEN: 1, bufferedAmount: 0, send: vi.fn() };
      const result = sendToClient(ws, 'test', { foo: 'bar' });

      expect(result).toBe(true);
      expect(ws.send).toHaveBeenCalledTimes(1);
      const sent = JSON.parse(ws.send.mock.calls[0][0]);
      expect(sent.type).toBe('test');
      expect(sent.data).toEqual({ foo: 'bar' });
      expect(sent.timestamp).toBeDefined();
    });

    it('should return false for non-open client', () => {
      const ws = { readyState: 3, OPEN: 1, bufferedAmount: 0, send: vi.fn() };
      const result = sendToClient(ws, 'test', {});

      expect(result).toBe(false);
      expect(ws.send).not.toHaveBeenCalled();
    });

    it('should skip client with high buffer (backpressure)', () => {
      const ws = { readyState: 1, OPEN: 1, bufferedAmount: 2 * 1024 * 1024, send: vi.fn() };
      const result = sendToClient(ws, 'test', {});

      expect(result).toBe(false);
      expect(ws._skippedMessages).toBe(1);
      expect(ws.send).not.toHaveBeenCalled();
    });

    it('should increment skipped count', () => {
      const ws = { readyState: 1, OPEN: 1, bufferedAmount: 2 * 1024 * 1024, _skippedMessages: 5, send: vi.fn() };
      sendToClient(ws, 'test', {});

      expect(ws._skippedMessages).toBe(6);
    });

    it('should return false on send error', () => {
      const ws = {
        readyState: 1,
        OPEN: 1,
        bufferedAmount: 0,
        send: vi.fn(() => { throw new Error('Send failed'); }),
      };
      vi.spyOn(console, 'error').mockImplementation(() => {});

      const result = sendToClient(ws, 'test', {});

      expect(result).toBe(false);
    });
  });

  describe('broadcastToClients', () => {
    it('should broadcast to all open clients', () => {
      const client1 = { readyState: 1, OPEN: 1, bufferedAmount: 0, send: vi.fn() };
      const client2 = { readyState: 1, OPEN: 1, bufferedAmount: 0, send: vi.fn() };
      const clients = new Set([client1, client2]);

      const result = broadcastToClients(clients, 'test', { value: 123 });

      expect(result.sentCount).toBe(2);
      expect(result.skippedCount).toBe(0);
      expect(client1.send).toHaveBeenCalledTimes(1);
      expect(client2.send).toHaveBeenCalledTimes(1);
    });

    it('should skip closed clients', () => {
      const openClient = { readyState: 1, OPEN: 1, bufferedAmount: 0, send: vi.fn() };
      const closedClient = { readyState: 3, OPEN: 1, bufferedAmount: 0, send: vi.fn() };
      const clients = new Set([openClient, closedClient]);

      const result = broadcastToClients(clients, 'test', {});

      expect(result.sentCount).toBe(1);
      expect(closedClient.send).not.toHaveBeenCalled();
    });

    it('should count skipped clients due to backpressure', () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const normalClient = { readyState: 1, OPEN: 1, bufferedAmount: 0, send: vi.fn() };
      const slowClient = { readyState: 1, OPEN: 1, bufferedAmount: 2 * 1024 * 1024, send: vi.fn() };
      const clients = new Set([normalClient, slowClient]);

      const result = broadcastToClients(clients, 'test', {});

      expect(result.sentCount).toBe(1);
      expect(result.skippedCount).toBe(1);
      expect(slowClient._skippedMessages).toBe(1);
    });

    it('should handle empty client set', () => {
      const result = broadcastToClients(new Set(), 'test', {});
      expect(result.sentCount).toBe(0);
      expect(result.skippedCount).toBe(0);
    });
  });

  describe('broadcastStateUpdate', () => {
    it('should broadcast state with version', () => {
      const client = { readyState: 1, OPEN: 1, bufferedAmount: 0, send: vi.fn() };
      const clients = new Set([client]);
      const state = { status: 'executing', progress: 50 };

      const result = broadcastStateUpdate(clients, state, 42);

      expect(result.sentCount).toBe(1);
      const sent = JSON.parse(client.send.mock.calls[0][0]);
      expect(sent.type).toBe('stateUpdate');
      expect(sent.data).toEqual(state);
      expect(sent.version).toBe(42);
    });

    it('should skip slow clients', () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const slowClient = { readyState: 1, OPEN: 1, bufferedAmount: 2 * 1024 * 1024, send: vi.fn() };
      const clients = new Set([slowClient]);

      const result = broadcastStateUpdate(clients, {}, 1);

      expect(result.skippedCount).toBe(1);
      expect(slowClient.send).not.toHaveBeenCalled();
    });
  });

  describe('EventHistory', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should add events', () => {
      const history = new EventHistory();
      history.add('test', { value: 1 });

      expect(history.length).toBe(1);
      expect(history.events[0].type).toBe('test');
      expect(history.events[0].data).toEqual({ value: 1 });
    });

    it('should add timestamp to events', () => {
      vi.setSystemTime(5000);
      const history = new EventHistory();
      history.add('test', {});

      expect(history.events[0].timestamp).toBe(5000);
    });

    it('should limit events to maxSize', () => {
      const history = new EventHistory(5);
      for (let i = 0; i < 10; i++) {
        history.add('test', { i });
      }

      expect(history.length).toBe(5);
      expect(history.events[0].data.i).toBe(5);
      expect(history.events[4].data.i).toBe(9);
    });

    it('should get recent events with limit and offset', () => {
      const history = new EventHistory();
      for (let i = 0; i < 10; i++) {
        history.add('test', { i });
      }

      const recent = history.getRecent(3, 2);
      expect(recent.length).toBe(3);
      expect(recent[0].data.i).toBe(2);
      expect(recent[2].data.i).toBe(4);
    });

    it('should get last N events', () => {
      const history = new EventHistory();
      for (let i = 0; i < 10; i++) {
        history.add('test', { i });
      }

      const last = history.getLast(3);
      expect(last.length).toBe(3);
      expect(last[0].data.i).toBe(7);
      expect(last[2].data.i).toBe(9);
    });

    it('should clear events', () => {
      const history = new EventHistory();
      history.add('test', {});
      history.add('test2', {});
      history.clear();

      expect(history.length).toBe(0);
      expect(history.events).toEqual([]);
    });
  });

  describe('DebouncedBroadcaster', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should schedule callback after debounce time', () => {
      const broadcaster = new DebouncedBroadcaster({ debounceMs: 100 });
      const callback = vi.fn();

      broadcaster.schedule(callback);
      expect(callback).not.toHaveBeenCalled();

      vi.advanceTimersByTime(100);
      expect(callback).toHaveBeenCalledTimes(1);
    });

    it('should pass version to callback', () => {
      const broadcaster = new DebouncedBroadcaster({ debounceMs: 50 });
      const callback = vi.fn();

      broadcaster.schedule(callback);
      vi.advanceTimersByTime(50);

      expect(callback).toHaveBeenCalledWith(1);
    });

    it('should batch multiple calls', () => {
      const broadcaster = new DebouncedBroadcaster({ debounceMs: 50 });
      const callback = vi.fn();

      broadcaster.schedule(callback);
      broadcaster.schedule(callback);
      broadcaster.schedule(callback);

      vi.advanceTimersByTime(50);
      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith(3);
    });

    it('should increment version on each schedule', () => {
      const broadcaster = new DebouncedBroadcaster();
      expect(broadcaster.version).toBe(0);

      broadcaster.schedule(() => {});
      expect(broadcaster.version).toBe(1);

      broadcaster.schedule(() => {});
      expect(broadcaster.version).toBe(2);
    });

    it('should cancel pending broadcast', () => {
      const broadcaster = new DebouncedBroadcaster({ debounceMs: 100 });
      const callback = vi.fn();

      broadcaster.schedule(callback);
      vi.advanceTimersByTime(50);
      broadcaster.cancel();
      vi.advanceTimersByTime(100);

      expect(callback).not.toHaveBeenCalled();
    });

    it('should reset state', () => {
      const broadcaster = new DebouncedBroadcaster();
      broadcaster.schedule(() => {});
      broadcaster.schedule(() => {});

      broadcaster.reset();

      expect(broadcaster.version).toBe(0);
      expect(broadcaster._pending).toBe(false);
      expect(broadcaster._callback).toBe(null);
    });

    it('should use default debounce time', () => {
      const broadcaster = new DebouncedBroadcaster();
      expect(broadcaster.debounceMs).toBe(50);
    });
  });
});
