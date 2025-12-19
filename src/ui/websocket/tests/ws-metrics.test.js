/**
 * Tests for ws-metrics.js
 */
import { describe, it, expect, vi } from 'vitest';
import {
  createMetrics,
  getFormattedMetrics,
  createEventHandlers,
} from '../ws-metrics.js';

describe('ws-metrics', () => {
  describe('createMetrics', () => {
    it('should create metrics with default values', () => {
      const metrics = createMetrics();

      expect(metrics.startTime).toBe(null);
      expect(metrics.messagesProcessed).toBe(0);
      expect(metrics.stepsCompleted).toBe(0);
      expect(metrics.stepsFailed).toBe(0);
      expect(metrics.errorsEncountered).toBe(0);
      expect(metrics.supervisionEvents).toBe(0);
      expect(metrics.clientConnections).toBe(0);
    });

    it('should create independent metrics objects', () => {
      const metrics1 = createMetrics();
      const metrics2 = createMetrics();

      metrics1.stepsCompleted = 5;
      expect(metrics2.stepsCompleted).toBe(0);
    });
  });

  describe('getFormattedMetrics', () => {
    it('should calculate uptime from startTime', () => {
      const now = Date.now();
      const metrics = { ...createMetrics(), startTime: now - 5000 };
      const context = {
        clients: new Set(),
        eventHistory: { length: 0 },
        state: { status: 'idle', progress: 0, plan: null, completedSteps: [], failedSteps: [] },
      };

      const formatted = getFormattedMetrics(metrics, context);

      expect(formatted.uptime).toBeGreaterThanOrEqual(5000);
      expect(formatted.uptime).toBeLessThan(6000);
    });

    it('should return 0 uptime if no startTime', () => {
      const metrics = createMetrics();
      const context = {
        clients: new Set(),
        eventHistory: { length: 0 },
        state: { status: 'idle', progress: 0, plan: null, completedSteps: [], failedSteps: [] },
      };

      const formatted = getFormattedMetrics(metrics, context);
      expect(formatted.uptime).toBe(0);
    });

    it('should include connected clients count', () => {
      const metrics = createMetrics();
      const context = {
        clients: new Set(['a', 'b', 'c']),
        eventHistory: { length: 0 },
        state: { status: 'idle', progress: 0, plan: null, completedSteps: [], failedSteps: [] },
      };

      const formatted = getFormattedMetrics(metrics, context);
      expect(formatted.connectedClients).toBe(3);
    });

    it('should include events in history count', () => {
      const metrics = createMetrics();
      const context = {
        clients: new Set(),
        eventHistory: { length: 50 },
        state: { status: 'idle', progress: 0, plan: null, completedSteps: [], failedSteps: [] },
      };

      const formatted = getFormattedMetrics(metrics, context);
      expect(formatted.eventsInHistory).toBe(50);
    });

    it('should include state summary', () => {
      const metrics = createMetrics();
      const context = {
        clients: new Set(),
        eventHistory: { length: 0 },
        state: {
          status: 'executing',
          progress: 75,
          plan: { steps: [1, 2, 3, 4, 5] },
          completedSteps: [1, 2, 3],
          failedSteps: [4],
        },
      };

      const formatted = getFormattedMetrics(metrics, context);

      expect(formatted.state.status).toBe('executing');
      expect(formatted.state.progress).toBe(75);
      expect(formatted.state.stepsTotal).toBe(5);
      expect(formatted.state.stepsCompleted).toBe(3);
      expect(formatted.state.stepsFailed).toBe(1);
    });

    it('should handle null plan', () => {
      const metrics = createMetrics();
      const context = {
        clients: new Set(),
        eventHistory: { length: 0 },
        state: { status: 'idle', progress: 0, plan: null, completedSteps: [], failedSteps: [] },
      };

      const formatted = getFormattedMetrics(metrics, context);
      expect(formatted.state.stepsTotal).toBe(0);
    });

    it('should preserve original metrics properties', () => {
      const metrics = {
        ...createMetrics(),
        startTime: 1000,
        messagesProcessed: 100,
        stepsCompleted: 5,
        stepsFailed: 1,
        errorsEncountered: 2,
        supervisionEvents: 3,
        clientConnections: 10,
      };
      const context = {
        clients: new Set(),
        eventHistory: { length: 0 },
        state: { status: 'idle', progress: 0, plan: null, completedSteps: [], failedSteps: [] },
      };

      const formatted = getFormattedMetrics(metrics, context);

      expect(formatted.messagesProcessed).toBe(100);
      expect(formatted.stepsCompleted).toBe(5);
      expect(formatted.stepsFailed).toBe(1);
      expect(formatted.errorsEncountered).toBe(2);
      expect(formatted.supervisionEvents).toBe(3);
      expect(formatted.clientConnections).toBe(10);
    });
  });

  describe('createEventHandlers', () => {
    it('should create all handler functions', () => {
      const broadcast = vi.fn();
      const handlers = createEventHandlers({}, broadcast);

      expect(typeof handlers.onProgress).toBe('function');
      expect(typeof handlers.onMessage).toBe('function');
      expect(typeof handlers.onError).toBe('function');
      expect(typeof handlers.onSupervision).toBe('function');
      expect(typeof handlers.onEscalation).toBe('function');
      expect(typeof handlers.onVerification).toBe('function');
      expect(typeof handlers.onComplete).toBe('function');
    });

    it('should call existing handler first', () => {
      const existingHandler = vi.fn();
      const broadcast = vi.fn();
      const handlers = createEventHandlers({ onProgress: existingHandler }, broadcast);

      handlers.onProgress({ test: 'data' });

      expect(existingHandler).toHaveBeenCalledWith({ test: 'data' });
      // Verify handler was called before broadcast by checking call order
      expect(existingHandler.mock.invocationCallOrder[0]).toBeLessThan(broadcast.mock.invocationCallOrder[0]);
    });

    it('should broadcast with correct event type', () => {
      const broadcast = vi.fn();
      const handlers = createEventHandlers({}, broadcast);

      handlers.onProgress({ data: 1 });
      expect(broadcast).toHaveBeenCalledWith('progress', { data: 1 });

      handlers.onMessage({ data: 2 });
      expect(broadcast).toHaveBeenCalledWith('message', { data: 2 });

      handlers.onError({ data: 3 });
      expect(broadcast).toHaveBeenCalledWith('error', { data: 3 });

      handlers.onSupervision({ data: 4 });
      expect(broadcast).toHaveBeenCalledWith('supervision', { data: 4 });

      handlers.onEscalation({ data: 5 });
      expect(broadcast).toHaveBeenCalledWith('escalation', { data: 5 });

      handlers.onVerification({ data: 6 });
      expect(broadcast).toHaveBeenCalledWith('verification', { data: 6 });

      handlers.onComplete({ data: 7 });
      expect(broadcast).toHaveBeenCalledWith('complete', { data: 7 });
    });

    it('should catch and log errors from existing handlers', () => {
      const errorHandler = vi.fn(() => { throw new Error('Handler error'); });
      const broadcast = vi.fn();
      vi.spyOn(console, 'error').mockImplementation(() => {});

      const handlers = createEventHandlers({ onProgress: errorHandler }, broadcast);
      handlers.onProgress({ test: 'data' });

      // Should still broadcast despite handler error
      expect(broadcast).toHaveBeenCalledWith('progress', { test: 'data' });
      expect(console.error).toHaveBeenCalled();
    });

    it('should catch and log errors from broadcast', () => {
      const broadcast = vi.fn(() => { throw new Error('Broadcast error'); });
      vi.spyOn(console, 'error').mockImplementation(() => {});

      const handlers = createEventHandlers({}, broadcast);

      // Should not throw
      expect(() => handlers.onProgress({ test: 'data' })).not.toThrow();
      expect(console.error).toHaveBeenCalled();
    });

    it('should handle missing existing handlers gracefully', () => {
      const broadcast = vi.fn();
      const handlers = createEventHandlers({}, broadcast);

      // Should not throw when existing handler is undefined
      expect(() => handlers.onProgress({ test: 'data' })).not.toThrow();
      expect(broadcast).toHaveBeenCalled();
    });
  });
});
