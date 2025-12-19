/**
 * Session Manager - Manages execution sessions
 *
 * Handles:
 * - Session lifecycle (start, complete, fail)
 * - Step progress tracking
 * - Context recording (decisions, milestones, errors)
 * - Session metrics
 */

import { createHash } from 'crypto';
import { SessionStore } from './session-store.js';

export class SessionManager {
  constructor(options = {}) {
    this.store = new SessionStore(options.persistencePath);
    this.persistencePath = options.persistencePath;
    this.workingDirectory = options.workingDirectory || process.cwd();
    this.currentSession = null;
  }

  /** Generate a deterministic session ID from the goal */
  generateSessionId(goal) {
    const hash = createHash('sha256')
      .update(goal)
      .update(this.workingDirectory)
      .digest('hex')
      .substring(0, 12);
    return `${Date.now().toString(36)}_${hash}`;
  }

  /** Start a new session or resume an existing one */
  async startSession(goal, options = {}) {
    const sessionId = options.resumeSessionId || this.generateSessionId(goal);

    // Try to load existing session
    if (options.resumeSessionId) {
      const existingSession = await this.store.load(sessionId);
      if (existingSession) {
        this.currentSession = existingSession;
        this.currentSession.resumedAt = Date.now();
        this.currentSession.resumeCount = (this.currentSession.resumeCount || 0) + 1;
        await this.saveSession();
        return this.currentSession;
      }
    }

    // Create new session
    this.currentSession = this.createNewSession(sessionId, goal);
    await this.saveSession();
    return this.currentSession;
  }

  /** Create a new session object */
  createNewSession(sessionId, goal) {
    return {
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
      context: { keyDecisions: [], milestones: [], errors: [] },
      metrics: { totalIterations: 0, totalTokens: 0, totalDuration: 0 },
      checkpointIds: [],
    };
  }

  /** Save current session to disk */
  async saveSession() {
    if (!this.currentSession) return false;
    return this.store.save(this.currentSession);
  }

  /** Load a session from disk */
  async loadSession(sessionId) {
    return this.store.load(sessionId);
  }

  /** List all available sessions */
  async listSessions() {
    return this.store.list();
  }

  /** Sync step tracking arrays with actual plan step statuses */
  syncPlanState(plan) {
    if (!this.currentSession || !plan?.steps) return;

    const completed = [], failed = [], skipped = [];
    for (const step of plan.steps) {
      if (step.isSubtask) continue;
      if (step.status === 'completed') completed.push(step.number);
      else if (step.status === 'failed') failed.push(step.number);
      else if (step.status === 'skipped') skipped.push(step.number);
    }

    this.currentSession.completedSteps = completed;
    this.currentSession.failedSteps = failed;
    this.currentSession.skippedSteps = skipped;
    this.currentSession.plan = plan;
  }

  /** Update session with plan */
  async setPlan(plan) {
    if (!this.currentSession) return false;
    this.syncPlanState(plan);
    this.currentSession.totalSteps = plan.steps?.length || 0;
    await this.saveSession();
    return true;
  }

  /** Update current step progress */
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

    const arrays = {
      completed: this.currentSession.completedSteps,
      skipped: this.currentSession.skippedSteps,
      failed: this.currentSession.failedSteps,
    };
    if (arrays[status] && !arrays[status].includes(stepNumber)) {
      arrays[status].push(stepNumber);
    }

    await this.saveSession();
    return true;
  }

  /** Summarize a result for storage (avoid storing huge responses) */
  summarizeResult(result) {
    if (!result) return null;
    const summary = { hasResponse: !!result.response, responseLength: result.response?.length || 0 };
    if (result.response && result.response.length < 2000) {
      summary.response = result.response;
    } else if (result.response) {
      summary.responseSummary = result.response.substring(0, 500) + '...';
    }
    if (result.sessionId) summary.sessionId = result.sessionId;
    if (result.escalated) summary.escalated = result.escalated;
    if (result.error) summary.error = result.error;
    return summary;
  }

  /** Record a context item (decision, milestone, error) */
  recordContextItem(type, item) {
    if (!this.currentSession) return false;
    const contextItem = { ...item, timestamp: Date.now() };
    const contextArrays = {
      decision: { arr: this.currentSession.context.keyDecisions, max: 50 },
      milestone: { arr: this.currentSession.context.milestones, max: Infinity },
      error: { arr: this.currentSession.context.errors, max: 100 },
    };
    const config = contextArrays[type];
    if (config) {
      config.arr.push(contextItem);
      if (config.arr.length > config.max) {
        const slice = config.arr.slice(-config.max);
        if (type === 'decision') this.currentSession.context.keyDecisions = slice;
        else if (type === 'error') this.currentSession.context.errors = slice;
      }
    }
    return true;
  }

  /** Update session metrics */
  updateMetrics(updates) {
    if (!this.currentSession) return false;
    for (const [key, value] of Object.entries(updates)) {
      if (typeof value === 'number') {
        this.currentSession.metrics[key] = (this.currentSession.metrics[key] || 0) + value;
      } else {
        this.currentSession.metrics[key] = value;
      }
    }
    return true;
  }

  /** Mark session as completed */
  async completeSession(summary = null, plan = null) {
    if (!this.currentSession) return false;
    if (plan) this.syncPlanState(plan);

    this.currentSession.status = 'completed';
    this.currentSession.completedAt = Date.now();
    this.currentSession.metrics.totalDuration =
      this.currentSession.completedAt - this.currentSession.createdAt;
    if (summary) this.currentSession.summary = summary;

    await this.saveSession();
    return true;
  }

  /** Mark session as failed */
  async failSession(error) {
    if (!this.currentSession) return false;
    this.currentSession.status = 'failed';
    this.currentSession.failedAt = Date.now();
    this.currentSession.failureReason = error?.message || String(error);
    await this.saveSession();
    return true;
  }

  /** Get current session state */
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

  /** Calculate progress percentage */
  calculateProgress() {
    if (!this.currentSession?.plan?.steps) return 0;
    const total = this.currentSession.plan.steps.length;
    if (total === 0) return 0;
    const done = this.currentSession.completedSteps.length + this.currentSession.skippedSteps.length;
    return Math.round((done / total) * 100);
  }

  /** Get resumable session info */
  async getResumableSession(goal) {
    const sessions = await this.listSessions();
    return sessions.find(s =>
      s.goal === goal &&
      s.status !== 'completed' &&
      s.status !== 'failed' &&
      Date.now() - s.updatedAt < 24 * 60 * 60 * 1000
    ) || null;
  }

  /** Clean up old sessions */
  async cleanupOldSessions(maxAgeDays = 7) {
    const sessions = await this.listSessions();
    const maxAge = maxAgeDays * 24 * 60 * 60 * 1000;
    let cleaned = 0;

    for (const session of sessions) {
      if ((session.status === 'completed' || session.status === 'failed') &&
          Date.now() - session.updatedAt > maxAge) {
        if (await this.store.delete(session.id)) cleaned++;
      }
    }
    return cleaned;
  }

  /** Delete a session */
  async deleteSession(sessionId) {
    return this.store.delete(sessionId);
  }
}

export default SessionManager;
