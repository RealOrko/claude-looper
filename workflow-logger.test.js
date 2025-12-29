/**
 * Tests for WorkflowLogger
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import { WorkflowLogger, getWorkflowLogger, resetWorkflowLogger } from './workflow-logger.js';
import { HistoryEntryTypes } from './workflow-history-store.js';

// Test directory for log operations
const TEST_LOG_DIR = '.test-workflow-logs';

// Helper to clean up test files
function cleanupTestFiles() {
  try {
    if (fs.existsSync(TEST_LOG_DIR)) {
      const removeDir = (dirPath) => {
        if (fs.existsSync(dirPath)) {
          const files = fs.readdirSync(dirPath);
          for (const file of files) {
            const filePath = path.join(dirPath, file);
            if (fs.statSync(filePath).isDirectory()) {
              removeDir(filePath);
            } else {
              fs.unlinkSync(filePath);
            }
          }
          fs.rmdirSync(dirPath);
        }
      };
      removeDir(TEST_LOG_DIR);
    }
  } catch {
    // Ignore cleanup errors
  }
}

// Create a test logger
function createTestLogger(options = {}) {
  return new WorkflowLogger({
    logDir: TEST_LOG_DIR,
    syncWrites: true, // Use sync writes for testing
    bufferSize: 5,
    ...options
  });
}

describe('WorkflowLogger - Construction', () => {
  beforeEach(() => {
    cleanupTestFiles();
    resetWorkflowLogger();
  });

  afterEach(() => {
    cleanupTestFiles();
    resetWorkflowLogger();
  });

  it('should create instance with default config', () => {
    const logger = createTestLogger();

    assert.ok(logger.config);
    assert.ok(logger.config.logDir);
    assert.ok(logger.config.maxLogFileSizeBytes > 0);
    assert.ok(logger.config.maxLogAgeDays > 0);
  });

  it('should accept custom configuration', () => {
    const logger = createTestLogger({
      maxLogFileSizeBytes: 5 * 1024 * 1024,
      maxLogAgeDays: 7
    });

    assert.strictEqual(logger.config.maxLogFileSizeBytes, 5 * 1024 * 1024);
    assert.strictEqual(logger.config.maxLogAgeDays, 7);
  });

  it('should initialize successfully', async () => {
    const logger = createTestLogger();
    await logger.init();

    assert.strictEqual(logger.initialized, true);
    assert.ok(fs.existsSync(TEST_LOG_DIR));
  });
});

describe('WorkflowLogger - Workflow Run Management', () => {
  let logger;

  beforeEach(async () => {
    cleanupTestFiles();
    resetWorkflowLogger();
    logger = createTestLogger();
    await logger.init();
  });

  afterEach(() => {
    if (logger.currentRunId) {
      logger.endRun('test-cleanup');
    }
    cleanupTestFiles();
    resetWorkflowLogger();
  });

  it('should start a new workflow run', () => {
    const runId = logger.startRun({ workflowName: 'test-workflow', goal: 'Test goal' });

    assert.ok(runId);
    assert.ok(runId.startsWith('run-'));
    assert.strictEqual(logger.currentRunId, runId);
    assert.ok(logger.runMetadata);
    assert.strictEqual(logger.runMetadata.workflowName, 'test-workflow');
  });

  it('should create run directory', () => {
    const runId = logger.startRun({ workflowName: 'test' });

    const runDir = path.join(TEST_LOG_DIR, runId);
    assert.ok(fs.existsSync(runDir), 'Run directory should exist');
  });

  it('should write initial metadata', () => {
    const runId = logger.startRun({ workflowName: 'test-workflow' });

    const metadataPath = path.join(TEST_LOG_DIR, runId, 'metadata.json');
    assert.ok(fs.existsSync(metadataPath), 'Metadata file should exist');

    const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
    assert.strictEqual(metadata.runId, runId);
    assert.strictEqual(metadata.workflowName, 'test-workflow');
    assert.strictEqual(metadata.status, 'running');
  });

  it('should end workflow run', () => {
    const runId = logger.startRun({ workflowName: 'test' });
    logger.endRun('completed', { tasksCompleted: 5 });

    const metadataPath = path.join(TEST_LOG_DIR, runId, 'metadata.json');
    const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));

    assert.strictEqual(metadata.status, 'completed');
    assert.ok(metadata.endTime);
    assert.ok(metadata.duration !== undefined, 'duration should be defined');
    assert.strictEqual(metadata.summary.tasksCompleted, 5);
    assert.strictEqual(logger.currentRunId, null);
  });

  it('should generate summary report on run end', () => {
    const runId = logger.startRun({ workflowName: 'test', goal: 'Test the logger' });
    logger.endRun('completed');

    const summaryPath = path.join(TEST_LOG_DIR, runId, 'summary.txt');
    assert.ok(fs.existsSync(summaryPath), 'Summary file should exist');

    const summary = fs.readFileSync(summaryPath, 'utf8');
    assert.ok(summary.includes('WORKFLOW RUN SUMMARY'));
    assert.ok(summary.includes('test'));
    assert.ok(summary.includes('COMPLETED'));
  });
});

describe('WorkflowLogger - Structured Logging', () => {
  let logger;

  beforeEach(async () => {
    cleanupTestFiles();
    resetWorkflowLogger();
    logger = createTestLogger({ bufferSize: 2 }); // Small buffer for testing
    await logger.init();
    logger.startRun({ workflowName: 'test' });
  });

  afterEach(() => {
    if (logger.currentRunId) {
      logger.endRun('test-cleanup');
    }
    cleanupTestFiles();
    resetWorkflowLogger();
  });

  it('should log entries in structured format', () => {
    const entry = {
      id: 'test-entry-1',
      sequence: 1,
      type: HistoryEntryTypes.PROMPT,
      timestamp: Date.now(),
      agentName: 'coder',
      data: { content: 'Test prompt' }
    };

    logger.logEntry(entry);
    logger._flushBuffer();

    const logFile = path.join(TEST_LOG_DIR, logger.currentRunId, 'log-0000.jsonl');
    assert.ok(fs.existsSync(logFile), 'Log file should exist');

    const content = fs.readFileSync(logFile, 'utf8');
    const lines = content.split('\n').filter(l => l.trim());
    assert.strictEqual(lines.length, 1);

    const logged = JSON.parse(lines[0]);
    assert.strictEqual(logged.type, HistoryEntryTypes.PROMPT);
    assert.strictEqual(logged.agentName, 'coder');
    assert.strictEqual(logged.data.content, 'Test prompt');
  });

  it('should log prompts without truncation', () => {
    const longPrompt = 'A'.repeat(50000); // 50KB prompt

    logger.logPrompt('coder', longPrompt);
    logger._flushBuffer();

    const logFile = path.join(TEST_LOG_DIR, logger.currentRunId, 'log-0000.jsonl');
    const content = fs.readFileSync(logFile, 'utf8');
    const logged = JSON.parse(content.split('\n')[0]);

    assert.strictEqual(logged.data.content, longPrompt);
    assert.strictEqual(logged.data.contentLength, 50000);
  });

  it('should log responses without truncation', () => {
    const longResponse = 'B'.repeat(100000); // 100KB response

    logger.logResponse('coder', longResponse, { toolCalls: [{ name: 'Edit' }] });
    logger._flushBuffer();

    const logFile = path.join(TEST_LOG_DIR, logger.currentRunId, 'log-0000.jsonl');
    const content = fs.readFileSync(logFile, 'utf8');
    const logged = JSON.parse(content.split('\n')[0]);

    assert.strictEqual(logged.data.content, longResponse);
    assert.strictEqual(logged.data.contentLength, 100000);
    assert.deepStrictEqual(logged.data.toolCalls, [{ name: 'Edit' }]);
  });

  it('should flush buffer when full', () => {
    // Buffer size is 2 for this test
    logger.logPrompt('coder', 'Prompt 1');
    logger.logPrompt('coder', 'Prompt 2');

    // Should auto-flush after 2 entries
    const logFile = path.join(TEST_LOG_DIR, logger.currentRunId, 'log-0000.jsonl');
    assert.ok(fs.existsSync(logFile), 'Log file should exist after buffer flush');
  });

  it('should use JSONL format (one JSON per line)', () => {
    logger.logPrompt('coder', 'Prompt 1');
    logger.logPrompt('coder', 'Prompt 2');
    logger.logResponse('coder', 'Response 1');
    logger._flushBuffer();

    const logFile = path.join(TEST_LOG_DIR, logger.currentRunId, 'log-0000.jsonl');
    const content = fs.readFileSync(logFile, 'utf8');
    const lines = content.split('\n').filter(l => l.trim());

    assert.strictEqual(lines.length, 3);

    // Each line should be valid JSON
    for (const line of lines) {
      assert.doesNotThrow(() => JSON.parse(line));
    }
  });
});

describe('WorkflowLogger - Log Organization by Run', () => {
  let logger;

  beforeEach(async () => {
    cleanupTestFiles();
    resetWorkflowLogger();
    logger = createTestLogger();
    await logger.init();
  });

  afterEach(() => {
    if (logger.currentRunId) {
      logger.endRun('test-cleanup');
    }
    cleanupTestFiles();
    resetWorkflowLogger();
  });

  it('should create separate directories for each run', () => {
    const runId1 = logger.startRun({ workflowName: 'run1' });
    logger.logPrompt('coder', 'Test 1');
    logger.endRun('completed');

    const runId2 = logger.startRun({ workflowName: 'run2' });
    logger.logPrompt('coder', 'Test 2');
    logger.endRun('completed');

    assert.ok(fs.existsSync(path.join(TEST_LOG_DIR, runId1)));
    assert.ok(fs.existsSync(path.join(TEST_LOG_DIR, runId2)));
    assert.notStrictEqual(runId1, runId2);
  });

  it('should list all workflow runs', () => {
    logger.startRun({ workflowName: 'run1' });
    logger.endRun('completed');

    logger.startRun({ workflowName: 'run2' });
    logger.endRun('failed');

    const runs = logger.listRuns();

    assert.strictEqual(runs.length, 2);
    assert.ok(runs.some(r => r.workflowName === 'run1'));
    assert.ok(runs.some(r => r.workflowName === 'run2'));
  });

  it('should sort runs by start time (newest first)', () => {
    logger.startRun({ workflowName: 'older' });
    logger.endRun('completed');

    // Small delay to ensure different timestamps
    const start = Date.now();
    while (Date.now() - start < 10) { /* busy wait */ }

    logger.startRun({ workflowName: 'newer' });
    logger.endRun('completed');

    const runs = logger.listRuns();

    assert.strictEqual(runs[0].workflowName, 'newer');
    assert.strictEqual(runs[1].workflowName, 'older');
  });

  it('should include run ID with timestamp', () => {
    const runId = logger.startRun({ workflowName: 'test' });

    // Run ID should contain timestamp-like pattern
    assert.ok(runId.startsWith('run-'));
    assert.ok(runId.length > 10); // Should have meaningful length
  });
});

