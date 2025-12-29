/**
 * Workflow History Store - Persistent data storage for complete workflow history
 *
 * This module provides unlimited storage for:
 * - Agent prompts and responses
 * - Events beyond the 500-event limit
 * - Agent interactions with full context and timestamps
 *
 * Features:
 * - Efficient querying by agent, task, phase, and time range
 * - Configurable retention policy with memory bounds
 * - File-based persistence for scrollback and replay
 */

import fs from 'fs';
import path from 'path';

/**
 * Entry types stored in the history
 */
export const HistoryEntryTypes = {
  PROMPT: 'prompt',
  RESPONSE: 'response',
  EVENT: 'event',
  INTERACTION: 'interaction',
  TOOL_CALL: 'tool_call',
  TOOL_RESULT: 'tool_result',
  PHASE_CHANGE: 'phase_change',
  TASK_UPDATE: 'task_update'
};

/**
 * Default configuration for retention policy
 */
const DEFAULT_RETENTION_CONFIG = {
  // Maximum entries to keep in memory per category
  maxMemoryEntries: 10000,
  // Maximum age in milliseconds for memory entries (24 hours)
  maxMemoryAgeMs: 24 * 60 * 60 * 1000,
  // Maximum entries per file when persisting
  maxEntriesPerFile: 5000,
  // Maximum total disk storage in bytes (100MB)
  maxDiskStorageBytes: 100 * 1024 * 1024,
  // Enable automatic file rotation
  enableFileRotation: true,
  // Auto-flush to disk every N entries
  autoFlushThreshold: 100
};

/**
 * A single history entry with metadata for efficient querying
 */
