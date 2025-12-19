/**
 * Tests for messageHandlers.js
 */
import { describe, it, expect } from 'vitest';
import {
  mergeMetrics,
  handleStateMessage,
  handleHistoryMessage,
  handleProgressMessage,
  handleMessageMessage,
  handleErrorMessage,
  handleSupervisionMessage,
  handleEscalationMessage,
  handleVerificationMessage,
  handleCompleteMessage,
  handleMetricsMessage,
} from '../messageHandlers.js';
import { initialState } from '../initialState.js';

describe('messageHandlers', () => {
  describe('mergeMetrics', () => {
    it('should merge new metrics with previous', () => {
      const prev = { iterations: 5, supervisionChecks: 2 };
      const newState = { metrics: { tokensIn: 100 }, iteration: 10 };

      const result = mergeMetrics(prev, newState);

      expect(result.iterations).toBe(10);
      expect(result.tokensIn).toBe(100);
      expect(result.supervisionChecks).toBe(2);
    });

    it('should derive step counts from state', () => {
      const prev = {};
      const newState = {
        completedSteps: [1, 2, 3],
        failedSteps: [4],
        metrics: {},
      };

      const result = mergeMetrics(prev, newState);

      expect(result.stepsCompleted).toBe(3);
      expect(result.stepsFailed).toBe(1);
    });
  });

  describe('handleStateMessage', () => {
    it('should return new state with merged metrics', () => {
      const prev = { ...initialState, errors: ['error1'] };
      const messageData = {
        status: 'running',
        iteration: 5,
        plan: { steps: [{ number: 1, status: 'pending' }] },
      };

      const result = handleStateMessage(prev, messageData);

      expect(result.status).toBe('running');
      expect(result.iteration).toBe(5);
      expect(result.errors).toEqual(['error1']); // Preserved
      expect(result.stepChanges).toBeDefined();
    });

    it('should use initialState when messageData is null', () => {
      const prev = { ...initialState };
      const result = handleStateMessage(prev, null);

      expect(result.status).toBe('idle');
    });
  });

  describe('handleHistoryMessage', () => {
    it('should filter and map history events to logs', () => {
      const prev = { ...initialState, logs: [] };
      const historyData = [
        { type: 'message', timestamp: 1000, data: { content: 'Hello' } },
        { type: 'progress', timestamp: 2000, data: { message: 'Step 1' } },
        { type: 'other', timestamp: 3000, data: {} },
      ];

      const result = handleHistoryMessage(prev, historyData);

      expect(result.logs).toHaveLength(2);
      expect(result.logs[0].level).toBe('output');
      expect(result.logs[1].level).toBe('info');
    });

    it('should return unchanged state for non-array data', () => {
      const prev = { ...initialState };
      const result = handleHistoryMessage(prev, 'invalid');

      expect(result).toBe(prev);
    });
  });

  describe('handleProgressMessage', () => {
    it('should create log entry from progress event', () => {
      const prev = { ...initialState, logs: [] };
      const eventData = { type: 'step_complete', message: 'Step finished' };

      const result = handleProgressMessage(prev, eventData, Date.now());

      expect(result.logs).toHaveLength(1);
      expect(result.logs[0].level).toBe('success');
    });

    it('should extract iteration updates', () => {
      const prev = { ...initialState };
      const eventData = { type: 'iteration_complete', iteration: 5 };

      const result = handleProgressMessage(prev, eventData, Date.now());

      expect(result.iteration).toBe(5);
      expect(result.metrics.iterations).toBe(5);
    });

    it('should extract progress updates', () => {
      const prev = { ...initialState };
      const eventData = { planProgress: { percentComplete: 75, current: 3 } };

      const result = handleProgressMessage(prev, eventData, Date.now());

      expect(result.progress).toBe(75);
      expect(result.currentStep).toBe(3);
    });

    it('should handle status changes', () => {
      const prev = { ...initialState };

      expect(handleProgressMessage(prev, { type: 'planning' }, Date.now()).status).toBe('planning');
      expect(handleProgressMessage(prev, { type: 'plan_created' }, Date.now()).status).toBe('executing');
      expect(handleProgressMessage(prev, { type: 'verification_started' }, Date.now()).status).toBe('verifying');
      expect(handleProgressMessage(prev, { type: 'final_verification_passed' }, Date.now()).status).toBe('completed');
      expect(handleProgressMessage(prev, { type: 'final_verification_failed' }, Date.now()).status).toBe('failed');
    });
  });

  describe('handleMessageMessage', () => {
    it('should add message to logs', () => {
      const prev = { ...initialState, logs: [] };
      const data = { content: 'Hello world', iteration: 3 };

      const result = handleMessageMessage(prev, data, Date.now());

      expect(result.logs).toHaveLength(1);
      expect(result.logs[0].level).toBe('output');
      expect(result.logs[0].message).toBe('Hello world');
      expect(result.logs[0].iteration).toBe(3);
    });

    it('should truncate long messages', () => {
      const prev = { ...initialState, logs: [] };
      const longContent = 'x'.repeat(1000);
      const data = { content: longContent };

      const result = handleMessageMessage(prev, data, Date.now());

      expect(result.logs[0].message.length).toBe(500);
      expect(result.logs[0].full).toBe(longContent);
    });
  });

  describe('handleErrorMessage', () => {
    it('should add error to errors array', () => {
      const prev = { ...initialState, errors: [] };
      const data = { error: 'Something went wrong', retry: 2 };

      const result = handleErrorMessage(prev, data, Date.now());

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].error).toBe('Something went wrong');
      expect(result.errors[0].retry).toBe(2);
    });
  });

  describe('handleSupervisionMessage', () => {
    it('should update supervision state and metrics', () => {
      const prev = { ...initialState, metrics: { supervisionChecks: 0, interventions: 0 } };
      const data = { needsIntervention: true };

      const result = handleSupervisionMessage(prev, data);

      expect(result.supervision).toBe(data);
      expect(result.metrics.supervisionChecks).toBe(1);
      expect(result.metrics.interventions).toBe(1);
    });

    it('should not increment interventions when not needed', () => {
      const prev = { ...initialState, metrics: { supervisionChecks: 0, interventions: 0 } };
      const data = { needsIntervention: false };

      const result = handleSupervisionMessage(prev, data);

      expect(result.metrics.supervisionChecks).toBe(1);
      expect(result.metrics.interventions).toBe(0);
    });
  });

  describe('handleEscalationMessage', () => {
    it('should add escalation to logs', () => {
      const prev = { ...initialState, logs: [] };
      const data = { type: 'critical', message: 'Major issue' };

      const result = handleEscalationMessage(prev, data, Date.now());

      expect(result.logs).toHaveLength(1);
      expect(result.logs[0].level).toBe('error');
      expect(result.logs[0].message).toContain('critical');
      expect(result.logs[0].message).toContain('Major issue');
    });
  });

  describe('handleVerificationMessage', () => {
    it('should update verification state', () => {
      const prev = { ...initialState };
      const data = { passed: true, confidence: 'HIGH' };

      const result = handleVerificationMessage(prev, data);

      expect(result.verification).toBe(data);
    });
  });

  describe('handleCompleteMessage', () => {
    it('should set completed status', () => {
      const prev = { ...initialState };
      const data = { status: 'completed', report: {} };

      const result = handleCompleteMessage(prev, data);

      expect(result.status).toBe('completed');
      expect(result.finalReport).toBe(data);
    });

    it('should set failed status for non-completed', () => {
      const prev = { ...initialState };
      const data = { status: 'aborted' };

      const result = handleCompleteMessage(prev, data);

      expect(result.status).toBe('failed');
    });
  });

  describe('handleMetricsMessage', () => {
    it('should update serverMetrics', () => {
      const prev = { ...initialState };
      const data = { uptime: 1000, clients: 5 };

      const result = handleMetricsMessage(prev, data);

      expect(result.serverMetrics).toBe(data);
    });
  });
});
