/**
 * Session Store - File-based persistence for session data
 *
 * Handles:
 * - Reading/writing session files
 * - Listing session files
 * - Deleting sessions
 */

import { promises as fs } from 'fs';
import path from 'path';
import { withDefault } from './error-utils.js';

export class SessionStore {
  constructor(persistencePath) {
    this.persistencePath = persistencePath;
  }

  /**
   * Save a session to disk
   * @param {object} session - Session data to save
   * @returns {Promise<boolean>} Success status
   */
  async save(session) {
    if (!session?.id) return false;

    return withDefault(async () => {
      session.updatedAt = Date.now();
      const sessionPath = path.join(this.persistencePath, `session_${session.id}.json`);
      await fs.writeFile(sessionPath, JSON.stringify(session, null, 2));
      return true;
    }, false, { logPrefix: '[SessionStore] Failed to save session:' });
  }

  /**
   * Load a session from disk
   * @param {string} sessionId - Session ID to load
   * @returns {Promise<object|null>} Session data or null
   */
  async load(sessionId) {
    return withDefault(async () => {
      const sessionPath = path.join(this.persistencePath, `session_${sessionId}.json`);
      const data = await fs.readFile(sessionPath, 'utf-8');
      return JSON.parse(data);
    }, null, { silent: true });
  }

  /**
   * List all sessions
   * @returns {Promise<Array>} List of session summaries
   */
  async list() {
    return withDefault(async () => {
      // Check if persistence directory exists
      try {
        await fs.access(this.persistencePath);
      } catch {
        return [];
      }

      const files = await fs.readdir(this.persistencePath);
      const sessions = [];

      for (const file of files) {
        if (file.startsWith('session_') && file.endsWith('.json')) {
          const session = await this.loadFromFile(file);
          if (session) {
            sessions.push(this.summarize(session));
          }
        }
      }

      return sessions.sort((a, b) => b.updatedAt - a.updatedAt);
    }, [], { logPrefix: `[SessionStore] Failed to list sessions from ${this.persistencePath}:` });
  }

  /**
   * Load session from filename
   */
  async loadFromFile(filename) {
    return withDefault(async () => {
      const sessionPath = path.join(this.persistencePath, filename);
      const data = await fs.readFile(sessionPath, 'utf-8');
      return JSON.parse(data);
    }, null, { silent: true });
  }

  /**
   * Create a summary of session for listing
   */
  summarize(session) {
    return {
      id: session.id,
      goal: session.goal,
      status: session.status,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      currentStep: session.currentStep,
      totalSteps: session.plan?.steps?.length || 0,
      completedSteps: session.completedSteps?.length || 0,
    };
  }

  /**
   * Delete a session
   * @param {string} sessionId - Session ID to delete
   * @returns {Promise<boolean>} Success status
   */
  async delete(sessionId) {
    return withDefault(async () => {
      const sessionPath = path.join(this.persistencePath, `session_${sessionId}.json`);
      await fs.unlink(sessionPath);
      return true;
    }, false, { silent: true });
  }

  /**
   * Check if a session exists
   */
  async exists(sessionId) {
    return withDefault(async () => {
      const sessionPath = path.join(this.persistencePath, `session_${sessionId}.json`);
      await fs.access(sessionPath);
      return true;
    }, false, { silent: true });
  }
}

export default SessionStore;
