/**
 * State Persistence Module
 *
 * Provides execution state persistence to enable:
 * - Resumable sessions after interruption
 * - Checkpoint-based recovery
 * - Execution result caching
 * - Progress tracking across restarts
 */

import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';

// Default persistence directory
const DEFAULT_PERSISTENCE_DIR = '.claude-runner';

export class StatePersistence {
  constructor(options = {}) {
    this.options = {
      persistenceDir: options.persistenceDir || DEFAULT_PERSISTENCE_DIR,
      autoSaveInterval: options.autoSaveInterval || 30000, // 30 seconds
      maxCheckpoints: options.maxCheckpoints || 10,
      enableCompression: options.enableCompression || false,
      ...options,
    };

    this.workingDirectory = options.workingDirectory || process.cwd();
    this.persistencePath = path.join(this.workingDirectory, this.options.persistenceDir);

    // In-memory state
    this.currentSession = null;
    this.executionCache = new Map();
    this.checkpoints = [];
    this.autoSaveTimer = null;

    // Cache settings
    this.cacheMaxSize = options.cacheMaxSize || 100;
    this.cacheTTL = options.cacheTTL || 3600000; // 1 hour default
  }

  /**
   * Initialize persistence (create directories if needed)
   */
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

  /**
   * Start a new session or resume an existing one
   */
  async startSession(goal, options = {}) {
    const sessionId = options.resumeSessionId || this.generateSessionId(goal);
    const sessionPath = path.join(this.persistencePath, `session_${sessionId}.json`);

    // Try to load existing session
    if (options.resumeSessionId) {
      const existingSession = await this.loadSession(sessionId);
      if (existingSession) {
        this.currentSession = existingSession;
        this.currentSession.resumedAt = Date.now();
        this.currentSession.resumeCount = (this.currentSession.resumeCount || 0) + 1;
        await this.saveSession();
        this.startAutoSave();
        return this.currentSession;
      }
    }

    // Create new session
    this.currentSession = {
      id: sessionId,
      goal,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      status: 'active',
      plan: null,
      currentStep: 0,
      completedSteps: [],
      skippedSteps: [],
      failedSteps: [],
      stepResults: {},
      context: {
        keyDecisions: [],
        milestones: [],
        errors: [],
      },
      metrics: {
        totalIterations: 0,
        totalTokens: 0,
        totalDuration: 0,
      },
      checkpointIds: [],
    };

    await this.saveSession();
    this.startAutoSave();
    return this.currentSession;
  }

  /**
   * Generate a deterministic session ID from the goal
   */
  generateSessionId(goal) {
    const hash = createHash('sha256')
      .update(goal)
      .update(this.workingDirectory)
      .digest('hex')
      .substring(0, 12);
    return `${Date.now().toString(36)}_${hash}`;
  }

  /**
   * Save current session to disk
   */
  async saveSession() {
    if (!this.currentSession) return false;

    try {
      this.currentSession.updatedAt = Date.now();
      const sessionPath = path.join(
        this.persistencePath,
        `session_${this.currentSession.id}.json`
      );
      await fs.writeFile(sessionPath, JSON.stringify(this.currentSession, null, 2));
      return true;
    } catch (error) {
      console.error('Failed to save session:', error.message);
      return false;
    }
  }

  /**
   * Load a session from disk
   */
  async loadSession(sessionId) {
    try {
      const sessionPath = path.join(this.persistencePath, `session_${sessionId}.json`);
      const data = await fs.readFile(sessionPath, 'utf-8');
      return JSON.parse(data);
    } catch (error) {
      return null;
    }
  }

  /**
   * List all available sessions
   */
  async listSessions() {
    try {
      const files = await fs.readdir(this.persistencePath);
      const sessions = [];

      for (const file of files) {
        if (file.startsWith('session_') && file.endsWith('.json')) {
          try {
            const sessionPath = path.join(this.persistencePath, file);
            const data = await fs.readFile(sessionPath, 'utf-8');
            const session = JSON.parse(data);
            sessions.push({
              id: session.id,
              goal: session.goal,
              status: session.status,
              createdAt: session.createdAt,
              updatedAt: session.updatedAt,
              currentStep: session.currentStep,
              totalSteps: session.plan?.steps?.length || 0,
              completedSteps: session.completedSteps?.length || 0,
            });
          } catch {
            // Skip invalid session files
          }
        }
      }

      return sessions.sort((a, b) => b.updatedAt - a.updatedAt);
    } catch (error) {
      return [];
    }
  }

