/**
 * WorkflowLogger - Persistent logging to file system for post-mortem analysis
 *
 * This module provides:
 * - Structured JSON log files organized by workflow run
 * - Complete prompt/response history without truncation
 * - Human-readable export summaries
 * - Replay capability for loading logs into UI
 * - Configurable log size and retention
 */

import fs from 'fs';
import path from 'path';
import { HistoryEntryTypes } from './workflow-history-store.js';

/**
 * Default configuration for logging
 */
const DEFAULT_LOGGER_CONFIG = {
  // Base directory for logs
  logDir: '.claude-looper/logs',
  // Maximum size per log file in bytes (10MB default)
  maxLogFileSizeBytes: 10 * 1024 * 1024,
  // Maximum number of log files to retain per workflow
  maxLogFilesPerWorkflow: 10,
  // Maximum total log storage in bytes (500MB default)
  maxTotalStorageBytes: 500 * 1024 * 1024,
  // Maximum age of log files in days
  maxLogAgeDays: 30,
  // Whether to write logs synchronously (safer but slower)
  syncWrites: false,
  // Whether to pretty-print JSON (more readable but larger)
  prettyPrint: true,
  // Buffer size before flushing to disk
  bufferSize: 50,
  // Include timestamps in filenames
  timestampedFilenames: true
};

/**
 * WorkflowLogger - Main class for persistent workflow logging
 */
export class WorkflowLogger {
  /**
   * @param {Object} options - Configuration options
   */
  constructor(options = {}) {
    this.config = { ...DEFAULT_LOGGER_CONFIG, ...options };
    this.logDir = path.resolve(process.cwd(), this.config.logDir);

    // Current workflow run context
    this.currentRunId = null;
    this.currentRunDir = null;
    this.runStartTime = null;
    this.runMetadata = null;

    // Entry buffer for batched writes
    this.entryBuffer = [];
    this.currentLogFileIndex = 0;
    this.currentLogFileSize = 0;

    // Tracking
    this.entriesWritten = 0;
    this.initialized = false;
  }

  /**
   * Initialize the logger
   */
  async init() {
    if (this.initialized) return;

    try {
      this._ensureLogDir();
      await this._cleanupOldLogs();
      this.initialized = true;
    } catch (err) {
      console.error('WorkflowLogger init warning:', err.message);
      this.initialized = true; // Continue anyway
    }
  }

  /**
   * Start a new workflow run
   * @param {Object} metadata - Workflow metadata (name, goal, etc.)
   * @returns {string} The run ID
   */
  startRun(metadata = {}) {
    // Generate unique run ID
    this.runStartTime = Date.now();
    const timestamp = new Date(this.runStartTime).toISOString().replace(/[:.]/g, '-');
    this.currentRunId = `run-${timestamp}-${Math.random().toString(36).substr(2, 6)}`;

    // Create run directory
    this.currentRunDir = path.join(this.logDir, this.currentRunId);
    this._ensureDir(this.currentRunDir);

    // Initialize run metadata
    this.runMetadata = {
      runId: this.currentRunId,
      startTime: this.runStartTime,
      startTimeISO: new Date(this.runStartTime).toISOString(),
      workflowName: metadata.workflowName || 'unnamed',
      goal: metadata.goal || '',
      config: metadata.config || {},
      status: 'running',
      endTime: null,
      entriesCount: 0,
      phases: [],
      agents: new Set(),
      errors: []
    };

    // Write initial metadata
    this._writeMetadata();

    // Reset counters
    this.currentLogFileIndex = 0;
    this.currentLogFileSize = 0;
    this.entriesWritten = 0;
    this.entryBuffer = [];

    return this.currentRunId;
  }

