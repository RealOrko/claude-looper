/**
 * Tests for checkpoint-handler.js
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { CheckpointHandler } from '../checkpoint-handler.js';

// Mock fs
vi.mock('fs', () => ({
  promises: {
    readFile: vi.fn(),
    writeFile: vi.fn(),
    unlink: vi.fn(),
  },
}));

import { promises as fs } from 'fs';

describe('CheckpointHandler', () => {
  let handler;

  beforeEach(() => {
    vi.clearAllMocks();
    handler = new CheckpointHandler({
      persistencePath: '/test/path',
      maxCheckpoints: 3,
    });
  });

  describe('constructor', () => {
    it('should initialize with options', () => {
      expect(handler.persistencePath).toBe('/test/path');
      expect(handler.maxCheckpoints).toBe(3);
      expect(handler.checkpoints).toEqual([]);
    });

    it('should use default maxCheckpoints', () => {
      const h = new CheckpointHandler({ persistencePath: '/path' });
      expect(h.maxCheckpoints).toBe(10);
    });
  });

  describe('createCheckpoint', () => {
    it('should return null without session', async () => {
      const result = await handler.createCheckpoint(null);
      expect(result).toBeNull();
    });

    it('should create checkpoint file', async () => {
      fs.writeFile.mockResolvedValue();

      const session = {
        id: 'sess123',
        currentStep: 5,
        checkpointIds: [],
      };

      const cpId = await handler.createCheckpoint(session, 'Test checkpoint');

      expect(cpId).toMatch(/^cp_/);
      expect(fs.writeFile).toHaveBeenCalled();
      expect(session.checkpointIds).toContain(cpId);
    });

    it('should use default label', async () => {
      fs.writeFile.mockResolvedValue();

      const session = {
        id: 'sess123',
        currentStep: 7,
        checkpointIds: [],
      };

      await handler.createCheckpoint(session);

      const writeCall = fs.writeFile.mock.calls[0];
      const written = JSON.parse(writeCall[1]);
      expect(written.label).toBe('Step 7');
    });

    it('should sync plan state if provided', async () => {
      fs.writeFile.mockResolvedValue();
      const syncFn = vi.fn();

      const session = {
        id: 'sess123',
        currentStep: 1,
        checkpointIds: [],
      };

      await handler.createCheckpoint(session, '', { steps: [] }, syncFn);

      expect(syncFn).toHaveBeenCalled();
    });

    it('should track checkpoint internally', async () => {
      fs.writeFile.mockResolvedValue();

      const session = {
        id: 'sess123',
        currentStep: 1,
        checkpointIds: [],
      };

      await handler.createCheckpoint(session);

      expect(handler.checkpoints).toHaveLength(1);
    });

    it('should handle write errors', async () => {
      fs.writeFile.mockRejectedValue(new Error('Write failed'));

      const session = {
        id: 'sess123',
        currentStep: 1,
        checkpointIds: [],
      };

      const result = await handler.createCheckpoint(session);

      expect(result).toBeNull();
    });
  });

  describe('restoreCheckpoint', () => {
    it('should restore session from checkpoint', async () => {
      const checkpoint = {
        id: 'cp_abc',
        state: {
          id: 'sess123',
          currentStep: 5,
          goal: 'test goal',
        },
      };
      fs.readFile.mockResolvedValue(JSON.stringify(checkpoint));

      const session = await handler.restoreCheckpoint('cp_abc');

      expect(session.currentStep).toBe(5);
      expect(session.restoredFromCheckpoint).toBe('cp_abc');
      expect(session.restoredAt).toBeDefined();
    });

    it('should return null on error', async () => {
      fs.readFile.mockRejectedValue(new Error('Not found'));

      const session = await handler.restoreCheckpoint('missing');

      expect(session).toBeNull();
    });
  });

  describe('listCheckpoints', () => {
    it('should return empty array without session', async () => {
      const result = await handler.listCheckpoints(null);
      expect(result).toEqual([]);
    });

    it('should list checkpoints for session', async () => {
      const session = {
        checkpointIds: ['cp_1', 'cp_2'],
      };

      fs.readFile.mockImplementation((path) => {
        if (path.includes('cp_1')) {
          return Promise.resolve(JSON.stringify({
            id: 'cp_1',
            label: 'First',
            createdAt: 1000,
            state: { currentStep: 1 },
          }));
        }
        if (path.includes('cp_2')) {
          return Promise.resolve(JSON.stringify({
            id: 'cp_2',
            label: 'Second',
            createdAt: 2000,
            state: { currentStep: 2 },
          }));
        }
        return Promise.reject(new Error('Not found'));
      });

      const checkpoints = await handler.listCheckpoints(session);

      expect(checkpoints).toHaveLength(2);
      expect(checkpoints[0].label).toBe('First');
      expect(checkpoints[1].step).toBe(2);
    });

    it('should skip missing checkpoints', async () => {
      const session = {
        checkpointIds: ['cp_1', 'cp_missing'],
      };

      fs.readFile.mockImplementation((path) => {
        if (path.includes('cp_1')) {
          return Promise.resolve(JSON.stringify({
            id: 'cp_1',
            label: 'First',
            createdAt: 1000,
            state: { currentStep: 1 },
          }));
        }
        return Promise.reject(new Error('Not found'));
      });

      const checkpoints = await handler.listCheckpoints(session);

      expect(checkpoints).toHaveLength(1);
    });
  });

  describe('pruneCheckpoints', () => {
    it('should do nothing without session', async () => {
      await handler.pruneCheckpoints(null);
      expect(fs.unlink).not.toHaveBeenCalled();
    });

    it('should remove oldest checkpoints beyond limit', async () => {
      fs.unlink.mockResolvedValue();

      const session = {
        checkpointIds: ['cp_1', 'cp_2', 'cp_3', 'cp_4', 'cp_5'],
      };

      await handler.pruneCheckpoints(session);

      // Should remove 2 to get down to maxCheckpoints (3)
      expect(fs.unlink).toHaveBeenCalledTimes(2);
      expect(session.checkpointIds).toHaveLength(3);
    });

    it('should handle deletion errors gracefully', async () => {
      fs.unlink.mockRejectedValue(new Error('Delete failed'));

      const session = {
        checkpointIds: ['cp_1', 'cp_2', 'cp_3', 'cp_4'],
      };

      await handler.pruneCheckpoints(session);

      // Should still remove from array even if file delete fails
      expect(session.checkpointIds).toHaveLength(3);
    });
  });

  describe('deleteSessionCheckpoints', () => {
    it('should delete all checkpoints', async () => {
      fs.unlink.mockResolvedValue();

      await handler.deleteSessionCheckpoints(['cp_1', 'cp_2', 'cp_3']);

      expect(fs.unlink).toHaveBeenCalledTimes(3);
    });

    it('should handle null/undefined', async () => {
      await handler.deleteSessionCheckpoints(null);
      await handler.deleteSessionCheckpoints(undefined);

      expect(fs.unlink).not.toHaveBeenCalled();
    });

    it('should ignore errors', async () => {
      fs.unlink.mockRejectedValue(new Error('Failed'));

      await handler.deleteSessionCheckpoints(['cp_1']);

      // Should not throw
    });
  });

  describe('getCheckpointCount', () => {
    it('should return checkpoint count', async () => {
      fs.writeFile.mockResolvedValue();

      const session = {
        id: 'sess',
        currentStep: 1,
        checkpointIds: [],
      };

      await handler.createCheckpoint(session);
      await handler.createCheckpoint(session);

      expect(handler.getCheckpointCount()).toBe(2);
    });
  });
});
