/**
 * Tests for session-manager.js
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { SessionManager } from '../session-manager.js';

// Mock fs
vi.mock('fs', () => ({
  promises: {
    readFile: vi.fn(),
    writeFile: vi.fn(),
    readdir: vi.fn(),
    access: vi.fn(),
    unlink: vi.fn(),
  },
}));

import { promises as fs } from 'fs';

describe('SessionManager', () => {
  let manager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new SessionManager({
      persistencePath: '/test/path',
      workingDirectory: '/test/working',
    });
  });

  describe('constructor', () => {
    it('should initialize with options', () => {
      expect(manager.persistencePath).toBe('/test/path');
      expect(manager.workingDirectory).toBe('/test/working');
      expect(manager.currentSession).toBeNull();
    });

    it('should use defaults for workingDirectory', () => {
      const m = new SessionManager({ persistencePath: '/path' });
      expect(m.workingDirectory).toBe(process.cwd());
    });
  });

  describe('generateSessionId', () => {
    it('should generate unique IDs', () => {
      const id1 = manager.generateSessionId('goal1');
      const id2 = manager.generateSessionId('goal2');
      expect(id1).not.toBe(id2);
    });

    it('should include hash of goal and directory', () => {
      const id = manager.generateSessionId('test goal');
      expect(id).toMatch(/^[a-z0-9]+_[a-f0-9]+$/);
    });
  });

  describe('startSession', () => {
    beforeEach(() => {
      fs.writeFile.mockResolvedValue();
    });

    it('should create new session', async () => {
      const session = await manager.startSession('test goal');

      expect(session.goal).toBe('test goal');
      expect(session.status).toBe('active');
      expect(session.currentStep).toBe(0);
      expect(session.completedSteps).toEqual([]);
      expect(session.context.keyDecisions).toEqual([]);
    });

    it('should resume existing session', async () => {
      const existingSession = {
        id: 'existing123',
        goal: 'test goal',
        status: 'active',
        currentStep: 5,
      };
      fs.readFile.mockResolvedValue(JSON.stringify(existingSession));

      const session = await manager.startSession('test goal', {
        resumeSessionId: 'existing123',
      });

      expect(session.currentStep).toBe(5);
      expect(session.resumeCount).toBe(1);
    });
  });

  describe('saveSession', () => {
    it('should return false when no session', async () => {
      const result = await manager.saveSession();
      expect(result).toBe(false);
    });

    it('should save session to disk', async () => {
      fs.writeFile.mockResolvedValue();
      manager.currentSession = {
        id: 'test123',
        goal: 'test',
      };

      const result = await manager.saveSession();

      expect(result).toBe(true);
      expect(fs.writeFile).toHaveBeenCalled();
    });

    it('should handle write errors', async () => {
      fs.writeFile.mockRejectedValue(new Error('Write failed'));
      manager.currentSession = { id: 'test', goal: 'test' };

      const result = await manager.saveSession();

      expect(result).toBe(false);
    });
  });

  describe('loadSession', () => {
    it('should load existing session', async () => {
      const session = { id: 'test', goal: 'test goal' };
      fs.readFile.mockResolvedValue(JSON.stringify(session));

      const result = await manager.loadSession('test');

      expect(result.goal).toBe('test goal');
    });

    it('should return null for missing session', async () => {
      fs.readFile.mockRejectedValue(new Error('Not found'));

      const result = await manager.loadSession('missing');

      expect(result).toBeNull();
    });
  });

  describe('listSessions', () => {
    it('should return empty array when directory missing', async () => {
      fs.access.mockRejectedValue(new Error('Not found'));

      const sessions = await manager.listSessions();

      expect(sessions).toEqual([]);
    });

    it('should list sessions from files', async () => {
      fs.access.mockResolvedValue();
      fs.readdir.mockResolvedValue(['session_a.json', 'session_b.json', 'other.txt']);
      fs.readFile.mockImplementation((path) => {
        if (path.includes('session_a')) {
          return Promise.resolve(JSON.stringify({
            id: 'a', goal: 'Goal A', status: 'active',
            createdAt: 1000, updatedAt: 2000, currentStep: 1,
          }));
        }
        if (path.includes('session_b')) {
          return Promise.resolve(JSON.stringify({
            id: 'b', goal: 'Goal B', status: 'completed',
            createdAt: 500, updatedAt: 1500, currentStep: 3,
          }));
        }
        return Promise.reject(new Error('Not found'));
      });

      const sessions = await manager.listSessions();

      expect(sessions).toHaveLength(2);
      expect(sessions[0].id).toBe('a'); // More recent first
    });
  });

  describe('syncPlanState', () => {
    beforeEach(() => {
      manager.currentSession = {
        completedSteps: [],
        failedSteps: [],
        skippedSteps: [],
        plan: null,
      };
    });

    it('should do nothing without session', () => {
      manager.currentSession = null;
      manager.syncPlanState({ steps: [] });
      // No error
    });

    it('should sync step arrays from plan', () => {
      manager.syncPlanState({
        steps: [
          { number: 1, status: 'completed' },
          { number: 2, status: 'failed' },
          { number: 3, status: 'skipped' },
          { number: 4, status: 'pending' },
        ],
      });

      expect(manager.currentSession.completedSteps).toEqual([1]);
      expect(manager.currentSession.failedSteps).toEqual([2]);
      expect(manager.currentSession.skippedSteps).toEqual([3]);
    });

    it('should skip subtasks', () => {
      manager.syncPlanState({
        steps: [
          { number: 1, status: 'completed' },
          { number: 1.1, status: 'completed', isSubtask: true },
        ],
      });

      expect(manager.currentSession.completedSteps).toEqual([1]);
    });
  });

  describe('updateStepProgress', () => {
    beforeEach(() => {
      fs.writeFile.mockResolvedValue();
      manager.currentSession = {
        currentStep: 0,
        stepResults: {},
        completedSteps: [],
        skippedSteps: [],
        failedSteps: [],
        updatedAt: 0,
      };
    });

    it('should update current step', async () => {
      await manager.updateStepProgress(3, 'completed');

      expect(manager.currentSession.currentStep).toBe(3);
      expect(manager.currentSession.completedSteps).toContain(3);
    });

    it('should record result summary', async () => {
      await manager.updateStepProgress(1, 'completed', { response: 'test result' });

      expect(manager.currentSession.stepResults[1]).toBeDefined();
      expect(manager.currentSession.stepResults[1].status).toBe('completed');
    });

    it('should track skipped steps', async () => {
      await manager.updateStepProgress(2, 'skipped');

      expect(manager.currentSession.skippedSteps).toContain(2);
    });

    it('should track failed steps', async () => {
      await manager.updateStepProgress(4, 'failed');

      expect(manager.currentSession.failedSteps).toContain(4);
    });
  });

  describe('summarizeResult', () => {
    it('should return null for null input', () => {
      expect(manager.summarizeResult(null)).toBeNull();
    });

    it('should include short responses', () => {
      const result = manager.summarizeResult({ response: 'short' });

      expect(result.response).toBe('short');
      expect(result.hasResponse).toBe(true);
    });

    it('should truncate long responses', () => {
      const longResponse = 'x'.repeat(3000);
      const result = manager.summarizeResult({ response: longResponse });

      expect(result.responseSummary).toBeDefined();
      expect(result.responseSummary.length).toBeLessThan(600);
    });

    it('should preserve other fields', () => {
      const result = manager.summarizeResult({
        response: 'test',
        sessionId: '123',
        escalated: true,
        error: 'test error',
      });

      expect(result.sessionId).toBe('123');
      expect(result.escalated).toBe(true);
      expect(result.error).toBe('test error');
    });
  });

  describe('recordContextItem', () => {
    beforeEach(() => {
      manager.currentSession = {
        context: {
          keyDecisions: [],
          milestones: [],
          errors: [],
        },
      };
    });

    it('should record decisions', () => {
      manager.recordContextItem('decision', { description: 'test decision' });

      expect(manager.currentSession.context.keyDecisions).toHaveLength(1);
      expect(manager.currentSession.context.keyDecisions[0].description).toBe('test decision');
    });

    it('should limit decisions to 50', () => {
      for (let i = 0; i < 60; i++) {
        manager.recordContextItem('decision', { id: i });
      }

      expect(manager.currentSession.context.keyDecisions).toHaveLength(50);
    });

    it('should record milestones', () => {
      manager.recordContextItem('milestone', { name: 'test' });

      expect(manager.currentSession.context.milestones).toHaveLength(1);
    });

    it('should record and limit errors', () => {
      for (let i = 0; i < 110; i++) {
        manager.recordContextItem('error', { id: i });
      }

      expect(manager.currentSession.context.errors).toHaveLength(100);
    });
  });

  describe('updateMetrics', () => {
    beforeEach(() => {
      manager.currentSession = {
        metrics: { totalIterations: 0 },
      };
    });

    it('should increment numeric values', () => {
      manager.updateMetrics({ totalIterations: 5 });

      expect(manager.currentSession.metrics.totalIterations).toBe(5);

      manager.updateMetrics({ totalIterations: 3 });

      expect(manager.currentSession.metrics.totalIterations).toBe(8);
    });

    it('should set non-numeric values', () => {
      manager.updateMetrics({ status: 'running' });

      expect(manager.currentSession.metrics.status).toBe('running');
    });
  });

  describe('completeSession', () => {
    beforeEach(() => {
      fs.writeFile.mockResolvedValue();
      manager.currentSession = {
        status: 'active',
        createdAt: 1000,
        metrics: {},
        completedSteps: [],
        failedSteps: [],
        skippedSteps: [],
        updatedAt: 0,
      };
    });

    it('should mark session as completed', async () => {
      await manager.completeSession();

      expect(manager.currentSession.status).toBe('completed');
      expect(manager.currentSession.completedAt).toBeDefined();
    });

    it('should calculate duration', async () => {
      await manager.completeSession();

      expect(manager.currentSession.metrics.totalDuration).toBeGreaterThan(0);
    });

    it('should include summary', async () => {
      await manager.completeSession({ result: 'success' });

      expect(manager.currentSession.summary.result).toBe('success');
    });
  });

  describe('failSession', () => {
    beforeEach(() => {
      fs.writeFile.mockResolvedValue();
      manager.currentSession = {
        status: 'active',
        updatedAt: 0,
      };
    });

    it('should mark session as failed', async () => {
      await manager.failSession(new Error('Test error'));

      expect(manager.currentSession.status).toBe('failed');
      expect(manager.currentSession.failureReason).toBe('Test error');
    });
  });

  describe('getSessionState', () => {
    it('should return null without session', () => {
      expect(manager.getSessionState()).toBeNull();
    });

    it('should return session summary', () => {
      manager.currentSession = {
        id: 'test',
        goal: 'test goal',
        status: 'active',
        currentStep: 3,
        createdAt: 1000,
        completedSteps: [1, 2],
        skippedSteps: [],
        failedSteps: [],
        plan: { steps: [1, 2, 3, 4, 5] },
        metrics: { iterations: 10 },
      };

      const state = manager.getSessionState();

      expect(state.id).toBe('test');
      expect(state.totalSteps).toBe(5);
      expect(state.completedSteps).toBe(2);
    });
  });

  describe('calculateProgress', () => {
    it('should return 0 without plan', () => {
      manager.currentSession = {};
      expect(manager.calculateProgress()).toBe(0);
    });

    it('should calculate percentage', () => {
      manager.currentSession = {
        plan: { steps: [1, 2, 3, 4] },
        completedSteps: [1, 2],
        skippedSteps: [3],
      };

      expect(manager.calculateProgress()).toBe(75);
    });
  });

  describe('getResumableSession', () => {
    it('should find matching active session', async () => {
      fs.access.mockResolvedValue();
      fs.readdir.mockResolvedValue(['session_test.json']);
      fs.readFile.mockResolvedValue(JSON.stringify({
        id: 'test',
        goal: 'find me',
        status: 'active',
        updatedAt: Date.now(),
      }));

      const session = await manager.getResumableSession('find me');

      expect(session.id).toBe('test');
    });

    it('should not return completed sessions', async () => {
      fs.access.mockResolvedValue();
      fs.readdir.mockResolvedValue(['session_test.json']);
      fs.readFile.mockResolvedValue(JSON.stringify({
        id: 'test',
        goal: 'find me',
        status: 'completed',
        updatedAt: Date.now(),
      }));

      const session = await manager.getResumableSession('find me');

      expect(session).toBeNull();
    });
  });

  describe('cleanupOldSessions', () => {
    it('should delete old completed sessions', async () => {
      fs.access.mockResolvedValue();
      fs.readdir.mockResolvedValue(['session_old.json']);
      fs.readFile.mockResolvedValue(JSON.stringify({
        id: 'old',
        goal: 'old goal',
        status: 'completed',
        updatedAt: Date.now() - 10 * 24 * 60 * 60 * 1000, // 10 days ago
      }));
      fs.unlink.mockResolvedValue();

      const cleaned = await manager.cleanupOldSessions(7);

      expect(cleaned).toBe(1);
      expect(fs.unlink).toHaveBeenCalled();
    });
  });

  describe('deleteSession', () => {
    it('should delete session file', async () => {
      fs.unlink.mockResolvedValue();

      const result = await manager.deleteSession('test123');

      expect(result).toBe(true);
      expect(fs.unlink).toHaveBeenCalled();
    });

    it('should return false on error', async () => {
      fs.unlink.mockRejectedValue(new Error('Not found'));

      const result = await manager.deleteSession('missing');

      expect(result).toBe(false);
    });
  });
});