  /**
   * End the current workflow run
   * @param {string} status - Final status ('completed', 'failed', 'cancelled')
   * @param {Object} summary - Summary data
   */
  endRun(status = 'completed', summary = {}) {
    if (!this.currentRunId) return;

    // Flush remaining buffer
    this._flushBuffer();

    // Update metadata
    this.runMetadata.endTime = Date.now();
    this.runMetadata.endTimeISO = new Date(this.runMetadata.endTime).toISOString();
    this.runMetadata.status = status;
    this.runMetadata.duration = this.runMetadata.endTime - this.runStartTime;
    this.runMetadata.durationFormatted = this._formatDuration(this.runMetadata.duration);
    this.runMetadata.entriesCount = this.entriesWritten;
    this.runMetadata.agents = Array.from(this.runMetadata.agents);
    this.runMetadata.summary = summary;

    this._writeMetadata();

    // Generate summary report
    this._generateSummaryReport();

    // Reset state
    this.currentRunId = null;
    this.currentRunDir = null;
    this.runMetadata = null;
  }

  /**
   * Log a history entry (from WorkflowHistoryStore)
   * @param {Object} entry - History entry
   */
  logEntry(entry) {
    if (!this.currentRunId) {
      // Auto-start a run if none exists
      this.startRun({ workflowName: 'auto-started' });
    }

    // Create log record
    const record = {
      id: entry.id,
      sequence: entry.sequence,
      type: entry.type,
      timestamp: entry.timestamp,
      timestampISO: new Date(entry.timestamp).toISOString(),
      agentName: entry.agentName,
      taskId: entry.taskId,
      goalId: entry.goalId,
      phase: entry.phase,
      data: entry.data // Full data, no truncation
    };

    // Update metadata
    if (entry.agentName) {
      this.runMetadata.agents.add(entry.agentName);
    }
    if (entry.type === HistoryEntryTypes.PHASE_CHANGE) {
      this.runMetadata.phases.push({
        phase: entry.data.newPhase,
        timestamp: entry.timestamp
      });
    }
    if (entry.data?.type?.includes('error') || entry.data?.type?.includes('failed')) {
      this.runMetadata.errors.push({
        type: entry.data.type,
        timestamp: entry.timestamp,
        details: entry.data.object
      });
    }

    // Add to buffer
    this.entryBuffer.push(record);

    // Flush if buffer is full
    if (this.entryBuffer.length >= this.config.bufferSize) {
      this._flushBuffer();
    }
  }

  /**
   * Log a prompt without truncation
   */
  logPrompt(agentName, prompt, context = {}) {
    if (!this.currentRunId) {
      // Auto-start a run if none exists
      this.startRun({ workflowName: 'auto-started' });
    }

    const record = {
      id: `prompt-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
      sequence: this.entriesWritten,
      type: HistoryEntryTypes.PROMPT,
      timestamp: Date.now(),
      timestampISO: new Date().toISOString(),
      agentName,
      phase: context.phase || this.runMetadata?.phases?.slice(-1)[0]?.phase,
      taskId: context.taskId,
      data: {
        content: prompt, // Full content, no truncation
        contentLength: prompt?.length || 0,
        agentName
      }
    };

    // Track agent in metadata
    if (agentName && this.runMetadata) {
      this.runMetadata.agents.add(agentName);
    }

    this.entryBuffer.push(record);
    if (this.entryBuffer.length >= this.config.bufferSize) {
      this._flushBuffer();
    }
  }

  /**
   * Log a response without truncation
   */
  logResponse(agentName, response, context = {}) {
    if (!this.currentRunId) {
      // Auto-start a run if none exists
      this.startRun({ workflowName: 'auto-started' });
    }

    const record = {
      id: `response-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
      sequence: this.entriesWritten,
      type: HistoryEntryTypes.RESPONSE,
      timestamp: Date.now(),
      timestampISO: new Date().toISOString(),
      agentName,
      phase: context.phase || this.runMetadata?.phases?.slice(-1)[0]?.phase,
      taskId: context.taskId,
      data: {
        content: response, // Full content, no truncation
        contentLength: response?.length || 0,
        agentName,
        toolCalls: context.toolCalls || []
      }
    };

    // Track agent in metadata
    if (agentName && this.runMetadata) {
      this.runMetadata.agents.add(agentName);
    }

    this.entryBuffer.push(record);
    if (this.entryBuffer.length >= this.config.bufferSize) {
      this._flushBuffer();
    }
  }

