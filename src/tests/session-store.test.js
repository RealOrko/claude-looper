/**
 * Tests for session-store.js
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SessionStore } from '../session-store.js';

// Mock fs module
vi.mock('fs', () => ({
  promises: {
    writeFile: vi.fn(),
    readFile: vi.fn(),
    readdir: vi.fn(),
    unlink: vi.fn(),
    access: vi.fn(),
  },
}));

import { promises as fs } from 'fs';

describe('SessionStore', () => {
  let store;
  const testPath = '/test/.claude-runner';

  beforeEach(() => {
    store = new SessionStore(testPath);
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should set persistence path', () => {
      expect(store.persistencePath).toBe(testPath);
    });
  });

  describe('save', () => {
    it('should save session to disk', async () => {
      fs.writeFile.mockResolvedValue();
      const session = { id: 'test123', goal: 'Test goal' };

      const result = await store.save(session);

      expect(result).toBe(true);
      expect(fs.writeFile).toHaveBeenCalledWith(
        '/test/.claude-runner/session_test123.json',
        expect.any(String)
      );
    });

    it('should update updatedAt timestamp', async () => {
      fs.writeFile.mockResolvedValue();
      const session = { id: 'test123', updatedAt: 0 };

      await store.save(session);

      const savedData = JSON.parse(fs.writeFile.mock.calls[0][1]);
      expect(savedData.updatedAt).toBeGreaterThan(0);
    });

    it('should return false if session has no id', async () => {
      const result = await store.save({});
      expect(result).toBe(false);
      expect(fs.writeFile).not.toHaveBeenCalled();
    });

    it('should return false if session is null', async () => {
      const result = await store.save(null);
      expect(result).toBe(false);
    });

    it('should return false on write error', async () => {
      fs.writeFile.mockRejectedValue(new Error('Write failed'));
      const session = { id: 'test123' };

      const result = await store.save(session);

      expect(result).toBe(false);
    });
  });

  describe('load', () => {
    it('should load session from disk', async () => {
      const session = { id: 'test123', goal: 'Test' };
      fs.readFile.mockResolvedValue(JSON.stringify(session));

      const result = await store.load('test123');

      expect(result).toEqual(session);
      expect(fs.readFile).toHaveBeenCalledWith(
        '/test/.claude-runner/session_test123.json',
        'utf-8'
      );
    });

    it('should return null if session not found', async () => {
      fs.readFile.mockRejectedValue(new Error('ENOENT'));

      const result = await store.load('nonexistent');

      expect(result).toBe(null);
    });

    it('should return null on parse error', async () => {
      fs.readFile.mockResolvedValue('invalid json');

      const result = await store.load('test123');

      expect(result).toBe(null);
    });
  });

  describe('list', () => {
    it('should list all sessions', async () => {
      fs.access.mockResolvedValue();
      fs.readdir.mockResolvedValue(['session_a.json', 'session_b.json', 'other.txt']);
      fs.readFile.mockImplementation((path) => {
        if (path.includes('session_a')) {
          return Promise.resolve(JSON.stringify({ id: 'a', goal: 'A', status: 'active', createdAt: 100, updatedAt: 200 }));
        }
        if (path.includes('session_b')) {
          return Promise.resolve(JSON.stringify({ id: 'b', goal: 'B', status: 'completed', createdAt: 50, updatedAt: 300 }));
        }
        return Promise.reject(new Error('Not found'));
      });

      const result = await store.list();

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('b'); // Most recently updated first
      expect(result[1].id).toBe('a');
    });

    it('should return empty array if directory does not exist', async () => {
      fs.access.mockRejectedValue(new Error('ENOENT'));

      const result = await store.list();

      expect(result).toEqual([]);
    });

    it('should skip invalid session files', async () => {
      fs.access.mockResolvedValue();
      fs.readdir.mockResolvedValue(['session_a.json', 'session_invalid.json']);
      fs.readFile.mockImplementation((path) => {
        if (path.includes('session_a')) {
          return Promise.resolve(JSON.stringify({ id: 'a', goal: 'A', status: 'active', createdAt: 100, updatedAt: 200 }));
        }
        return Promise.resolve('invalid json');
      });

      const result = await store.list();

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('a');
    });

    it('should handle readdir errors', async () => {
      fs.access.mockResolvedValue();
      fs.readdir.mockRejectedValue(new Error('Permission denied'));

      const result = await store.list();

      expect(result).toEqual([]);
    });
  });

  describe('summarize', () => {
    it('should create session summary', () => {
      const session = {
        id: 'test123',
        goal: 'Test goal',
        status: 'active',
        createdAt: 1000,
        updatedAt: 2000,
        currentStep: 2,
        plan: { steps: [1, 2, 3] },
        completedSteps: [1],
      };

      const summary = store.summarize(session);

      expect(summary).toEqual({
        id: 'test123',
        goal: 'Test goal',
        status: 'active',
        createdAt: 1000,
        updatedAt: 2000,
        currentStep: 2,
        totalSteps: 3,
        completedSteps: 1,
      });
    });

    it('should handle missing plan', () => {
      const session = { id: 'test', goal: 'Goal', status: 'active' };

      const summary = store.summarize(session);

      expect(summary.totalSteps).toBe(0);
    });

    it('should handle missing completedSteps', () => {
      const session = { id: 'test', goal: 'Goal', status: 'active' };

      const summary = store.summarize(session);

      expect(summary.completedSteps).toBe(0);
    });
  });

  describe('delete', () => {
    it('should delete session file', async () => {
      fs.unlink.mockResolvedValue();

      const result = await store.delete('test123');

      expect(result).toBe(true);
      expect(fs.unlink).toHaveBeenCalledWith('/test/.claude-runner/session_test123.json');
    });

    it('should return false on error', async () => {
      fs.unlink.mockRejectedValue(new Error('Not found'));

      const result = await store.delete('nonexistent');

      expect(result).toBe(false);
    });
  });

  describe('exists', () => {
    it('should return true if session exists', async () => {
      fs.access.mockResolvedValue();

      const result = await store.exists('test123');

      expect(result).toBe(true);
      expect(fs.access).toHaveBeenCalledWith('/test/.claude-runner/session_test123.json');
    });

    it('should return false if session does not exist', async () => {
      fs.access.mockRejectedValue(new Error('ENOENT'));

      const result = await store.exists('nonexistent');

      expect(result).toBe(false);
    });
  });

  describe('loadFromFile', () => {
    it('should load session from filename', async () => {
      const session = { id: 'test', goal: 'Goal' };
      fs.readFile.mockResolvedValue(JSON.stringify(session));

      const result = await store.loadFromFile('session_test.json');

      expect(result).toEqual(session);
      expect(fs.readFile).toHaveBeenCalledWith('/test/.claude-runner/session_test.json', 'utf-8');
    });

    it('should return null on error', async () => {
      fs.readFile.mockRejectedValue(new Error('Not found'));

      const result = await store.loadFromFile('invalid.json');

      expect(result).toBe(null);
    });
  });
});