  /**
   * Create a checkpoint of current state
   */
  async createCheckpoint(label = '') {
    if (!this.currentSession) return null;

    const checkpointId = `cp_${Date.now().toString(36)}`;
    const checkpoint = {
      id: checkpointId,
      sessionId: this.currentSession.id,
      label: label || `Step ${this.currentSession.currentStep}`,
      createdAt: Date.now(),
      state: JSON.parse(JSON.stringify(this.currentSession)),
    };

    try {
      const checkpointPath = path.join(
        this.persistencePath,
        'checkpoints',
        `${checkpointId}.json`
      );
      await fs.writeFile(checkpointPath, JSON.stringify(checkpoint, null, 2));

      // Track checkpoint in session
      this.currentSession.checkpointIds.push(checkpointId);
      this.checkpoints.push({ id: checkpointId, label: checkpoint.label, createdAt: checkpoint.createdAt });

      // Prune old checkpoints
      await this.pruneCheckpoints();

      await this.saveSession();
      return checkpointId;
    } catch (error) {
      console.error('Failed to create checkpoint:', error.message);
      return null;
    }
  }

  /**
   * Restore from a checkpoint
   */
  async restoreCheckpoint(checkpointId) {
    try {
      const checkpointPath = path.join(
        this.persistencePath,
        'checkpoints',
        `${checkpointId}.json`
      );
      const data = await fs.readFile(checkpointPath, 'utf-8');
      const checkpoint = JSON.parse(data);

      this.currentSession = checkpoint.state;
      this.currentSession.restoredFromCheckpoint = checkpointId;
      this.currentSession.restoredAt = Date.now();

      await this.saveSession();
      return this.currentSession;
    } catch (error) {
      console.error('Failed to restore checkpoint:', error.message);
      return null;
    }
  }

  /**
   * List checkpoints for current session
   */
  async listCheckpoints() {
    if (!this.currentSession) return [];

    const checkpoints = [];
    for (const checkpointId of this.currentSession.checkpointIds) {
      try {
        const checkpointPath = path.join(
          this.persistencePath,
          'checkpoints',
          `${checkpointId}.json`
        );
        const data = await fs.readFile(checkpointPath, 'utf-8');
        const checkpoint = JSON.parse(data);
        checkpoints.push({
          id: checkpoint.id,
          label: checkpoint.label,
          createdAt: checkpoint.createdAt,
          step: checkpoint.state.currentStep,
        });
      } catch {
        // Skip missing checkpoints
      }
    }

    return checkpoints;
  }

  /**
   * Prune old checkpoints beyond maxCheckpoints
   */
  async pruneCheckpoints() {
    if (!this.currentSession) return;

    const maxCheckpoints = this.options.maxCheckpoints;
    while (this.currentSession.checkpointIds.length > maxCheckpoints) {
      const oldestId = this.currentSession.checkpointIds.shift();
      try {
        const checkpointPath = path.join(
          this.persistencePath,
          'checkpoints',
          `${oldestId}.json`
        );
        await fs.unlink(checkpointPath);
      } catch {
        // Ignore deletion errors
      }
    }
  }

  /**
   * Update session with plan
   */
  async setPlan(plan) {
    if (!this.currentSession) return false;

    this.currentSession.plan = plan;
    this.currentSession.totalSteps = plan.steps?.length || 0;
    await this.saveSession();
    return true;
  }

  /**
   * Update current step progress
   */
  async updateStepProgress(stepNumber, status, result = null) {
    if (!this.currentSession) return false;

    this.currentSession.currentStep = stepNumber;

    if (result) {
      this.currentSession.stepResults[stepNumber] = {
        status,
        result: this.summarizeResult(result),
        timestamp: Date.now(),
      };
    }

    if (status === 'completed' && !this.currentSession.completedSteps.includes(stepNumber)) {
      this.currentSession.completedSteps.push(stepNumber);
    } else if (status === 'skipped' && !this.currentSession.skippedSteps.includes(stepNumber)) {
      this.currentSession.skippedSteps.push(stepNumber);
    } else if (status === 'failed' && !this.currentSession.failedSteps.includes(stepNumber)) {
      this.currentSession.failedSteps.push(stepNumber);
    }

    await this.saveSession();
    return true;
  }