  /**
   * Flush buffer to disk
   */
  _flushBuffer() {
    if (this.entryBuffer.length === 0 || !this.currentRunDir) return;

    try {
      // Check if we need to rotate log file
      const estimatedSize = JSON.stringify(this.entryBuffer).length;
      if (this.currentLogFileSize + estimatedSize > this.config.maxLogFileSizeBytes) {
        this.currentLogFileIndex++;
        this.currentLogFileSize = 0;
      }

      // Write entries to log file
      const logFileName = `log-${String(this.currentLogFileIndex).padStart(4, '0')}.jsonl`;
      const logFilePath = path.join(this.currentRunDir, logFileName);

      // Use JSONL format (one JSON object per line) for efficient streaming
      const lines = this.entryBuffer.map(entry =>
        this.config.prettyPrint ? JSON.stringify(entry) : JSON.stringify(entry)
      );
      const content = lines.join('\n') + '\n';

      if (this.config.syncWrites) {
        fs.appendFileSync(logFilePath, content);
      } else {
        fs.appendFile(logFilePath, content, (err) => {
          if (err) console.error('Failed to write log entry:', err.message);
        });
      }

      this.currentLogFileSize += content.length;
      this.entriesWritten += this.entryBuffer.length;
      this.entryBuffer = [];

      // Enforce per-workflow file limit
      this._enforceWorkflowFileLimit();
    } catch (err) {
      console.error('Failed to flush log buffer:', err.message);
    }
  }

  /**
   * Write run metadata
   */
  _writeMetadata() {
    if (!this.currentRunDir) return;

    try {
      const metadataPath = path.join(this.currentRunDir, 'metadata.json');
      const tempPath = `${metadataPath}.tmp.${process.pid}`;

      // Convert Set to Array for JSON
      const metadata = {
        ...this.runMetadata,
        agents: Array.from(this.runMetadata.agents)
      };

      fs.writeFileSync(tempPath, JSON.stringify(metadata, null, 2));
      fs.renameSync(tempPath, metadataPath);
    } catch (err) {
      console.error('Failed to write metadata:', err.message);
    }
  }

  /**
   * Generate human-readable summary report
   */
  _generateSummaryReport() {
    if (!this.currentRunDir || !this.runMetadata) return;

    try {
      const report = this._buildSummaryReport();
      const reportPath = path.join(this.currentRunDir, 'summary.txt');
      fs.writeFileSync(reportPath, report);
    } catch (err) {
      console.error('Failed to generate summary report:', err.message);
    }
  }

  /**
   * Build human-readable summary report text
   */
  _buildSummaryReport() {
    const m = this.runMetadata;
    const lines = [];

    lines.push('═'.repeat(70));
    lines.push('                    WORKFLOW RUN SUMMARY');
    lines.push('═'.repeat(70));
    lines.push('');

    // Basic info
    lines.push(`Run ID:         ${m.runId}`);
    lines.push(`Workflow:       ${m.workflowName}`);
    lines.push(`Status:         ${m.status.toUpperCase()}`);
    lines.push(`Started:        ${m.startTimeISO}`);
    lines.push(`Ended:          ${m.endTimeISO || 'N/A'}`);
    lines.push(`Duration:       ${m.durationFormatted || 'N/A'}`);
    lines.push('');

    // Goal
    if (m.goal) {
      lines.push('─'.repeat(70));
      lines.push('GOAL:');
      lines.push('─'.repeat(70));
      lines.push(m.goal);
      lines.push('');
    }

    // Statistics
    lines.push('─'.repeat(70));
    lines.push('STATISTICS:');
    lines.push('─'.repeat(70));
    lines.push(`Total Entries:  ${m.entriesCount}`);
    lines.push(`Agents Used:    ${(Array.isArray(m.agents) ? m.agents : []).join(', ') || 'none'}`);
    lines.push(`Phases:         ${m.phases?.length || 0}`);
    lines.push(`Errors:         ${m.errors?.length || 0}`);
    lines.push('');

    // Phase timeline
    if (m.phases && m.phases.length > 0) {
      lines.push('─'.repeat(70));
      lines.push('PHASE TIMELINE:');
      lines.push('─'.repeat(70));
      for (const phase of m.phases) {
        const time = new Date(phase.timestamp).toLocaleTimeString();
        lines.push(`  ${time}  →  ${phase.phase}`);
      }
      lines.push('');
    }

    // Errors
    if (m.errors && m.errors.length > 0) {
      lines.push('─'.repeat(70));
      lines.push('ERRORS:');
      lines.push('─'.repeat(70));
      for (const error of m.errors) {
        const time = new Date(error.timestamp).toLocaleTimeString();
        lines.push(`  ${time}  ${error.type}`);
        if (error.details) {
          lines.push(`           ${JSON.stringify(error.details).substring(0, 100)}`);
        }
      }
      lines.push('');
    }

    // Summary data
    if (m.summary && Object.keys(m.summary).length > 0) {
      lines.push('─'.repeat(70));
      lines.push('SUMMARY:');
      lines.push('─'.repeat(70));
      for (const [key, value] of Object.entries(m.summary)) {
        lines.push(`  ${key}: ${JSON.stringify(value)}`);
      }
      lines.push('');
    }

    lines.push('═'.repeat(70));
    lines.push(`Log files located at: ${this.currentRunDir}`);
    lines.push('═'.repeat(70));

    return lines.join('\n');
  }