class HistoryEntry {
  /**
   * @param {string} type - Entry type from HistoryEntryTypes
   * @param {Object} data - Entry data
   * @param {Object} context - Context for querying
   */
  constructor(type, data, context = {}) {
    this.id = `hist-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    this.type = type;
    this.timestamp = Date.now();
    this.data = data;

    // Indexable context fields
    this.agentName = context.agentName || null;
    this.taskId = context.taskId || null;
    this.goalId = context.goalId || null;
    this.phase = context.phase || null;
    this.workflowName = context.workflowName || null;

    // Sequence number for ordering
    this.sequence = 0;
  }

  /**
   * Convert to plain object for serialization
   */
  toJSON() {
    return {
      id: this.id,
      type: this.type,
      timestamp: this.timestamp,
      data: this.data,
      agentName: this.agentName,
      taskId: this.taskId,
      goalId: this.goalId,
      phase: this.phase,
      workflowName: this.workflowName,
      sequence: this.sequence
    };
  }

  /**
   * Create from plain object
   */
  static fromJSON(json) {
    const entry = new HistoryEntry(json.type, json.data, {
      agentName: json.agentName,
      taskId: json.taskId,
      goalId: json.goalId,
      phase: json.phase,
      workflowName: json.workflowName
    });
    entry.id = json.id;
    entry.timestamp = json.timestamp;
    entry.sequence = json.sequence;
    return entry;
  }
}

/**
 * Index structure for efficient querying
 */
class HistoryIndex {
  constructor() {
    // Maps for fast lookups
    this.byAgent = new Map();      // agentName -> Set<entryId>
    this.byTask = new Map();       // taskId -> Set<entryId>
    this.byPhase = new Map();      // phase -> Set<entryId>
    this.byType = new Map();       // type -> Set<entryId>
    this.byTimeRange = [];         // Sorted array of {timestamp, id} for range queries
  }

  /**
   * Add an entry to all relevant indexes
   */
  addEntry(entry) {
    const id = entry.id;

    // Index by agent
    if (entry.agentName) {
      if (!this.byAgent.has(entry.agentName)) {
        this.byAgent.set(entry.agentName, new Set());
      }
      this.byAgent.get(entry.agentName).add(id);
    }

    // Index by task
    if (entry.taskId) {
      if (!this.byTask.has(entry.taskId)) {
        this.byTask.set(entry.taskId, new Set());
      }
      this.byTask.get(entry.taskId).add(id);
    }

    // Index by phase
    if (entry.phase) {
      if (!this.byPhase.has(entry.phase)) {
        this.byPhase.set(entry.phase, new Set());
      }
      this.byPhase.get(entry.phase).add(id);
    }

    // Index by type
    if (!this.byType.has(entry.type)) {
      this.byType.set(entry.type, new Set());
    }
    this.byType.get(entry.type).add(id);

    // Add to time range index (maintain sorted order)
    this.byTimeRange.push({ timestamp: entry.timestamp, id });
  }

  /**
   * Remove an entry from all indexes
   */
  removeEntry(entry) {
    const id = entry.id;

    // Remove from agent index
    if (entry.agentName && this.byAgent.has(entry.agentName)) {
      this.byAgent.get(entry.agentName).delete(id);
      if (this.byAgent.get(entry.agentName).size === 0) {
        this.byAgent.delete(entry.agentName);
      }
    }

    // Remove from task index
    if (entry.taskId && this.byTask.has(entry.taskId)) {
      this.byTask.get(entry.taskId).delete(id);
      if (this.byTask.get(entry.taskId).size === 0) {
        this.byTask.delete(entry.taskId);
      }
    }

    // Remove from phase index
    if (entry.phase && this.byPhase.has(entry.phase)) {
      this.byPhase.get(entry.phase).delete(id);
      if (this.byPhase.get(entry.phase).size === 0) {
        this.byPhase.delete(entry.phase);
      }
    }

    // Remove from type index
    if (this.byType.has(entry.type)) {
      this.byType.get(entry.type).delete(id);
      if (this.byType.get(entry.type).size === 0) {
        this.byType.delete(entry.type);
      }
    }

    // Remove from time range (more expensive, do lazily during compaction)
    const idx = this.byTimeRange.findIndex(item => item.id === id);
    if (idx !== -1) {
      this.byTimeRange.splice(idx, 1);
    }
  }

  /**
   * Get entry IDs matching a time range
   */
  getByTimeRange(startTime, endTime) {
    const results = new Set();
    for (const item of this.byTimeRange) {
      if (item.timestamp >= startTime && item.timestamp <= endTime) {
        results.add(item.id);
      }
    }
    return results;
  }

  /**
   * Clear all indexes
   */
  clear() {
    this.byAgent.clear();
    this.byTask.clear();
    this.byPhase.clear();
    this.byType.clear();
    this.byTimeRange = [];
  }

  /**
   * Get statistics about index sizes
   */
  getStats() {
    return {
      agents: this.byAgent.size,
      tasks: this.byTask.size,
      phases: this.byPhase.size,
      types: this.byType.size,
      timeRangeEntries: this.byTimeRange.length
    };
  }
}

/**
 * WorkflowHistoryStore - Main class for persistent workflow history storage
 */
export class WorkflowHistoryStore {
  /**
   * @param {Object} options - Configuration options
   * @param {string} options.stateDir - Directory for persistent storage
   * @param {Object} options.retention - Retention policy configuration
   */
  constructor(options = {}) {
    this.stateDir = options.stateDir || '.claude-looper';
    this.historyDir = 'history';

    // Merge retention config with defaults
    this.retention = { ...DEFAULT_RETENTION_CONFIG, ...options.retention };

    // In-memory storage
    this.entries = new Map();  // id -> HistoryEntry
    this.index = new HistoryIndex();

    // Sequence counter for ordering
    this.sequenceCounter = 0;

    // Current workflow context
    this.currentContext = {
      workflowName: null,
      phase: null,
      taskId: null,
      goalId: null
    };

    // File rotation tracking
    this.currentFileIndex = 0;
    this.entriesSinceFlush = 0;
    this.fileManifest = [];  // List of history files with metadata

    // Memory usage tracking
    this.estimatedMemoryBytes = 0;

    // Initialization state
    this.initialized = false;
  }

  /**
   * Initialize the store, loading manifest and recent history
   */
  async init() {
    if (this.initialized) return;

    try {
      this._ensureHistoryDir();
      await this._loadManifest();
      await this._loadRecentHistory();
      this.initialized = true;
    } catch (err) {
      // Log error but don't fail - store can operate without persistence
      console.error('WorkflowHistoryStore init warning:', err.message);
      this.initialized = true;
    }
  }

  /**
   * Ensure history directory exists
   */
  _ensureHistoryDir() {
    const historyPath = this._getHistoryPath();
    if (!fs.existsSync(historyPath)) {
      fs.mkdirSync(historyPath, { recursive: true });
    }
  }

  /**
   * Get full path to history directory
   */
  _getHistoryPath() {
    return path.join(process.cwd(), this.stateDir, this.historyDir);
  }

  /**
   * Get path to manifest file
   */
  _getManifestPath() {
    return path.join(this._getHistoryPath(), 'manifest.json');
  }

  /**
   * Load file manifest
   */
  async _loadManifest() {
    const manifestPath = this._getManifestPath();
    if (fs.existsSync(manifestPath)) {
      try {
        const data = fs.readFileSync(manifestPath, 'utf8');
        const manifest = JSON.parse(data);
        this.fileManifest = manifest.files || [];
        this.currentFileIndex = manifest.currentFileIndex || 0;
        this.sequenceCounter = manifest.sequenceCounter || 0;
      } catch (err) {
        // Corrupted manifest, start fresh
        this.fileManifest = [];
        this.currentFileIndex = 0;
      }
    }
  }

  /**
   * Save file manifest
   */
  _saveManifest() {
    try {
      this._ensureHistoryDir();
      const manifestPath = this._getManifestPath();
      const tempPath = `${manifestPath}.tmp.${process.pid}`;
      const manifest = {
        version: 1,
        files: this.fileManifest,
        currentFileIndex: this.currentFileIndex,
        sequenceCounter: this.sequenceCounter,
        lastUpdated: Date.now()
      };
      fs.writeFileSync(tempPath, JSON.stringify(manifest, null, 2));
      fs.renameSync(tempPath, manifestPath);
    } catch (err) {
      // Non-fatal error - only log if not in test environment
      if (!this.stateDir.includes('test')) {
        console.error('Failed to save manifest:', err.message);
      }
    }
  }

  /**
   * Load recent history into memory
   */
  async _loadRecentHistory() {
    if (this.fileManifest.length === 0) return;

    // Load entries from most recent files until we hit memory limit
    const sortedFiles = [...this.fileManifest].sort((a, b) => b.endTime - a.endTime);

    for (const fileMeta of sortedFiles) {
      if (this.entries.size >= this.retention.maxMemoryEntries) break;

      try {
        await this._loadHistoryFile(fileMeta.filename);
      } catch (err) {
        // Skip corrupted files
        console.error(`Failed to load history file ${fileMeta.filename}:`, err.message);
      }
    }
  }

  /**
   * Load a single history file
   */
  async _loadHistoryFile(filename) {
    const filePath = path.join(this._getHistoryPath(), filename);
    if (!fs.existsSync(filePath)) return;

    const data = fs.readFileSync(filePath, 'utf8');
    const entries = JSON.parse(data);

    for (const entryData of entries) {
      if (this.entries.size >= this.retention.maxMemoryEntries) break;

      const entry = HistoryEntry.fromJSON(entryData);
      this.entries.set(entry.id, entry);
      this.index.addEntry(entry);
    }
  }

  /**
   * Set current workflow context for new entries
   */
  setContext(context) {
    this.currentContext = { ...this.currentContext, ...context };
  }

  /**
   * Add a prompt entry
   */
  addPrompt(agentName, prompt, context = {}) {
    return this._addEntry(HistoryEntryTypes.PROMPT, {
      content: prompt,
      agentName
    }, { ...context, agentName });
  }

  /**
   * Add a response entry
   */
  addResponse(agentName, response, context = {}) {
    return this._addEntry(HistoryEntryTypes.RESPONSE, {
      content: response,
      agentName,
      // Include tool calls if present
      toolCalls: context.toolCalls || []
    }, { ...context, agentName });
  }

  /**
   * Add an event entry
   */
  addEvent(event, context = {}) {
    return this._addEntry(HistoryEntryTypes.EVENT, {
      type: event.type,
      source: event.source,
      object: event.object,
      changeType: event.changeType
    }, {
      ...context,
      agentName: event.source
    });
  }

  /**
   * Add an interaction entry
   */
  addInteraction(fromAgent, toAgent, interaction, context = {}) {
    return this._addEntry(HistoryEntryTypes.INTERACTION, {
      from: fromAgent,
      to: toAgent,
      type: interaction.type || 'message',
      content: interaction.content,
      toolCalls: interaction.toolCalls || []
    }, {
      ...context,
      agentName: fromAgent
    });
  }

  /**
   * Add a tool call entry
   */
  addToolCall(agentName, toolName, input, context = {}) {
    return this._addEntry(HistoryEntryTypes.TOOL_CALL, {
      agentName,
      toolName,
      input
    }, { ...context, agentName });
  }

  /**
   * Add a tool result entry
   */
  addToolResult(agentName, toolName, result, context = {}) {
    return this._addEntry(HistoryEntryTypes.TOOL_RESULT, {
      agentName,
      toolName,
      result
    }, { ...context, agentName });
  }

  /**
   * Add a phase change entry
   */
  addPhaseChange(newPhase, previousPhase, context = {}) {
    this.currentContext.phase = newPhase;
    return this._addEntry(HistoryEntryTypes.PHASE_CHANGE, {
      newPhase,
      previousPhase
    }, { ...context, phase: newPhase });
  }

  /**
   * Add a task update entry
   */
  addTaskUpdate(taskId, status, details = {}, context = {}) {
    return this._addEntry(HistoryEntryTypes.TASK_UPDATE, {
      taskId,
      status,
      ...details
    }, { ...context, taskId });
  }

  /**
   * Internal method to add an entry
   */
  _addEntry(type, data, context = {}) {
    const entry = new HistoryEntry(type, data, {
      ...this.currentContext,
      ...context
    });

    // Assign sequence number
    entry.sequence = ++this.sequenceCounter;

    // Add to in-memory storage
    this.entries.set(entry.id, entry);
    this.index.addEntry(entry);

    // Update memory estimate
    this.estimatedMemoryBytes += this._estimateEntrySize(entry);

    // Check if we need to flush or enforce retention
    this.entriesSinceFlush++;
    if (this.entriesSinceFlush >= this.retention.autoFlushThreshold) {
      this._flushToFile();
    }

    this._enforceRetention();

    return entry;
  }

  /**
   * Estimate memory size of an entry
   */
  _estimateEntrySize(entry) {
    // Rough estimate: JSON string length * 2 (for string encoding) + overhead
    const jsonStr = JSON.stringify(entry);
    return jsonStr.length * 2 + 200;  // 200 bytes overhead for object structure
  }

  /**
   * Flush current entries to file
   */
  _flushToFile() {
    if (!this.retention.enableFileRotation) {
      this.entriesSinceFlush = 0;
      return;
    }

    try {
      this._ensureHistoryDir();

      // Get entries to flush (oldest entries that exceed memory limit)
      const entriesToFlush = [];
      const sortedEntries = [...this.entries.values()]
        .sort((a, b) => a.sequence - b.sequence);

      // Flush oldest entries if we're over the memory limit
      const entriesOverLimit = this.entries.size - Math.floor(this.retention.maxMemoryEntries * 0.8);
      if (entriesOverLimit > 0) {
        for (let i = 0; i < entriesOverLimit && i < sortedEntries.length; i++) {
          entriesToFlush.push(sortedEntries[i]);
        }
      }

      if (entriesToFlush.length > 0) {
        // Create new history file
        const filename = `history-${this.currentFileIndex}.json`;
        const filePath = path.join(this._getHistoryPath(), filename);
        const tempPath = `${filePath}.tmp.${process.pid}`;

        // Write entries
        const entriesData = entriesToFlush.map(e => e.toJSON());
        fs.writeFileSync(tempPath, JSON.stringify(entriesData, null, 2));
        fs.renameSync(tempPath, filePath);

        // Update manifest
        const fileMeta = {
          filename,
          entryCount: entriesToFlush.length,
          startTime: entriesToFlush[0].timestamp,
          endTime: entriesToFlush[entriesToFlush.length - 1].timestamp,
          startSequence: entriesToFlush[0].sequence,
          endSequence: entriesToFlush[entriesToFlush.length - 1].sequence
        };
        this.fileManifest.push(fileMeta);
        this.currentFileIndex++;

        // Remove flushed entries from memory (but keep in index for queries)
        // We don't remove from memory to maintain queryability
        // Retention will handle actual removal

        this._saveManifest();
        this._enforceDiskRetention();
      }

      this.entriesSinceFlush = 0;
    } catch (err) {
      console.error('Failed to flush history to file:', err.message);
      this.entriesSinceFlush = 0;
    }
  }

  /**
   * Enforce memory retention policy
   */
  _enforceRetention() {
    const now = Date.now();
    const maxAge = this.retention.maxMemoryAgeMs;
    const maxEntries = this.retention.maxMemoryEntries;

    // Remove old entries
    if (this.entries.size > maxEntries) {
      const sortedEntries = [...this.entries.values()]
        .sort((a, b) => a.sequence - b.sequence);

      const toRemove = sortedEntries.slice(0, this.entries.size - maxEntries);
      for (const entry of toRemove) {
        this.entries.delete(entry.id);
        this.index.removeEntry(entry);
        this.estimatedMemoryBytes -= this._estimateEntrySize(entry);
      }
    }

    // Remove entries older than max age
    const oldEntries = [...this.entries.values()]
      .filter(e => (now - e.timestamp) > maxAge);

    for (const entry of oldEntries) {
      this.entries.delete(entry.id);
      this.index.removeEntry(entry);
      this.estimatedMemoryBytes -= this._estimateEntrySize(entry);
    }
  }

  /**
   * Enforce disk storage limits
   */
  _enforceDiskRetention() {
    const historyPath = this._getHistoryPath();
    let totalSize = 0;

    // Calculate total disk usage
    for (const fileMeta of this.fileManifest) {
      const filePath = path.join(historyPath, fileMeta.filename);
      try {
        const stats = fs.statSync(filePath);
        totalSize += stats.size;
        fileMeta.size = stats.size;
      } catch {
        fileMeta.size = 0;
      }
    }

    // Remove oldest files if over limit
    if (totalSize > this.retention.maxDiskStorageBytes) {
      const sortedFiles = [...this.fileManifest]
        .sort((a, b) => a.startTime - b.startTime);

      while (totalSize > this.retention.maxDiskStorageBytes && sortedFiles.length > 1) {
        const oldest = sortedFiles.shift();
        const filePath = path.join(historyPath, oldest.filename);

        try {
          fs.unlinkSync(filePath);
          totalSize -= oldest.size || 0;
          this.fileManifest = this.fileManifest.filter(f => f.filename !== oldest.filename);
        } catch (err) {
          console.error(`Failed to delete old history file ${oldest.filename}:`, err.message);
        }
      }

      this._saveManifest();
    }
  }

  /**
   * Query entries by agent name
   */
  queryByAgent(agentName, options = {}) {
    const ids = this.index.byAgent.get(agentName);
    if (!ids) return [];
    return this._resolveAndFilter(ids, options);
  }

  /**
   * Query entries by task ID
   */
  queryByTask(taskId, options = {}) {
    const ids = this.index.byTask.get(taskId);
    if (!ids) return [];
    return this._resolveAndFilter(ids, options);
  }

  /**
   * Query entries by phase
   */
  queryByPhase(phase, options = {}) {
    const ids = this.index.byPhase.get(phase);
    if (!ids) return [];
    return this._resolveAndFilter(ids, options);
  }

  /**
   * Query entries by type
   */
  queryByType(type, options = {}) {
    const ids = this.index.byType.get(type);
    if (!ids) return [];
    return this._resolveAndFilter(ids, options);
  }

  /**
   * Query entries by time range
   */
  queryByTimeRange(startTime, endTime, options = {}) {
    const ids = this.index.getByTimeRange(startTime, endTime);
    return this._resolveAndFilter(ids, options);
  }

  /**
   * Query with multiple filters
   */
  query(filters = {}, options = {}) {
    let resultIds = null;

    // Apply each filter and intersect results
    if (filters.agentName) {
      const ids = this.index.byAgent.get(filters.agentName);
      resultIds = ids ? new Set(ids) : new Set();
    }

    if (filters.taskId) {
      const ids = this.index.byTask.get(filters.taskId);
      if (resultIds === null) {
        resultIds = ids ? new Set(ids) : new Set();
      } else if (ids) {
        resultIds = new Set([...resultIds].filter(id => ids.has(id)));
      } else {
        resultIds = new Set();
      }
    }

    if (filters.phase) {
      const ids = this.index.byPhase.get(filters.phase);
      if (resultIds === null) {
        resultIds = ids ? new Set(ids) : new Set();
      } else if (ids) {
        resultIds = new Set([...resultIds].filter(id => ids.has(id)));
      } else {
        resultIds = new Set();
      }
    }

    if (filters.type) {
      const ids = this.index.byType.get(filters.type);
      if (resultIds === null) {
        resultIds = ids ? new Set(ids) : new Set();
      } else if (ids) {
        resultIds = new Set([...resultIds].filter(id => ids.has(id)));
      } else {
        resultIds = new Set();
      }
    }

    if (filters.startTime || filters.endTime) {
      const startTime = filters.startTime || 0;
      const endTime = filters.endTime || Date.now();
      const ids = this.index.getByTimeRange(startTime, endTime);
      if (resultIds === null) {
        resultIds = ids;
      } else {
        resultIds = new Set([...resultIds].filter(id => ids.has(id)));
      }
    }

    // If no filters applied, return all entries
    if (resultIds === null) {
      resultIds = new Set(this.entries.keys());
    }

    return this._resolveAndFilter(resultIds, options);
  }

  /**
   * Resolve entry IDs to entries and apply options
   */
  _resolveAndFilter(ids, options = {}) {
    let entries = [];

    for (const id of ids) {
      const entry = this.entries.get(id);
      if (entry) {
        entries.push(entry);
      }
    }

    // Sort by sequence
    entries.sort((a, b) => a.sequence - b.sequence);

    // Apply limit and offset
    if (options.offset) {
      entries = entries.slice(options.offset);
    }
    if (options.limit) {
      entries = entries.slice(0, options.limit);
    }

    // Apply ordering
    if (options.order === 'desc') {
      entries.reverse();
    }

    return entries;
  }

  /**
   * Get all prompts for an agent
   */
  getAgentPrompts(agentName, options = {}) {
    return this.query({
      agentName,
      type: HistoryEntryTypes.PROMPT
    }, options);
  }

  /**
   * Get all responses for an agent
   */
  getAgentResponses(agentName, options = {}) {
    return this.query({
      agentName,
      type: HistoryEntryTypes.RESPONSE
    }, options);
  }

  /**
   * Get conversation history for an agent (prompts and responses interleaved)
   */
  getAgentConversation(agentName, options = {}) {
    const prompts = this.queryByType(HistoryEntryTypes.PROMPT);
    const responses = this.queryByType(HistoryEntryTypes.RESPONSE);

    const conversation = [...prompts, ...responses]
      .filter(e => e.agentName === agentName)
      .sort((a, b) => a.sequence - b.sequence);

    if (options.limit) {
      return conversation.slice(-options.limit);
    }
    return conversation;
  }

  /**
   * Get all events
   */
  getAllEvents(options = {}) {
    return this.queryByType(HistoryEntryTypes.EVENT, options);
  }

  /**
   * Get task history
   */
  getTaskHistory(taskId, options = {}) {
    return this.queryByTask(taskId, options);
  }

  /**
   * Get statistics about stored history
   */
  getStats() {
    const typeStats = {};
    for (const [type, ids] of this.index.byType) {
      typeStats[type] = ids.size;
    }

    const agentStats = {};
    for (const [agent, ids] of this.index.byAgent) {
      agentStats[agent] = ids.size;
    }

    return {
      totalEntries: this.entries.size,
      estimatedMemoryBytes: this.estimatedMemoryBytes,
      estimatedMemoryMB: (this.estimatedMemoryBytes / (1024 * 1024)).toFixed(2),
      filesOnDisk: this.fileManifest.length,
      sequenceCounter: this.sequenceCounter,
      byType: typeStats,
      byAgent: agentStats,
      indexStats: this.index.getStats(),
      retention: this.retention
    };
  }

  /**
   * Export all history to a single file
   */
  exportToFile(filename) {
    const entries = [...this.entries.values()]
      .sort((a, b) => a.sequence - b.sequence)
      .map(e => e.toJSON());

    const exportData = {
      version: 1,
      exportedAt: Date.now(),
      entryCount: entries.length,
      entries
    };

    const filePath = path.join(this._getHistoryPath(), filename);
    const tempPath = `${filePath}.tmp.${process.pid}`;
    fs.writeFileSync(tempPath, JSON.stringify(exportData, null, 2));
    fs.renameSync(tempPath, filePath);

    return filePath;
  }

  /**
   * Import history from a file
   */
  importFromFile(filename) {
    const filePath = path.join(this._getHistoryPath(), filename);
    const data = fs.readFileSync(filePath, 'utf8');
    const importData = JSON.parse(data);

    let imported = 0;
    for (const entryData of importData.entries) {
      if (!this.entries.has(entryData.id)) {
        const entry = HistoryEntry.fromJSON(entryData);
        this.entries.set(entry.id, entry);
        this.index.addEntry(entry);
        imported++;

        // Update sequence counter if needed
        if (entry.sequence > this.sequenceCounter) {
          this.sequenceCounter = entry.sequence;
        }
      }
    }

    return imported;
  }

  /**
   * Clear all history (memory and disk)
   */
  clear() {
    this.entries.clear();
    this.index.clear();
    this.sequenceCounter = 0;
    this.estimatedMemoryBytes = 0;
    this.entriesSinceFlush = 0;

    // Remove all history files
    const historyPath = this._getHistoryPath();
    for (const fileMeta of this.fileManifest) {
      try {
        fs.unlinkSync(path.join(historyPath, fileMeta.filename));
      } catch {
        // Ignore errors
      }
    }
    this.fileManifest = [];
    this.currentFileIndex = 0;
    this._saveManifest();
  }

  /**
   * Shutdown the store gracefully
   */
  shutdown() {
    // Flush remaining entries
    if (this.entriesSinceFlush > 0) {
      this._flushToFile();
    }
    this._saveManifest();
  }
}

// Singleton instance
let historyStoreInstance = null;

/**
 * Get or create the singleton history store instance
 */
export function getHistoryStore(options = {}) {
  if (!historyStoreInstance) {
    historyStoreInstance = new WorkflowHistoryStore(options);
  }
  return historyStoreInstance;
}

/**
 * Reset the singleton (for testing)
 */
export function resetHistoryStore() {
  if (historyStoreInstance) {
    historyStoreInstance.clear();
    historyStoreInstance = null;
  }
}

export default WorkflowHistoryStore;