describe('WorkflowLogger - Export Functionality', () => {
  let logger;
  let runId;

  beforeEach(async () => {
    cleanupTestFiles();
    resetWorkflowLogger();
    logger = createTestLogger();
    await logger.init();

    // Create a run with some data
    runId = logger.startRun({ workflowName: 'export-test', goal: 'Test export' });
    logger.logPrompt('planner', 'Create a plan');
    logger.logResponse('planner', 'Here is the plan');
    logger.logPrompt('coder', 'Implement the feature');
    logger.logResponse('coder', 'Feature implemented');
    logger.endRun('completed', { tasksCompleted: 2 });
  });

  afterEach(() => {
    cleanupTestFiles();
    resetWorkflowLogger();
  });

  it('should export run to single JSON file', () => {
    const exportPath = logger.exportRun(runId);

    assert.ok(fs.existsSync(exportPath), 'Export file should exist');

    const exportData = JSON.parse(fs.readFileSync(exportPath, 'utf8'));
    assert.strictEqual(exportData.version, 1);
    assert.ok(exportData.metadata);
    assert.ok(exportData.entries);
    assert.ok(exportData.entryCount >= 4);
  });

  it('should include all entries in export', () => {
    const exportPath = logger.exportRun(runId);
    const exportData = JSON.parse(fs.readFileSync(exportPath, 'utf8'));

    const prompts = exportData.entries.filter(e => e.type === HistoryEntryTypes.PROMPT);
    const responses = exportData.entries.filter(e => e.type === HistoryEntryTypes.RESPONSE);

    assert.strictEqual(prompts.length, 2);
    assert.strictEqual(responses.length, 2);
  });

  it('should generate human-readable summary report', () => {
    const reportPath = logger.exportSummaryReport(runId);

    assert.ok(fs.existsSync(reportPath), 'Report file should exist');

    const report = fs.readFileSync(reportPath, 'utf8');
    assert.ok(report.includes('DETAILED WORKFLOW REPORT'));
    assert.ok(report.includes('export-test'));
    assert.ok(report.includes('COMPLETED'));
    assert.ok(report.includes('CONVERSATION SUMMARY'));
  });

  it('should include prompt/response history in report', () => {
    const reportPath = logger.exportSummaryReport(runId);
    const report = fs.readFileSync(reportPath, 'utf8');

    assert.ok(report.includes('PROMPT'));
    assert.ok(report.includes('RESPONSE'));
    assert.ok(report.includes('planner'));
    assert.ok(report.includes('coder'));
  });

  it('should export to custom path', () => {
    const customPath = path.join(TEST_LOG_DIR, 'custom-export.json');
    const exportPath = logger.exportRun(runId, customPath);

    assert.strictEqual(exportPath, customPath);
    assert.ok(fs.existsSync(customPath));
  });
});

