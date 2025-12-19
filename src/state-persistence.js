/**
 * State Persistence Module
 *
 * Provides execution state persistence to enable:
 * - Resumable sessions after interruption
 * - Checkpoint-based recovery
 * - Execution result caching
 * - Progress tracking across restarts
 *
 * Delegates to specialized modules:
 * - SessionManager: Session lifecycle management
 * - CheckpointHandler: Checkpoint creation/restoration
 * - ExecutionCache: Result caching
 */

import { promises as fs } from 'fs';
import path from 'path';
import { SessionManager } from './session-manager.js';
import { CheckpointHandler } from './checkpoint-handler.js';
import { ExecutionCache } from './execution-cache.js';

const DEFAULT_PERSISTENCE_DIR = '.claude-runner';

export class StatePersistence {
  constructor(options = {}) {
    this.options = {
      persistenceDir: options.persistenceDir || DEFAULT_PERSISTENCE_DIR,
      autoSaveInterval: options.autoSaveInterval || 30000,
      maxCheckpoints: options.maxCheckpoints || 10,
      enableCompression: options.enableCompression || false,
      ...options,
    };

    this.workingDirectory = options.workingDirectory || process.cwd();
    this.persistencePath = path.join(this.workingDirectory, this.options.persistenceDir);

    // Initialize sub-modules
    this.sessionManager = new SessionManager({
      persistencePath: this.persistencePath,
      workingDirectory: this.workingDirectory,
    });

    this.checkpointHandler = new CheckpointHandler({
      persistencePath: this.persistencePath,
      maxCheckpoints: this.options.maxCheckpoints,
    });

    this.executionCache = new ExecutionCache({
      persistencePath: this.persistencePath,
      maxSize: options.cacheMaxSize || 100,
      ttl: options.cacheTTL || 3600000,
    });

    this.autoSaveTimer = null;
  }

  // Expose currentSession for backward compatibility
  get currentSession() {
    return this.sessionManager.currentSession;
  }

  set currentSession(value) {
    this.sessionManager.currentSession = value;
  }

  async initialize() {
    try {
      await fs.mkdir(this.persistencePath, { recursive: true });
      await fs.mkdir(path.join(this.persistencePath, 'checkpoints'), { recursive: true });
      await fs.mkdir(path.join(this.persistencePath, 'cache'), { recursive: true });
      return true;
    } catch (error) {
      console.error('Failed to initialize persistence:', error.message);
      return false;
    }
  }

  async startSession(goal, options = {}) {
    const session = await this.sessionManager.startSession(goal, options);
    this.startAutoSave();
    return session;
  }

  generateSessionId(goal) {
    return this.sessionManager.generateSessionId(goal);
  }

  async saveSession() {
    return this.sessionManager.saveSession();
  }

  async loadSession(sessionId) {
    return this.sessionManager.loadSession(sessionId);
  }

  async listSessions() {
    return this.sessionManager.listSessions();
  }

  async createCheckpoint(label = '', plan = null) {
    const checkpointId = await this.checkpointHandler.createCheckpoint(
      this.sessionManager.currentSession,
      label,
      plan,
      (p) => this.sessionManager.syncPlanState(p)
    );
    if (checkpointId) {
      await this.sessionManager.saveSession();
    }
    return checkpointId;
  }

  async restoreCheckpoint(checkpointId) {
    const session = await this.checkpointHandler.restoreCheckpoint(checkpointId);
    if (session) {
      this.sessionManager.currentSession = session;
      await this.sessionManager.saveSession();
    }
    return session;
  }

  async listCheckpoints() {
    return this.checkpointHandler.listCheckpoints(this.sessionManager.currentSession);
  }

  async pruneCheckpoints() {
    return this.checkpointHandler.pruneCheckpoints(this.sessionManager.currentSession);
  }

  async setPlan(plan) {
    return this.sessionManager.setPlan(plan);
  }

  syncPlanState(plan) {
    return this.sessionManager.syncPlanState(plan);
  }

  async updateStepProgress(stepNumber, status, result = null) {
    return this.sessionManager.updateStepProgress(stepNumber, status, result);
  }

  summarizeResult(result) {
    return this.sessionManager.summarizeResult(result);
  }

  async recordContextItem(type, item) {
    return this.sessionManager.recordContextItem(type, item);
  }

  async updateMetrics(updates) {
    return this.sessionManager.updateMetrics(updates);
  }

  async completeSession(summary = null, plan = null) {
    this.stopAutoSave();
    return this.sessionManager.completeSession(summary, plan);
  }

  async failSession(error) {
    this.stopAutoSave();
    return this.sessionManager.failSession(error);
  }

  // Cache methods
  generateCacheKey(prompt, context = {}) {
    return this.executionCache.generateCacheKey(prompt, context);
  }

  async getCachedResult(prompt, context = {}) {
    return this.executionCache.getCachedResult(prompt, context);
  }

  async cacheResult(prompt, result, context = {}) {
    return this.executionCache.cacheResult(prompt, result, context);
  }

  async clearCache() {
    return this.executionCache.clear();
  }

  // Auto-save management
  startAutoSave() {
    if (this.autoSaveTimer) return;
    this.autoSaveTimer = setInterval(async () => {
      await this.sessionManager.saveSession();
    }, this.options.autoSaveInterval);
  }

  stopAutoSave() {
    if (this.autoSaveTimer) {
      clearInterval(this.autoSaveTimer);
      this.autoSaveTimer = null;
    }
  }

  // Utility methods
  getSessionState() {
    return this.sessionManager.getSessionState();
  }

  calculateProgress() {
    return this.sessionManager.calculateProgress();
  }

  async getResumableSession(goal) {
    return this.sessionManager.getResumableSession(goal);
  }

  async cleanupOldSessions(maxAgeDays = 7) {
    return this.sessionManager.cleanupOldSessions(maxAgeDays);
  }

  async deleteSession(sessionId) {
    const session = await this.sessionManager.loadSession(sessionId);
    if (session?.checkpointIds) {
      await this.checkpointHandler.deleteSessionCheckpoints(session.checkpointIds);
    }
    return this.sessionManager.deleteSession(sessionId);
  }

  getSummary() {
    return {
      session: this.sessionManager.getSessionState(),
      cache: {
        memoryEntries: this.executionCache.size(),
        maxSize: this.executionCache.maxSize,
      },
      checkpoints: this.checkpointHandler.getCheckpointCount(),
      autoSaveActive: !!this.autoSaveTimer,
    };
  }
}

export default StatePersistence;