  /**
   * Export a workflow run to a single JSON file
   * @param {string} runId - Run ID to export (or current run if null)
   * @param {string} outputPath - Optional output path
   * @returns {string} Path to exported file
   */
  exportRun(runId = null, outputPath = null) {
    const targetRunId = runId || this.currentRunId;
    if (!targetRunId) {
      throw new Error('No run ID specified and no current run active');
    }

    const runDir = path.join(this.logDir, targetRunId);
    if (!fs.existsSync(runDir)) {
      throw new Error(`Run directory not found: ${runDir}`);
    }

    // Load all log files
    const entries = this._loadRunEntries(runDir);

    // Load metadata
    const metadataPath = path.join(runDir, 'metadata.json');
    let metadata = {};
    if (fs.existsSync(metadataPath)) {
      metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
    }

    // Build export data
    const exportData = {
      version: 1,
      exportedAt: new Date().toISOString(),
      metadata,
      entries,
      entryCount: entries.length
    };

    // Determine output path
    const exportFileName = `export-${targetRunId}.json`;
    const exportPath = outputPath || path.join(this.logDir, exportFileName);

    // Write export file
    const tempPath = `${exportPath}.tmp.${process.pid}`;
    fs.writeFileSync(tempPath, JSON.stringify(exportData, null, 2));
    fs.renameSync(tempPath, exportPath);

    return exportPath;
  }