  /**
   * Summarize a result for storage (avoid storing huge responses)
   */
  summarizeResult(result) {
    if (!result) return null;

    const summary = {
      hasResponse: !!result.response,
      responseLength: result.response?.length || 0,
    };

    // Store truncated response if small enough
    if (result.response && result.response.length < 2000) {
      summary.response = result.response;
    } else if (result.response) {
      summary.responseSummary = result.response.substring(0, 500) + '...';
    }

    // Copy other relevant fields
    if (result.sessionId) summary.sessionId = result.sessionId;
    if (result.escalated) summary.escalated = result.escalated;
    if (result.error) summary.error = result.error;

    return summary;
  }

  /**
   * Record a context item (decision, milestone, error)
   */
  async recordContextItem(type, item) {
    if (!this.currentSession) return false;

    const contextItem = {
      ...item,
      timestamp: Date.now(),
    };

    if (type === 'decision') {
      this.currentSession.context.keyDecisions.push(contextItem);
      // Keep only recent decisions
      if (this.currentSession.context.keyDecisions.length > 50) {
        this.currentSession.context.keyDecisions =
          this.currentSession.context.keyDecisions.slice(-50);
      }
    } else if (type === 'milestone') {
      this.currentSession.context.milestones.push(contextItem);
    } else if (type === 'error') {
      this.currentSession.context.errors.push(contextItem);
      // Keep only recent errors
      if (this.currentSession.context.errors.length > 100) {
        this.currentSession.context.errors =
          this.currentSession.context.errors.slice(-100);
      }
    }

    // Don't save immediately for every context item (batched in auto-save)
    return true;
  }

  /**
   * Update session metrics
   */
  async updateMetrics(updates) {
    if (!this.currentSession) return false;

    for (const [key, value] of Object.entries(updates)) {
      if (typeof value === 'number') {
        this.currentSession.metrics[key] = (this.currentSession.metrics[key] || 0) + value;
      } else {
        this.currentSession.metrics[key] = value;
      }
    }

    // Don't save immediately (batched in auto-save)
    return true;
  }

  /**
   * Mark session as completed
   */
  async completeSession(summary = null) {
    if (!this.currentSession) return false;

    this.currentSession.status = 'completed';
    this.currentSession.completedAt = Date.now();
    this.currentSession.metrics.totalDuration =
      this.currentSession.completedAt - this.currentSession.createdAt;

    if (summary) {
      this.currentSession.summary = summary;
    }

    this.stopAutoSave();
    await this.saveSession();
    return true;
  }

  /**
   * Mark session as failed
   */
  async failSession(error) {
    if (!this.currentSession) return false;

    this.currentSession.status = 'failed';
    this.currentSession.failedAt = Date.now();
    this.currentSession.failureReason = error?.message || String(error);

    this.stopAutoSave();
    await this.saveSession();
    return true;
  }

  // ========== Execution Cache Methods ==========

  /**
   * Generate cache key for a prompt/step
   */
  generateCacheKey(prompt, context = {}) {
    const keyData = {
      prompt: prompt.substring(0, 500), // Use start of prompt
      step: context.stepNumber,
      goal: context.goal?.substring(0, 200),
    };
    return createHash('sha256').update(JSON.stringify(keyData)).digest('hex').substring(0, 16);
  }

  /**
   * Get cached result for a prompt
   */
  async getCachedResult(prompt, context = {}) {
    const cacheKey = this.generateCacheKey(prompt, context);

    // Check in-memory cache first
    if (this.executionCache.has(cacheKey)) {
      const cached = this.executionCache.get(cacheKey);
      if (Date.now() - cached.timestamp < this.cacheTTL) {
        return { ...cached.result, fromCache: true };
      }
      this.executionCache.delete(cacheKey);
    }

    // Check disk cache
    try {
      const cachePath = path.join(this.persistencePath, 'cache', `${cacheKey}.json`);
      const data = await fs.readFile(cachePath, 'utf-8');
      const cached = JSON.parse(data);

      if (Date.now() - cached.timestamp < this.cacheTTL) {
        // Restore to memory cache
        this.executionCache.set(cacheKey, cached);
        return { ...cached.result, fromCache: true };
      }

      // Expired - delete
      await fs.unlink(cachePath);
    } catch {
      // Not cached
    }

    return null;
  }

  /**
   * Cache a result
   */
  async cacheResult(prompt, result, context = {}) {
    const cacheKey = this.generateCacheKey(prompt, context);

    const cacheEntry = {
      key: cacheKey,
      timestamp: Date.now(),
      context: {
        stepNumber: context.stepNumber,
        goal: context.goal?.substring(0, 200),
      },
      result: this.summarizeResult(result),
    };

    // Store in memory
    this.executionCache.set(cacheKey, cacheEntry);

    // Prune memory cache if too large
    if (this.executionCache.size > this.cacheMaxSize) {
      const oldestKey = this.executionCache.keys().next().value;
      this.executionCache.delete(oldestKey);
    }

    // Store on disk (async, don't block)
    const cachePath = path.join(this.persistencePath, 'cache', `${cacheKey}.json`);
    fs.writeFile(cachePath, JSON.stringify(cacheEntry, null, 2)).catch(() => {});

    return cacheKey;
  }