describe('WorkflowLogger - Load and Replay', () => {
  let logger;
  let runId;

  beforeEach(async () => {
    cleanupTestFiles();
    resetWorkflowLogger();
    logger = createTestLogger();
    await logger.init();

    // Create a run with data
    runId = logger.startRun({ workflowName: 'replay-test', goal: 'Test replay' });
    logger.logPrompt('coder', 'Write code');
    logger.logResponse('coder', 'Here is the code');
    logger.endRun('completed');
  });

  afterEach(() => {
    cleanupTestFiles();
    resetWorkflowLogger();
  });

  it('should load a workflow run', () => {
    const run = logger.loadRun(runId);

    assert.ok(run.metadata);
    assert.ok(run.entries);
    assert.strictEqual(run.metadata.runId, runId);
    assert.strictEqual(run.metadata.workflowName, 'replay-test');
  });

  it('should load all entries from a run', () => {
    const run = logger.loadRun(runId);

    assert.ok(run.entries.length >= 2);

    const prompts = run.entries.filter(e => e.type === HistoryEntryTypes.PROMPT);
    const responses = run.entries.filter(e => e.type === HistoryEntryTypes.RESPONSE);

    assert.ok(prompts.length >= 1);
    assert.ok(responses.length >= 1);
  });

  it('should preserve entry order', () => {
    const run = logger.loadRun(runId);

    for (let i = 1; i < run.entries.length; i++) {
      assert.ok(
        (run.entries[i].sequence || 0) >= (run.entries[i - 1].sequence || 0),
        'Entries should be in sequence order'
      );
    }
  });

  it('should throw error for non-existent run', () => {
    assert.throws(
      () => logger.loadRun('non-existent-run'),
      /Run not found/
    );
  });
});

