/**
 * Checkpoint Handler - Manages execution checkpoints for recovery
 *
 * Handles:
 * - Creating checkpoints of execution state
 * - Restoring from checkpoints
 * - Listing and pruning checkpoints
 */

import { promises as fs } from 'fs';
import path from 'path';
import { withDefault, logError } from './error-utils.js';

export class CheckpointHandler {
  constructor(options = {}) {
    this.persistencePath = options.persistencePath;
    this.maxCheckpoints = options.maxCheckpoints || 10;
    this.checkpoints = [];
  }

  /**
   * Create a checkpoint of current session state
   * @param {object} session - The current session object
   * @param {string} label - Optional label for the checkpoint
   * @param {object} plan - Optional plan to sync before checkpointing
   * @param {function} syncPlanState - Function to sync plan state
   */
  async createCheckpoint(session, label = '', plan = null, syncPlanState = null) {
    if (!session) return null;

    // Sync plan state if provided
    if (plan && syncPlanState) {
      syncPlanState(plan);
    }

    const checkpointId = `cp_${Date.now().toString(36)}`;
    const checkpoint = {
      id: checkpointId,
      sessionId: session.id,
      label: label || `Step ${session.currentStep}`,
      createdAt: Date.now(),
      state: JSON.parse(JSON.stringify(session)),
    };

    return withDefault(async () => {
      const checkpointPath = path.join(
        this.persistencePath,
        'checkpoints',
        `${checkpointId}.json`
      );
      await fs.writeFile(checkpointPath, JSON.stringify(checkpoint, null, 2));

      // Track checkpoint
      session.checkpointIds.push(checkpointId);
      this.checkpoints.push({
        id: checkpointId,
        label: checkpoint.label,
        createdAt: checkpoint.createdAt,
      });

      // Prune old checkpoints
      await this.pruneCheckpoints(session);

      return checkpointId;
    }, null, { logPrefix: '[CheckpointHandler] Failed to create checkpoint:' });
  }

  /**
   * Restore session from a checkpoint
   */
  async restoreCheckpoint(checkpointId) {
    return withDefault(async () => {
      const checkpointPath = path.join(
        this.persistencePath,
        'checkpoints',
        `${checkpointId}.json`
      );
      const data = await fs.readFile(checkpointPath, 'utf-8');
      const checkpoint = JSON.parse(data);

      const session = checkpoint.state;
      session.restoredFromCheckpoint = checkpointId;
      session.restoredAt = Date.now();

      return session;
    }, null, { logPrefix: '[CheckpointHandler] Failed to restore checkpoint:' });
  }

  /**
   * List checkpoints for a session
   */
  async listCheckpoints(session) {
    if (!session) return [];

    const checkpoints = [];
    for (const checkpointId of session.checkpointIds || []) {
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
  async pruneCheckpoints(session) {
    if (!session) return;

    while (session.checkpointIds.length > this.maxCheckpoints) {
      const oldestId = session.checkpointIds.shift();
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
   * Delete all checkpoints for a session
   */
  async deleteSessionCheckpoints(checkpointIds) {
    for (const cpId of checkpointIds || []) {
      try {
        const cpPath = path.join(this.persistencePath, 'checkpoints', `${cpId}.json`);
        await fs.unlink(cpPath);
      } catch {
        // Ignore errors
      }
    }
  }

  /**
   * Get checkpoint count
   */
  getCheckpointCount() {
    return this.checkpoints.length;
  }
}

export default CheckpointHandler;