  /**
   * Clear execution cache
   */
  async clearCache() {
    this.executionCache.clear();

    try {
      const cacheDir = path.join(this.persistencePath, 'cache');
      const files = await fs.readdir(cacheDir);
      for (const file of files) {
        if (file.endsWith('.json')) {
          await fs.unlink(path.join(cacheDir, file)).catch(() => {});
        }
      }
    } catch {
      // Ignore errors
    }
  }

  // ========== Auto-save Management ==========

  /**
   * Start auto-save timer
   */
  startAutoSave() {
    if (this.autoSaveTimer) return;

    this.autoSaveTimer = setInterval(async () => {
      await this.saveSession();
    }, this.options.autoSaveInterval);
  }

  /**
   * Stop auto-save timer
   */
  stopAutoSave() {
    if (this.autoSaveTimer) {
      clearInterval(this.autoSaveTimer);
      this.autoSaveTimer = null;
    }
  }

  // ========== Utility Methods ==========

  /**
   * Get current session state
   */
  getSessionState() {
    if (!this.currentSession) return null;

    return {
      id: this.currentSession.id,
      goal: this.currentSession.goal,
      status: this.currentSession.status,
      currentStep: this.currentSession.currentStep,
      totalSteps: this.currentSession.plan?.steps?.length || 0,
      completedSteps: this.currentSession.completedSteps.length,
      skippedSteps: this.currentSession.skippedSteps.length,
      failedSteps: this.currentSession.failedSteps.length,
      progress: this.calculateProgress(),
      duration: Date.now() - this.currentSession.createdAt,
      metrics: this.currentSession.metrics,
    };
  }

  /**
   * Calculate progress percentage
   */
  calculateProgress() {
    if (!this.currentSession?.plan?.steps) return 0;

    const totalSteps = this.currentSession.plan.steps.length;
    if (totalSteps === 0) return 0;

    const completed = this.currentSession.completedSteps.length;
    const skipped = this.currentSession.skippedSteps.length;

    return Math.round(((completed + skipped) / totalSteps) * 100);
  }

  /**
   * Get resumable session info
   */
  async getResumableSession(goal) {
    const sessions = await this.listSessions();

    // Find a session with the same goal that's not completed
    const resumable = sessions.find(
      (s) =>
        s.goal === goal &&
        s.status !== 'completed' &&
        s.status !== 'failed' &&
        Date.now() - s.updatedAt < 24 * 60 * 60 * 1000 // Within 24 hours
    );

    return resumable || null;
  }

  /**
   * Clean up old sessions
   */
  async cleanupOldSessions(maxAgeDays = 7) {
    const sessions = await this.listSessions();
    const maxAge = maxAgeDays * 24 * 60 * 60 * 1000;
    let cleaned = 0;

    for (const session of sessions) {
      if (
        (session.status === 'completed' || session.status === 'failed') &&
        Date.now() - session.updatedAt > maxAge
      ) {
        try {
          const sessionPath = path.join(this.persistencePath, `session_${session.id}.json`);
          await fs.unlink(sessionPath);
          cleaned++;
        } catch {
          // Ignore errors
        }
      }
    }

    return cleaned;
  }

  /**
   * Delete a session
   */
  async deleteSession(sessionId) {
    try {
      const sessionPath = path.join(this.persistencePath, `session_${sessionId}.json`);
      await fs.unlink(sessionPath);

      // Also delete associated checkpoints
      const session = await this.loadSession(sessionId);
      if (session?.checkpointIds) {
        for (const cpId of session.checkpointIds) {
          const cpPath = path.join(this.persistencePath, 'checkpoints', `${cpId}.json`);
          await fs.unlink(cpPath).catch(() => {});
        }
      }

      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get summary for current session
   */
  getSummary() {
    return {
      session: this.getSessionState(),
      cache: {
        memoryEntries: this.executionCache.size,
        maxSize: this.cacheMaxSize,
      },
      checkpoints: this.checkpoints.length,
      autoSaveActive: !!this.autoSaveTimer,
    };
  }
}

export default StatePersistence;