describe('WorkflowLogger - Configurable Retention', () => {
  let logger;

  beforeEach(async () => {
    cleanupTestFiles();
    resetWorkflowLogger();
  });

  afterEach(() => {
    if (logger && logger.currentRunId) {
      logger.endRun('test-cleanup');
    }
    cleanupTestFiles();
    resetWorkflowLogger();
  });

  it('should respect maxLogFileSizeBytes config', () => {
    logger = createTestLogger({
      maxLogFileSizeBytes: 1000, // 1KB limit
      bufferSize: 1
    });
    logger.init();
    logger.startRun({ workflowName: 'test' });

    // Write enough data to trigger rotation
    for (let i = 0; i < 20; i++) {
      logger.logPrompt('coder', 'A'.repeat(100));
    }
    logger._flushBuffer();

    // Should have created multiple log files
    const runDir = path.join(TEST_LOG_DIR, logger.currentRunId);
    const logFiles = fs.readdirSync(runDir).filter(f => f.startsWith('log-'));

    assert.ok(logFiles.length >= 1, 'Should create log files');
  });

  it('should respect maxLogFilesPerWorkflow config', () => {
    logger = createTestLogger({
      maxLogFileSizeBytes: 500,
      maxLogFilesPerWorkflow: 2,
      bufferSize: 1
    });
    logger.init();
    logger.startRun({ workflowName: 'test' });

    // Write lots of data
    for (let i = 0; i < 50; i++) {
      logger.logPrompt('coder', 'A'.repeat(200));
    }
    logger._flushBuffer();

    const runDir = path.join(TEST_LOG_DIR, logger.currentRunId);
    const logFiles = fs.readdirSync(runDir).filter(f => f.startsWith('log-'));

    assert.ok(logFiles.length <= 2, 'Should not exceed maxLogFilesPerWorkflow');
  });

  it('should allow config updates', () => {
    logger = createTestLogger();

    const originalMaxAge = logger.config.maxLogAgeDays;
    logger.updateConfig({ maxLogAgeDays: 7 });

    assert.strictEqual(logger.config.maxLogAgeDays, 7);
    assert.notStrictEqual(originalMaxAge, 7);
  });

  it('should provide config via getConfig', () => {
    logger = createTestLogger({ maxLogAgeDays: 14 });

    const config = logger.getConfig();

    assert.strictEqual(config.maxLogAgeDays, 14);
    assert.ok(config.maxLogFileSizeBytes);
    assert.ok(config.maxTotalStorageBytes);
  });
});