  /**
   * Generate a human-readable summary report for a run
   * @param {string} runId - Run ID (or current run if null)
   * @param {string} outputPath - Optional output path
   * @returns {string} Path to report file
   */
  exportSummaryReport(runId = null, outputPath = null) {
    const targetRunId = runId || this.currentRunId;
    if (!targetRunId) {
      throw new Error('No run ID specified and no current run active');
    }

    const runDir = path.join(this.logDir, targetRunId);
    if (!fs.existsSync(runDir)) {
      throw new Error(`Run directory not found: ${runDir}`);
    }

    // Load metadata
    const metadataPath = path.join(runDir, 'metadata.json');
    if (!fs.existsSync(metadataPath)) {
      throw new Error('Metadata file not found');
    }

    const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));

    // Load entries for detailed analysis
    const entries = this._loadRunEntries(runDir);

    // Build detailed report
    const report = this._buildDetailedReport(metadata, entries);

    // Determine output path
    const reportFileName = `report-${targetRunId}.txt`;
    const reportPath = outputPath || path.join(this.logDir, reportFileName);

    fs.writeFileSync(reportPath, report);

    return reportPath;
  }

  /**
   * Build a detailed human-readable report
   */
  _buildDetailedReport(metadata, entries) {
    const lines = [];

    lines.push('═'.repeat(80));
    lines.push('                         DETAILED WORKFLOW REPORT');
    lines.push('═'.repeat(80));
    lines.push('');

    // Basic info
    lines.push(`Run ID:         ${metadata.runId}`);
    lines.push(`Workflow:       ${metadata.workflowName}`);
    lines.push(`Status:         ${metadata.status?.toUpperCase() || 'UNKNOWN'}`);
    lines.push(`Started:        ${metadata.startTimeISO}`);
    lines.push(`Ended:          ${metadata.endTimeISO || 'N/A'}`);
    lines.push(`Duration:       ${metadata.durationFormatted || 'N/A'}`);
    lines.push(`Total Entries:  ${entries.length}`);
    lines.push('');

    // Goal
    if (metadata.goal) {
      lines.push('─'.repeat(80));
      lines.push('GOAL:');
      lines.push('─'.repeat(80));
      lines.push(metadata.goal);
      lines.push('');
    }

    // Prompt/Response Summary
    const prompts = entries.filter(e => e.type === HistoryEntryTypes.PROMPT);
    const responses = entries.filter(e => e.type === HistoryEntryTypes.RESPONSE);

    lines.push('─'.repeat(80));
    lines.push('CONVERSATION SUMMARY:');
    lines.push('─'.repeat(80));
    lines.push(`Total Prompts:    ${prompts.length}`);
    lines.push(`Total Responses:  ${responses.length}`);

    // By agent
    const agentCounts = {};
    for (const entry of [...prompts, ...responses]) {
      const agent = entry.agentName || 'unknown';
      agentCounts[agent] = (agentCounts[agent] || 0) + 1;
    }
    lines.push('');
    lines.push('By Agent:');
    for (const [agent, count] of Object.entries(agentCounts)) {
      lines.push(`  ${agent}: ${count} entries`);
    }
    lines.push('');

    // Phase Timeline
    const phaseChanges = entries.filter(e => e.type === HistoryEntryTypes.PHASE_CHANGE);
    if (phaseChanges.length > 0) {
      lines.push('─'.repeat(80));
      lines.push('PHASE TIMELINE:');
      lines.push('─'.repeat(80));
      for (const pc of phaseChanges) {
        const time = new Date(pc.timestamp).toLocaleTimeString();
        lines.push(`  ${time}  ${pc.data.previousPhase || 'start'} → ${pc.data.newPhase}`);
      }
      lines.push('');
    }

    // Task Updates
    const taskUpdates = entries.filter(e => e.type === HistoryEntryTypes.TASK_UPDATE);
    if (taskUpdates.length > 0) {
      lines.push('─'.repeat(80));
      lines.push('TASK UPDATES:');
      lines.push('─'.repeat(80));
      for (const tu of taskUpdates) {
        const time = new Date(tu.timestamp).toLocaleTimeString();
        lines.push(`  ${time}  [${tu.data.taskId}] ${tu.data.status}`);
        if (tu.data.description) {
          lines.push(`           ${tu.data.description.substring(0, 60)}...`);
        }
      }
      lines.push('');
    }

    // Errors
    const errors = entries.filter(e =>
      e.data?.type?.includes('error') ||
      e.data?.type?.includes('failed')
    );
    if (errors.length > 0) {
      lines.push('─'.repeat(80));
      lines.push('ERRORS AND FAILURES:');
      lines.push('─'.repeat(80));
      for (const err of errors) {
        const time = new Date(err.timestamp).toLocaleTimeString();
        lines.push(`  ${time}  ${err.data.type}`);
        if (err.data.object) {
          const objStr = JSON.stringify(err.data.object);
          lines.push(`           ${objStr.substring(0, 70)}${objStr.length > 70 ? '...' : ''}`);
        }
      }
      lines.push('');
    }

    // Full Prompt/Response History (last 10)
    lines.push('─'.repeat(80));
    lines.push('RECENT PROMPT/RESPONSE HISTORY (last 10):');
    lines.push('─'.repeat(80));

    const recentConversation = entries
      .filter(e => e.type === HistoryEntryTypes.PROMPT || e.type === HistoryEntryTypes.RESPONSE)
      .slice(-10);

    for (const entry of recentConversation) {
      const time = new Date(entry.timestamp).toLocaleTimeString();
      const type = entry.type === HistoryEntryTypes.PROMPT ? 'PROMPT' : 'RESPONSE';
      const agent = entry.agentName || 'unknown';

      lines.push('');
      lines.push(`[${time}] ${type} - ${agent}`);
      lines.push('-'.repeat(40));

      const content = entry.data?.content || '';
      // Show first 500 chars of content in report
      const preview = content.substring(0, 500);
      lines.push(preview);
      if (content.length > 500) {
        lines.push(`... (${content.length - 500} more characters)`);
      }
    }

    lines.push('');
    lines.push('═'.repeat(80));
    lines.push('END OF REPORT');
    lines.push('═'.repeat(80));

    return lines.join('\n');
  }

  /**
   * Load all entries from a run directory
   */
  _loadRunEntries(runDir) {
    const entries = [];

    try {
      const files = fs.readdirSync(runDir)
        .filter(f => f.startsWith('log-') && f.endsWith('.jsonl'))
        .sort();

      for (const file of files) {
        const filePath = path.join(runDir, file);
        const content = fs.readFileSync(filePath, 'utf8');
        const lines = content.split('\n').filter(line => line.trim());

        for (const line of lines) {
          try {
            entries.push(JSON.parse(line));
          } catch {
            // Skip malformed lines
          }
        }
      }
    } catch (err) {
      console.error('Failed to load run entries:', err.message);
    }

    // Sort by sequence
    entries.sort((a, b) => (a.sequence || 0) - (b.sequence || 0));

    return entries;
  }

  /**
   * Load a run for replay/review in UI
   * @param {string} runId - Run ID to load
   * @returns {Object} Run data with metadata and entries
   */
  loadRun(runId) {
    const runDir = path.join(this.logDir, runId);
    if (!fs.existsSync(runDir)) {
      throw new Error(`Run not found: ${runId}`);
    }

    // Load metadata
    const metadataPath = path.join(runDir, 'metadata.json');
    let metadata = { runId };
    if (fs.existsSync(metadataPath)) {
      metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
    }

    // Load entries
    const entries = this._loadRunEntries(runDir);

    return {
      metadata,
      entries,
      entryCount: entries.length
    };
  }

  /**
   * List all available workflow runs
   * @returns {Array} List of run metadata
   */
  listRuns() {
    const runs = [];

    try {
      if (!fs.existsSync(this.logDir)) {
        return runs;
      }

      const dirs = fs.readdirSync(this.logDir)
        .filter(d => d.startsWith('run-'))
        .filter(d => fs.statSync(path.join(this.logDir, d)).isDirectory());

      for (const dir of dirs) {
        const metadataPath = path.join(this.logDir, dir, 'metadata.json');
        if (fs.existsSync(metadataPath)) {
          try {
            const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
            runs.push(metadata);
          } catch {
            // Include basic info for corrupted metadata
            runs.push({ runId: dir, status: 'unknown' });
          }
        } else {
          runs.push({ runId: dir, status: 'unknown' });
        }
      }

      // Sort by start time, newest first
      runs.sort((a, b) => (b.startTime || 0) - (a.startTime || 0));
    } catch (err) {
      console.error('Failed to list runs:', err.message);
    }

    return runs;
  }

  /**
   * Delete a workflow run and its logs
   * @param {string} runId - Run ID to delete
   */
  deleteRun(runId) {
    const runDir = path.join(this.logDir, runId);
    if (!fs.existsSync(runDir)) {
      return;
    }

    try {
      // Delete all files in the run directory
      const files = fs.readdirSync(runDir);
      for (const file of files) {
        fs.unlinkSync(path.join(runDir, file));
      }

      // Delete the directory
      fs.rmdirSync(runDir);
    } catch (err) {
      console.error(`Failed to delete run ${runId}:`, err.message);
    }
  }

  /**
   * Ensure log directory exists
   */
  _ensureLogDir() {
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }

  /**
   * Ensure a directory exists
   */
  _ensureDir(dirPath) {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  }

  /**
   * Enforce per-workflow file limit
   */
  _enforceWorkflowFileLimit() {
    if (!this.currentRunDir) return;

    try {
      const files = fs.readdirSync(this.currentRunDir)
        .filter(f => f.startsWith('log-') && f.endsWith('.jsonl'))
        .sort();

      // Remove oldest files if over limit
      while (files.length > this.config.maxLogFilesPerWorkflow) {
        const oldest = files.shift();
        fs.unlinkSync(path.join(this.currentRunDir, oldest));
      }
    } catch (err) {
      // Ignore errors
    }
  }

  /**
   * Clean up old logs based on retention policy
   */
  async _cleanupOldLogs() {
    try {
      if (!fs.existsSync(this.logDir)) return;

      const now = Date.now();
      const maxAge = this.config.maxLogAgeDays * 24 * 60 * 60 * 1000;
      let totalSize = 0;

      // Get all run directories with their sizes and ages
      const runs = [];
      const dirs = fs.readdirSync(this.logDir)
        .filter(d => d.startsWith('run-'))
        .filter(d => fs.statSync(path.join(this.logDir, d)).isDirectory());

      for (const dir of dirs) {
        const runDir = path.join(this.logDir, dir);
        const stat = fs.statSync(runDir);
        const size = this._getDirSize(runDir);

        runs.push({
          runId: dir,
          path: runDir,
          mtime: stat.mtime.getTime(),
          size
        });
        totalSize += size;
      }

      // Sort by modification time, oldest first
      runs.sort((a, b) => a.mtime - b.mtime);

      // Remove runs older than max age
      for (const run of runs) {
        if (now - run.mtime > maxAge) {
          this.deleteRun(run.runId);
          totalSize -= run.size;
        }
      }

      // Remove oldest runs if over total storage limit
      while (totalSize > this.config.maxTotalStorageBytes && runs.length > 1) {
        const oldest = runs.shift();
        if (!oldest) break;
        this.deleteRun(oldest.runId);
        totalSize -= oldest.size;
      }
    } catch (err) {
      console.error('Failed to cleanup old logs:', err.message);
    }
  }

  /**
   * Get total size of a directory
   */
  _getDirSize(dirPath) {
    let size = 0;
    try {
      const files = fs.readdirSync(dirPath);
      for (const file of files) {
        const filePath = path.join(dirPath, file);
        const stat = fs.statSync(filePath);
        size += stat.size;
      }
    } catch {
      // Ignore errors
    }
    return size;
  }

  /**
   * Format duration in human-readable form
   */
  _formatDuration(ms) {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    if (ms < 3600000) {
      const mins = Math.floor(ms / 60000);
      const secs = Math.floor((ms % 60000) / 1000);
      return `${mins}m ${secs}s`;
    }
    const hours = Math.floor(ms / 3600000);
    const mins = Math.floor((ms % 3600000) / 60000);
    return `${hours}h ${mins}m`;
  }

  /**
   * Get current configuration
   */
  getConfig() {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
  }

  /**
   * Get logger statistics
   */
  getStats() {
    return {
      currentRunId: this.currentRunId,
      entriesWritten: this.entriesWritten,
      bufferSize: this.entryBuffer.length,
      currentLogFileIndex: this.currentLogFileIndex,
      logDir: this.logDir,
      config: this.config
    };
  }

  /**
   * Shutdown the logger gracefully
   */
  shutdown() {
    if (this.currentRunId) {
      this.endRun('shutdown');
    }
  }
}

// Singleton instance
let loggerInstance = null;

/**
 * Get or create the singleton logger instance
 */
export function getWorkflowLogger(options = {}) {
  if (!loggerInstance) {
    loggerInstance = new WorkflowLogger(options);
  }
  return loggerInstance;
}

/**
 * Reset the singleton (for testing)
 */
export function resetWorkflowLogger() {
  if (loggerInstance) {
    loggerInstance.shutdown();
    loggerInstance = null;
  }
}

export default WorkflowLogger;
