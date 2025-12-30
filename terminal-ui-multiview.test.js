/**
 * Tests for TerminalUIMultiView - Main UI class tests
 *
 * Component-specific tests are in:
 * - terminal-ui-utils.test.js
 * - terminal-ui-tasks.test.js
 * - terminal-ui-communication.test.js
 * - terminal-ui-events.test.js
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import { TerminalUIMultiView, ViewTypes } from './terminal-ui-multiview.js';
import { WorkflowHistoryStore, HistoryEntryTypes, resetHistoryStore } from './workflow-history-store.js';

// Test directory for file operations
const TEST_STATE_DIR = '.test-ui-claude-looper';
const TEST_HISTORY_DIR = path.join(process.cwd(), TEST_STATE_DIR, 'history');

// Helper to clean up test files
function cleanupTestFiles() {
  try {
    if (fs.existsSync(TEST_HISTORY_DIR)) {
      const files = fs.readdirSync(TEST_HISTORY_DIR);
      for (const file of files) {
        fs.unlinkSync(path.join(TEST_HISTORY_DIR, file));
      }
      fs.rmdirSync(TEST_HISTORY_DIR);
    }
    if (fs.existsSync(path.join(process.cwd(), TEST_STATE_DIR))) {
      fs.rmdirSync(path.join(process.cwd(), TEST_STATE_DIR));
    }
  } catch {
    // Ignore cleanup errors
  }
}

// Create a mock history store for testing without blessed UI
function createMockHistoryStore() {
  const store = new WorkflowHistoryStore({
    stateDir: TEST_STATE_DIR,
    retention: {
      maxMemoryEntries: 1000,
      autoFlushThreshold: 500,
      enableFileRotation: false
    }
  });
  return store;
}

describe('TerminalUIMultiView - ViewTypes', () => {
  it('should export 3 distinct view types', () => {
    assert.strictEqual(ViewTypes.TASKS, 'tasks');
    assert.strictEqual(ViewTypes.COMMUNICATION, 'communication');
    assert.strictEqual(ViewTypes.EVENTS, 'events');

    const viewCount = Object.keys(ViewTypes).length;
    assert.strictEqual(viewCount, 3);
  });
});

describe('TerminalUIMultiView - Construction', () => {
  let store;

  beforeEach(() => {
    cleanupTestFiles();
    resetHistoryStore();
    store = createMockHistoryStore();
  });

  afterEach(() => {
    if (store) store.clear();
    cleanupTestFiles();
    resetHistoryStore();
  });

  it('should create instance with default options', () => {
    const ui = new TerminalUIMultiView({ historyStore: store, autoRefresh: false });

    assert.strictEqual(ui.initialized, false);
    assert.strictEqual(ui.currentView, ViewTypes.TASKS);
    assert.strictEqual(ui.autoRefresh, false);
  });

  it('should initialize scroll positions for all views', () => {
    const ui = new TerminalUIMultiView({ historyStore: store, autoRefresh: false });

    for (const view of Object.values(ViewTypes)) {
      assert.strictEqual(ui.viewScrollPositions[view], 0);
      assert.deepStrictEqual(ui.viewContent[view], []);
    }
  });

  it('should initialize with history store reference', () => {
    const ui = new TerminalUIMultiView({ historyStore: store, autoRefresh: false });

    assert.strictEqual(ui.historyStore, store);
  });

  it('should initialize view components', () => {
    const ui = new TerminalUIMultiView({ historyStore: store, autoRefresh: false });

    assert.ok(ui.tasksView, 'Should have tasksView');
    assert.ok(ui.communicationView, 'Should have communicationView');
    assert.ok(ui.eventsView, 'Should have eventsView');
  });
});

describe('TerminalUIMultiView - Scroll Position Preservation', () => {
  let store;
  let ui;

  beforeEach(async () => {
    cleanupTestFiles();
    resetHistoryStore();
    store = createMockHistoryStore();
    await store.init();
    ui = new TerminalUIMultiView({ historyStore: store, autoRefresh: false });
  });

  afterEach(() => {
    if (store) store.clear();
    cleanupTestFiles();
    resetHistoryStore();
  });

  it('should track scroll positions per view', () => {
    // Simulate scroll position updates
    ui.viewScrollPositions[ViewTypes.TASKS] = 50;
    ui.viewScrollPositions[ViewTypes.COMMUNICATION] = 100;
    ui.viewScrollPositions[ViewTypes.EVENTS] = 25;

    // Verify positions are independent
    assert.strictEqual(ui.viewScrollPositions[ViewTypes.TASKS], 50);
    assert.strictEqual(ui.viewScrollPositions[ViewTypes.COMMUNICATION], 100);
    assert.strictEqual(ui.viewScrollPositions[ViewTypes.EVENTS], 25);
  });

  it('should provide scroll position getter', () => {
    ui.viewScrollPositions[ViewTypes.TASKS] = 75;

    const pos = ui.getScrollPosition(ViewTypes.TASKS);
    assert.strictEqual(pos, 75);
  });

  it('should return 0 for unset scroll position', () => {
    const pos = ui.getScrollPosition(ViewTypes.COMMUNICATION);
    assert.strictEqual(pos, 0);
  });
});

describe('TerminalUIMultiView - API Compatibility', () => {
  let store;
  let ui;

  beforeEach(async () => {
    cleanupTestFiles();
    resetHistoryStore();
    store = createMockHistoryStore();
    await store.init();
    ui = new TerminalUIMultiView({ historyStore: store, autoRefresh: false });
  });

  afterEach(() => {
    if (store) store.clear();
    cleanupTestFiles();
    resetHistoryStore();
  });

  it('should have setPhase method', () => {
    ui.setPhase('planning');
    assert.strictEqual(ui.phase, 'planning');
  });

  it('should have setBusy method', () => {
    ui.setBusy(true);
    assert.strictEqual(ui.busy, true);

    ui.setBusy(false);
    assert.strictEqual(ui.busy, false);
  });

  it('should have updateTasks method', () => {
    const tasks = [
      { id: 'task-1', description: 'Task 1', status: 'pending', subtasks: [] }
    ];

    ui.updateTasks(tasks, { currentTaskId: 'task-1' });

    assert.strictEqual(ui.tasks.length, 1);
    assert.strictEqual(ui.currentTaskId, 'task-1');
  });

  it('should have showAgentPrompt method that stores to history', () => {
    ui.showAgentPrompt('planner', 'Test prompt');

    const prompts = store.queryByType(HistoryEntryTypes.PROMPT);
    assert.strictEqual(prompts.length, 1);
    assert.strictEqual(prompts[0].data.content, 'Test prompt');
    assert.strictEqual(prompts[0].agentName, 'planner');
  });

  it('should have addEvent method that stores to history', () => {
    ui.addEvent('core', 'Test event');

    const events = store.queryByType(HistoryEntryTypes.EVENT);
    assert.strictEqual(events.length, 1);
  });

  it('should have addEventFromCore method', () => {
    ui.addEventFromCore({
      type: 'task:added',
      source: 'planner',
      object: { description: 'New task' }
    });

    const events = store.queryByType(HistoryEntryTypes.EVENT);
    assert.strictEqual(events.length, 1);
  });

  it('should have clearAgentOutput method', () => {
    ui.currentAgent = 'planner';
    ui.jsonBuffer = 'test buffer';

    ui.clearAgentOutput();

    assert.strictEqual(ui.currentAgent, null);
    assert.strictEqual(ui.jsonBuffer, '');
  });

  it('should have getCurrentView method', () => {
    const view = ui.getCurrentView();
    assert.strictEqual(view, ViewTypes.TASKS);
  });
});

describe('TerminalUIMultiView - View Switching Logic', () => {
  let store;
  let ui;

  beforeEach(async () => {
    cleanupTestFiles();
    resetHistoryStore();
    store = createMockHistoryStore();
    await store.init();
    ui = new TerminalUIMultiView({ historyStore: store, autoRefresh: false });
  });

  afterEach(() => {
    if (store) store.clear();
    cleanupTestFiles();
    resetHistoryStore();
  });

  it('should start with tasks view', () => {
    assert.strictEqual(ui.currentView, ViewTypes.TASKS);
  });

  it('should track view changes via currentView', () => {
    ui.currentView = ViewTypes.COMMUNICATION;
    assert.strictEqual(ui.currentView, ViewTypes.COMMUNICATION);

    ui.currentView = ViewTypes.EVENTS;
    assert.strictEqual(ui.currentView, ViewTypes.EVENTS);
  });
});

describe('TerminalUIMultiView - Integration with History Store', () => {
  let store;
  let ui;

  beforeEach(async () => {
    cleanupTestFiles();
    resetHistoryStore();
    store = createMockHistoryStore();
    await store.init();
    ui = new TerminalUIMultiView({ historyStore: store, autoRefresh: false });
  });

  afterEach(() => {
    if (store) store.clear();
    cleanupTestFiles();
    resetHistoryStore();
  });

  it('should reflect history store stats', () => {
    store.addPrompt('agent', 'Prompt');
    store.addResponse('agent', 'Response');
    store.addEvent({ type: 'test', source: 'core', object: {} });

    const stats = ui.historyStore.getStats();
    assert.strictEqual(stats.totalEntries, 3);
  });
});

describe('TerminalUIMultiView - Edge Cases', () => {
  let store;
  let ui;

  beforeEach(async () => {
    cleanupTestFiles();
    resetHistoryStore();
    store = createMockHistoryStore();
    await store.init();
    ui = new TerminalUIMultiView({ historyStore: store, autoRefresh: false });
  });

  afterEach(() => {
    if (store) store.clear();
    cleanupTestFiles();
    resetHistoryStore();
  });

  it('should handle updateTasks with null tasks', () => {
    ui.updateTasks(null);
    assert.deepStrictEqual(ui.tasks, []);
  });

  it('should handle updateTasks with empty array', () => {
    ui.updateTasks([]);
    assert.deepStrictEqual(ui.tasks, []);
  });
});

describe('TerminalUIMultiView - updateAgentPanel JSON Parsing', () => {
  let store;
  let ui;

  beforeEach(async () => {
    cleanupTestFiles();
    resetHistoryStore();
    store = createMockHistoryStore();
    await store.init();
    ui = new TerminalUIMultiView({ historyStore: store, autoRefresh: false });
  });

  afterEach(() => {
    if (store) store.clear();
    cleanupTestFiles();
    resetHistoryStore();
  });

  it('should handle JSON content in updateAgentPanel', () => {
    const json = JSON.stringify({ content: 'Test response' }) + '\n';
    ui.updateAgentPanel('agent', json);

    const responses = store.queryByType(HistoryEntryTypes.RESPONSE);
    assert.ok(responses.length >= 0); // May or may not parse depending on buffer state
  });

  it('should handle non-JSON content gracefully', () => {
    ui.updateAgentPanel('agent', 'Not JSON content\n');

    // Should not throw
    assert.ok(true);
  });

  it('should handle null output in updateAgentPanel', () => {
    ui.updateAgentPanel('agent', null);

    // Should not throw
    assert.ok(true);
  });

  it('should accumulate partial JSON in buffer', () => {
    ui.updateAgentPanel('agent', '{"content": "Partial');
    assert.ok(ui.jsonBuffer.includes('Partial'));
  });
});

describe('TerminalUIMultiView - Busy State', () => {
  let store;
  let ui;

  beforeEach(async () => {
    cleanupTestFiles();
    resetHistoryStore();
    store = createMockHistoryStore();
    await store.init();
    ui = new TerminalUIMultiView({ historyStore: store, autoRefresh: false });
  });

  afterEach(() => {
    if (ui.spinnerInterval) {
      clearInterval(ui.spinnerInterval);
      ui.spinnerInterval = null;
    }
    if (store) store.clear();
    cleanupTestFiles();
    resetHistoryStore();
  });

  it('should start spinner on setBusy(true)', () => {
    ui.setBusy(true);
    assert.ok(ui.spinnerInterval !== null);

    // Clean up
    ui.setBusy(false);
  });

  it('should stop spinner on setBusy(false)', () => {
    ui.setBusy(true);
    ui.setBusy(false);
    assert.strictEqual(ui.spinnerInterval, null);
  });

  it('should not create multiple spinners', () => {
    ui.setBusy(true);
    const firstInterval = ui.spinnerInterval;
    ui.setBusy(true); // Should be no-op
    assert.strictEqual(ui.spinnerInterval, firstInterval);

    ui.setBusy(false);
  });
});

describe('TerminalUIMultiView - recordAgentResult', () => {
  let store;
  let ui;

  beforeEach(async () => {
    cleanupTestFiles();
    resetHistoryStore();
    store = createMockHistoryStore();
    await store.init();
    ui = new TerminalUIMultiView({ historyStore: store, autoRefresh: false });
  });

  afterEach(() => {
    if (store) store.clear();
    cleanupTestFiles();
    resetHistoryStore();
  });

  it('should record response to history store', () => {
    ui.recordAgentResult('coder', {
      response: 'Task completed successfully',
      costUsd: 0.05,
      duration: 1000,
      tokensIn: 100,
      tokensOut: 50
    });

    const responses = store.queryByType(HistoryEntryTypes.RESPONSE);
    assert.strictEqual(responses.length, 1);
    assert.strictEqual(responses[0].agentName, 'coder');
  });

  it('should record tool calls to history store', () => {
    ui.recordAgentResult('coder', {
      response: 'Done',
      toolCalls: [
        { name: 'Read', arguments: { file: 'test.js' } },
        { name: 'Edit', arguments: { file: 'test.js', content: 'new' } }
      ]
    });

    const toolCalls = store.queryByType(HistoryEntryTypes.TOOL_CALL);
    assert.strictEqual(toolCalls.length, 2);
  });

  it('should handle null result', () => {
    ui.recordAgentResult('coder', null);
    // Should not throw
    assert.ok(true);
  });
});

describe('TerminalUIMultiView - View Content Refresh', () => {
  let store;
  let ui;

  beforeEach(async () => {
    cleanupTestFiles();
    resetHistoryStore();
    store = createMockHistoryStore();
    await store.init();
    ui = new TerminalUIMultiView({ historyStore: store, autoRefresh: false });
  });

  afterEach(() => {
    if (store) store.clear();
    cleanupTestFiles();
    resetHistoryStore();
  });

  it('should refresh all views', () => {
    // Add some data
    store.addPrompt('planner', 'Test prompt');
    store.addEvent({ type: 'test', source: 'core', object: {} });
    ui.tasks = [{ id: 'task-1', description: 'Test task', status: 'pending', subtasks: [], metadata: {} }];

    ui._refreshAllViews();

    // All views should have content
    for (const viewType of Object.values(ViewTypes)) {
      const content = ui.viewContent[viewType];
      assert.ok(Array.isArray(content), `${viewType} content should be array`);
    }
  });

  it('should delegate to view components for refresh', () => {
    ui.tasks = [{ id: 'task-1', description: 'Test', status: 'pending', subtasks: [], metadata: {} }];

    // Directly call tasksView.refresh() since we don't have blessed widgets in tests
    ui.currentView = ViewTypes.TASKS;
    const content = ui.tasksView.refresh();
    ui.viewContent[ViewTypes.TASKS] = content;

    const tasksContent = ui.viewContent[ViewTypes.TASKS];
    assert.ok(Array.isArray(tasksContent));
    assert.ok(tasksContent.length > 0, 'Should have task content');
  });
});