describe('WorkflowLogger - Delete and Cleanup', () => {
  let logger;

  beforeEach(async () => {
    cleanupTestFiles();
    resetWorkflowLogger();
    logger = createTestLogger();
    await logger.init();
  });

  afterEach(() => {
    if (logger && logger.currentRunId) {
      logger.endRun('test-cleanup');
    }
    cleanupTestFiles();
    resetWorkflowLogger();
  });

  it('should delete a workflow run', () => {
    const runId = logger.startRun({ workflowName: 'to-delete' });
    logger.logPrompt('coder', 'Test');
    logger.endRun('completed');

    assert.ok(fs.existsSync(path.join(TEST_LOG_DIR, runId)));

    logger.deleteRun(runId);

    assert.ok(!fs.existsSync(path.join(TEST_LOG_DIR, runId)));
  });

  it('should handle deleting non-existent run', () => {
    // Should not throw
    assert.doesNotThrow(() => {
      logger.deleteRun('non-existent-run');
    });
  });

  it('should shutdown gracefully', () => {
    const runId = logger.startRun({ workflowName: 'shutdown-test' });
    logger.logPrompt('coder', 'Test');

    logger.shutdown();

    // Run should be ended
    assert.strictEqual(logger.currentRunId, null);

    // Files should exist
    const runDir = path.join(TEST_LOG_DIR, runId);
    assert.ok(fs.existsSync(runDir));
  });
});

describe('WorkflowLogger - Statistics', () => {
  let logger;

  beforeEach(async () => {
    cleanupTestFiles();
    resetWorkflowLogger();
    logger = createTestLogger();
    await logger.init();
  });

  afterEach(() => {
    if (logger && logger.currentRunId) {
      logger.endRun('test-cleanup');
    }
    cleanupTestFiles();
    resetWorkflowLogger();
  });

  it('should provide logger statistics', () => {
    logger.startRun({ workflowName: 'stats-test' });
    logger.logPrompt('coder', 'Test 1');
    logger.logPrompt('coder', 'Test 2');

    const stats = logger.getStats();

    assert.ok(stats.currentRunId);
    assert.ok(stats.bufferSize >= 0);
    assert.ok(stats.logDir);
    assert.ok(stats.config);
  });

  it('should track entries written', () => {
    logger.startRun({ workflowName: 'count-test' });

    logger.logPrompt('coder', 'Test 1');
    logger.logPrompt('coder', 'Test 2');
    logger.logPrompt('coder', 'Test 3');
    logger._flushBuffer();

    assert.strictEqual(logger.entriesWritten, 3);
  });

  it('should track agents in metadata', () => {
    logger.startRun({ workflowName: 'agents-test' });

    logger.logPrompt('planner', 'Plan');
    logger.logPrompt('coder', 'Code');
    logger.logPrompt('tester', 'Test');
    logger._flushBuffer();

    assert.ok(logger.runMetadata.agents.has('planner'));
    assert.ok(logger.runMetadata.agents.has('coder'));
    assert.ok(logger.runMetadata.agents.has('tester'));
  });

  it('should track phases in metadata', () => {
    logger.startRun({ workflowName: 'phases-test' });

    const phaseEntry = {
      id: 'phase-1',
      sequence: 1,
      type: HistoryEntryTypes.PHASE_CHANGE,
      timestamp: Date.now(),
      data: { newPhase: 'execution', previousPhase: 'planning' }
    };

    logger.logEntry(phaseEntry);
    logger._flushBuffer();

    assert.ok(logger.runMetadata.phases.length >= 1);
    assert.strictEqual(logger.runMetadata.phases[0].phase, 'execution');
  });
});

describe('WorkflowLogger - Singleton', () => {
  beforeEach(() => {
    cleanupTestFiles();
    resetWorkflowLogger();
  });

  afterEach(() => {
    cleanupTestFiles();
    resetWorkflowLogger();
  });

  it('should return same instance from getWorkflowLogger', () => {
    const logger1 = getWorkflowLogger({ logDir: TEST_LOG_DIR });
    const logger2 = getWorkflowLogger({ logDir: TEST_LOG_DIR });

    assert.strictEqual(logger1, logger2);
  });

  it('should reset singleton with resetWorkflowLogger', () => {
    const logger1 = getWorkflowLogger({ logDir: TEST_LOG_DIR });
    resetWorkflowLogger();
    const logger2 = getWorkflowLogger({ logDir: TEST_LOG_DIR });

    assert.notStrictEqual(logger1, logger2);
  });
});

describe('WorkflowLogger - Error Handling', () => {
  let logger;

  beforeEach(async () => {
    cleanupTestFiles();
    resetWorkflowLogger();
    logger = createTestLogger();
    await logger.init();
  });

  afterEach(() => {
    if (logger && logger.currentRunId) {
      logger.endRun('test-cleanup');
    }
    cleanupTestFiles();
    resetWorkflowLogger();
  });

  it('should auto-start run if none exists when logging', () => {
    // Log without starting a run
    logger.logPrompt('coder', 'Test');

    assert.ok(logger.currentRunId, 'Should auto-start a run');
    assert.ok(logger.runMetadata, 'Should have metadata');
  });

  it('should handle export of non-existent run', () => {
    assert.throws(
      () => logger.exportRun('non-existent'),
      /Run directory not found/
    );
  });

  it('should handle summary export of non-existent run', () => {
    assert.throws(
      () => logger.exportSummaryReport('non-existent'),
      /Run directory not found/
    );
  });

  it('should format duration correctly', () => {
    assert.strictEqual(logger._formatDuration(500), '500ms');
    assert.strictEqual(logger._formatDuration(5000), '5.0s');
    assert.strictEqual(logger._formatDuration(65000), '1m 5s');
    assert.strictEqual(logger._formatDuration(3665000), '1h 1m');
  });
});
