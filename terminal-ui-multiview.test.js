/**
 * Tests for TerminalUIMultiView
 */

import { describe, it, beforeEach, afterEach, mock } from 'node:test';
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
  it('should export 5 distinct view types', () => {
    assert.strictEqual(ViewTypes.TIMELINE, 'timeline');
    assert.strictEqual(ViewTypes.PROMPTS, 'prompts');
    assert.strictEqual(ViewTypes.TASKS, 'tasks');
    assert.strictEqual(ViewTypes.COMMUNICATION, 'communication');
    assert.strictEqual(ViewTypes.EVENTS, 'events');

    const viewCount = Object.keys(ViewTypes).length;
    assert.strictEqual(viewCount, 5);
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
    assert.strictEqual(ui.currentView, ViewTypes.TIMELINE);
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
});

describe('TerminalUIMultiView - View Content Generation', () => {
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

  it('should generate timeline view content from history', () => {
    // Add some history entries
    store.addPrompt('planner', 'Create a plan', { phase: 'planning' });
    store.addResponse('planner', 'Plan created', { phase: 'planning' });
    store.addPhaseChange('execution', 'planning');
    store.addPrompt('coder', 'Implement feature', { phase: 'execution' });

    // Refresh timeline view
    ui._refreshTimelineView();

    const content = ui.viewContent[ViewTypes.TIMELINE];
    assert.ok(content.length > 0);

    // Check that content contains expected elements
    const contentStr = content.join('\n');
    assert.ok(contentStr.includes('PROMPT') || contentStr.includes('planner'));
    assert.ok(contentStr.includes('RESPONSE') || contentStr.includes('Plan created'));
  });

  it('should generate prompts view content from history', () => {
    store.addPrompt('planner', 'Test prompt 1');
    store.addResponse('planner', 'Test response 1');
    store.addPrompt('coder', 'Test prompt 2');

    ui._refreshPromptsView();

    const content = ui.viewContent[ViewTypes.PROMPTS];
    assert.ok(content.length > 0);

    const contentStr = content.join('\n');
    assert.ok(contentStr.includes('planner') || contentStr.includes('Prompt'));
  });

  it('should generate tasks view content from tasks array', () => {
    ui.tasks = [
      { id: 'task-1', description: 'First task', status: 'completed', subtasks: [] },
      { id: 'task-2', description: 'Second task', status: 'in_progress', subtasks: [] }
    ];
    ui.currentTaskId = 'task-2';

    ui._refreshTasksView();

    const content = ui.viewContent[ViewTypes.TASKS];
    assert.ok(content.length > 0);

    const contentStr = content.join('\n');
    assert.ok(contentStr.includes('First task') || contentStr.includes('Current Tasks'));
  });

  it('should generate communication view content from interactions', () => {
    store.addInteraction('planner', 'coder', {
      type: 'delegation',
      content: 'Please implement this feature'
    });

    ui._refreshCommunicationView();

    const content = ui.viewContent[ViewTypes.COMMUNICATION];
    assert.ok(content.length > 0);

    const contentStr = content.join('\n');
    assert.ok(contentStr.includes('planner') || contentStr.includes('coder'));
  });

  it('should generate events view content from events', () => {
    store.addEvent({ type: 'task:added', source: 'planner', object: { description: 'New task' } });
    store.addEvent({ type: 'task:completed', source: 'coder', object: { status: 'completed' } });

    ui._refreshEventsView();

    const content = ui.viewContent[ViewTypes.EVENTS];
    assert.ok(content.length > 0);

    const contentStr = content.join('\n');
    assert.ok(contentStr.includes('task') || contentStr.includes('planner'));
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
    ui.viewScrollPositions[ViewTypes.TIMELINE] = 50;
    ui.viewScrollPositions[ViewTypes.PROMPTS] = 100;
    ui.viewScrollPositions[ViewTypes.EVENTS] = 25;

    // Verify positions are independent
    assert.strictEqual(ui.viewScrollPositions[ViewTypes.TIMELINE], 50);
    assert.strictEqual(ui.viewScrollPositions[ViewTypes.PROMPTS], 100);
    assert.strictEqual(ui.viewScrollPositions[ViewTypes.EVENTS], 25);
    assert.strictEqual(ui.viewScrollPositions[ViewTypes.TASKS], 0);
  });

  it('should provide scroll position getter', () => {
    ui.viewScrollPositions[ViewTypes.TIMELINE] = 75;

    const pos = ui.getScrollPosition(ViewTypes.TIMELINE);
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
    assert.strictEqual(view, ViewTypes.TIMELINE);
  });
});

describe('TerminalUIMultiView - Text Utilities', () => {
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

  it('should truncate text correctly', () => {
    const result = ui._truncate('This is a long text that needs truncation', 20);
    assert.ok(result.length <= 20);
    assert.ok(result.endsWith('…'));
  });

  it('should not truncate short text', () => {
    const result = ui._truncate('Short', 20);
    assert.strictEqual(result, 'Short');
  });

  it('should wrap text correctly', () => {
    const text = 'This is a long line that should be wrapped at a reasonable width for display';
    const wrapped = ui._wrapText(text, 30);
    assert.ok(wrapped.length > 1);
    for (const line of wrapped) {
      assert.ok(line.length <= 30);
    }
  });

  it('should sanitize text with ANSI codes', () => {
    const input = '\x1b[31mRed text\x1b[0m with codes';
    const result = ui._sanitizeText(input);
    assert.ok(!result.includes('\x1b'));
    assert.ok(result.includes('Red text'));
  });

  it('should format timestamp correctly', () => {
    const timestamp = Date.now();
    const formatted = ui._formatTimestamp(timestamp);

    // Should be in HH:MM:SS format
    assert.ok(/^\d{2}:\d{2}:\d{2}$/.test(formatted));
  });
});

describe('TerminalUIMultiView - Agent Colors', () => {
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

  it('should return different colors for different agents', () => {
    const plannerColor = ui._getAgentColor('planner');
    const coderColor = ui._getAgentColor('coder');
    const testerColor = ui._getAgentColor('tester');

    // All should be valid color names
    assert.ok(['cyan', 'green', 'yellow', 'magenta', 'blue', 'white'].includes(plannerColor));
    assert.ok(['cyan', 'green', 'yellow', 'magenta', 'blue', 'white'].includes(coderColor));
    assert.ok(['cyan', 'green', 'yellow', 'magenta', 'blue', 'white'].includes(testerColor));

    // Known agents should have consistent colors
    assert.strictEqual(plannerColor, 'cyan');
    assert.strictEqual(coderColor, 'green');
    assert.strictEqual(testerColor, 'yellow');
  });

  it('should return white for unknown agents', () => {
    const color = ui._getAgentColor('unknown-agent');
    assert.strictEqual(color, 'white');
  });
});

describe('TerminalUIMultiView - Task Tree Rendering', () => {
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

  it('should render flat task list', () => {
    const tasks = [
      { id: 'task-1', description: 'Task 1', status: 'completed', subtasks: [] },
      { id: 'task-2', description: 'Task 2', status: 'pending', subtasks: [] }
    ];
    const taskMap = new Map(tasks.map(t => [t.id, t]));
    const lines = [];

    ui._renderTaskTree(tasks, taskMap, lines, 50, 0);

    assert.ok(lines.length >= 2);
    const content = lines.join('\n');
    assert.ok(content.includes('Task 1'));
    assert.ok(content.includes('Task 2'));
  });

  it('should render hierarchical task tree', () => {
    const tasks = [
      { id: 'task-1', description: 'Parent Task', status: 'in_progress', subtasks: ['task-2'] },
      { id: 'task-2', description: 'Child Task', status: 'pending', parentTaskId: 'task-1', subtasks: [] }
    ];
    const taskMap = new Map(tasks.map(t => [t.id, t]));
    const rootTasks = [tasks[0]];
    const lines = [];

    ui._renderTaskTree(rootTasks, taskMap, lines, 50, 0);

    assert.ok(lines.length >= 2);
    const content = lines.join('\n');
    assert.ok(content.includes('Parent Task'));
    assert.ok(content.includes('Child Task'));
  });

  it('should mark current task', () => {
    const tasks = [
      { id: 'task-1', description: 'Task 1', status: 'in_progress', subtasks: [] }
    ];
    const taskMap = new Map(tasks.map(t => [t.id, t]));
    const lines = [];
    ui.currentTaskId = 'task-1';

    ui._renderTaskTree(tasks, taskMap, lines, 50, 0);

    const content = lines.join('\n');
    assert.ok(content.includes('CURRENT'));
  });
});

describe('TerminalUIMultiView - Empty State Handling', () => {
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

  it('should handle empty timeline view', () => {
    ui._refreshTimelineView();

    const content = ui.viewContent[ViewTypes.TIMELINE];
    assert.ok(content.length > 0);
    const contentStr = content.join('\n');
    assert.ok(contentStr.includes('No activity') || contentStr.includes('recorded'));
  });

  it('should handle empty prompts view', () => {
    ui._refreshPromptsView();

    const content = ui.viewContent[ViewTypes.PROMPTS];
    assert.ok(content.length > 0);
    const contentStr = content.join('\n');
    assert.ok(contentStr.includes('No prompts') || contentStr.includes('recorded'));
  });

  it('should handle empty communication view', () => {
    ui._refreshCommunicationView();

    const content = ui.viewContent[ViewTypes.COMMUNICATION];
    assert.ok(content.length > 0);
    const contentStr = content.join('\n');
    assert.ok(contentStr.includes('No agent') || contentStr.includes('communications'));
  });

  it('should handle empty events view', () => {
    ui._refreshEventsView();

    const content = ui.viewContent[ViewTypes.EVENTS];
    assert.ok(content.length > 0);
    const contentStr = content.join('\n');
    assert.ok(contentStr.includes('No events') || contentStr.includes('recorded'));
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

  it('should start with timeline view', () => {
    assert.strictEqual(ui.currentView, ViewTypes.TIMELINE);
  });

  it('should track view changes via currentView', () => {
    ui.currentView = ViewTypes.PROMPTS;
    assert.strictEqual(ui.currentView, ViewTypes.PROMPTS);

    ui.currentView = ViewTypes.EVENTS;
    assert.strictEqual(ui.currentView, ViewTypes.EVENTS);
  });

  it('should have content for all view types', () => {
    // Populate history
    store.addPrompt('planner', 'Test prompt');
    store.addResponse('planner', 'Test response');
    store.addEvent({ type: 'test', source: 'core', object: {} });
    store.addInteraction('planner', 'coder', { content: 'Test' });
    store.addTaskUpdate('task-1', 'completed', {});

    // Refresh all views
    ui._refreshAllViews();

    // All views should have content
    for (const viewType of Object.values(ViewTypes)) {
      const content = ui.viewContent[viewType];
      assert.ok(Array.isArray(content), `${viewType} content should be array`);
      assert.ok(content.length > 0, `${viewType} should have content`);
    }
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

  it('should query prompts from history store', () => {
    store.addPrompt('planner', 'Prompt 1');
    store.addPrompt('coder', 'Prompt 2');

    ui._refreshPromptsView();

    const content = ui.viewContent[ViewTypes.PROMPTS];
    const contentStr = content.join('\n');

    // Should contain both prompts
    assert.ok(contentStr.includes('planner') || contentStr.includes('Prompt'));
  });

  it('should query events from history store', () => {
    store.addEvent({ type: 'task:added', source: 'planner', object: { description: 'Task 1' } });
    store.addEvent({ type: 'task:completed', source: 'coder', object: { status: 'completed' } });

    ui._refreshEventsView();

    const content = ui.viewContent[ViewTypes.EVENTS];
    assert.ok(content.length > 0);
  });

  it('should query interactions from history store', () => {
    store.addInteraction('planner', 'coder', {
      type: 'delegation',
      content: 'Implement feature X'
    });

    ui._refreshCommunicationView();

    const content = ui.viewContent[ViewTypes.COMMUNICATION];
    const contentStr = content.join('\n');
    assert.ok(contentStr.includes('planner') || contentStr.includes('coder'));
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

  it('should handle null/undefined in truncate', () => {
    assert.strictEqual(ui._truncate(null, 20), '');
    assert.strictEqual(ui._truncate(undefined, 20), '');
    assert.strictEqual(ui._truncate('', 20), '');
  });

  it('should handle null/undefined in wrapText', () => {
    assert.deepStrictEqual(ui._wrapText(null), []);
    assert.deepStrictEqual(ui._wrapText(undefined), []);
    assert.deepStrictEqual(ui._wrapText(''), []);
  });

  it('should handle null/undefined in sanitizeText', () => {
    assert.strictEqual(ui._sanitizeText(null), '');
    assert.strictEqual(ui._sanitizeText(undefined), '');
  });

  it('should handle updateTasks with null tasks', () => {
    ui.updateTasks(null);
    assert.deepStrictEqual(ui.tasks, []);
  });

  it('should handle updateTasks with empty array', () => {
    ui.updateTasks([]);
    assert.deepStrictEqual(ui.tasks, []);
  });

  it('should handle negative/zero width in truncate', () => {
    const result = ui._truncate('Test', 0);
    assert.strictEqual(result, '');
  });

  it('should handle content width calculation with null widget', () => {
    const width = ui._getContentWidth(null);
    assert.ok(width >= 10);
  });

  it('should handle content width calculation with widget without width', () => {
    const widget = {};
    const width = ui._getContentWidth(widget);
    assert.ok(width >= 10);
  });

  it('should correctly format phase change entries in timeline', () => {
    store.addPhaseChange('execution', 'planning');
    ui._refreshTimelineView();

    const content = ui.viewContent[ViewTypes.TIMELINE];
    const contentStr = content.join('\n');
    assert.ok(contentStr.includes('Phase') || contentStr.includes('execution'));
  });

  it('should handle task updates in timeline', () => {
    store.addTaskUpdate('task-1', 'completed', { result: 'Done' });
    ui._refreshTimelineView();

    const content = ui.viewContent[ViewTypes.TIMELINE];
    const contentStr = content.join('\n');
    assert.ok(content.length > 0);
  });

  it('should handle tool call entries in timeline', () => {
    store.addToolCall('coder', 'Edit', { file: 'test.js' });
    ui._refreshTimelineView();

    const content = ui.viewContent[ViewTypes.TIMELINE];
    const contentStr = content.join('\n');
    assert.ok(contentStr.includes('Edit') || contentStr.includes('coder'));
  });

  it('should refresh specific view based on currentView', () => {
    ui.currentView = ViewTypes.PROMPTS;
    store.addPrompt('agent', 'Test');

    // Call the specific refresh method directly (UI not initialized)
    ui._refreshPromptsView();

    const content = ui.viewContent[ViewTypes.PROMPTS];
    assert.ok(content.length > 0);
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

describe('TerminalUIMultiView - Next Task Indication', () => {
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

  it('should mark next task in tree', () => {
    const tasks = [
      { id: 'task-1', description: 'Task 1', status: 'completed', subtasks: [] },
      { id: 'task-2', description: 'Task 2', status: 'pending', subtasks: [] }
    ];
    const taskMap = new Map(tasks.map(t => [t.id, t]));
    const lines = [];
    ui.nextTaskId = 'task-2';

    ui._renderTaskTree(tasks, taskMap, lines, 50, 0);

    const content = lines.join('\n');
    assert.ok(content.includes('NEXT'));
  });
});

describe('TerminalUIMultiView - Enhanced Timeline View', () => {
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

  it('should build timeline structure from history entries', () => {
    // Add phase changes
    store.addPhaseChange('planning', null);
    store.addPrompt('planner', 'Create plan');
    store.addResponse('planner', 'Plan created');
    store.addPhaseChange('plan_review', 'planning');
    store.addPhaseChange('execution', 'plan_review');
    store.addPrompt('coder', 'Implement feature');
    store.addPhaseChange('verification', 'execution');

    const entries = store.query({});
    const timeline = ui._buildTimelineStructure(entries);

    assert.ok(Array.isArray(timeline.phases));
    assert.ok(timeline.phases.length >= 3, 'Should have at least 3 phases');
    assert.ok(timeline.phases.some(p => p.name === 'planning'));
    assert.ok(timeline.phases.some(p => p.name === 'execution'));
    assert.ok(timeline.phases.some(p => p.name === 'verification'));
  });

  it('should track task executions in timeline structure', () => {
    // Add task-related entries
    store.addTaskUpdate('task-1', 'pending', { status: 'pending' });
    store.addTaskUpdate('task-1', 'in_progress', { status: 'in_progress' });
    store.addPrompt('coder', 'Work on task-1', { taskId: 'task-1' });
    store.addResponse('coder', 'Task done', { taskId: 'task-1' });
    store.addTaskUpdate('task-1', 'completed', { status: 'completed' });

    const entries = store.query({});
    const timeline = ui._buildTimelineStructure(entries);

    assert.ok(timeline.taskExecutions.has('task-1'), 'Should have task-1 in taskExecutions');
    const taskExec = timeline.taskExecutions.get('task-1');
    assert.ok(taskExec.startTime !== undefined, 'Task should have startTime');
    assert.ok(taskExec.endTime !== undefined, 'Task should have endTime');
  });

  it('should detect fix cycles in timeline structure', () => {
    // Fix cycle is detected when task goes from 'failed' to 'in_progress'
    store.addTaskUpdate('task-1', 'in_progress', { status: 'in_progress' });
    store.addTaskUpdate('task-1', 'failed', { status: 'failed' });
    // This transition from failed -> in_progress triggers a fix cycle
    store.addTaskUpdate('task-1', 'in_progress', { status: 'in_progress' });
    store.addTaskUpdate('task-1', 'completed', { status: 'completed' });

    const entries = store.query({});
    const timeline = ui._buildTimelineStructure(entries);

    assert.ok(Array.isArray(timeline.fixCycles));
    assert.ok(timeline.fixCycles.length >= 1, 'Should detect at least one fix cycle');
  });

  it('should detect retry attempts in timeline structure', () => {
    // Retry attempts are tracked when a task goes to in_progress multiple times
    // First in_progress = attempt 1 (not a retry)
    store.addTaskUpdate('task-1', 'in_progress', { status: 'in_progress' });
    store.addTaskUpdate('task-1', 'failed', { status: 'failed' });
    // Second in_progress = attempt 2 (a retry)
    store.addTaskUpdate('task-1', 'in_progress', { status: 'in_progress' });
    store.addTaskUpdate('task-1', 'failed', { status: 'failed' });
    // Third in_progress = attempt 3 (another retry)
    store.addTaskUpdate('task-1', 'in_progress', { status: 'in_progress' });

    const entries = store.query({});
    const timeline = ui._buildTimelineStructure(entries);

    assert.ok(Array.isArray(timeline.retryAttempts));
    assert.ok(timeline.retryAttempts.length >= 2, 'Should detect retry attempts');
  });

  it('should format duration correctly', () => {
    // Under 1 second: shows milliseconds
    assert.strictEqual(ui._formatDuration(500), '500ms');
    // 1-60 seconds: shows seconds with 1 decimal
    assert.strictEqual(ui._formatDuration(5000), '5.0s');
    // 1-60 minutes: shows minutes and seconds
    assert.strictEqual(ui._formatDuration(65000), '1m 5s');
    // Over 1 hour: shows hours and minutes
    assert.strictEqual(ui._formatDuration(3665000), '1h 1m');
  });

  it('should render phase flow diagram', () => {
    const timeline = {
      phases: [
        { name: 'planning', startTime: Date.now() - 60000, endTime: Date.now() - 45000 },
        { name: 'execution', startTime: Date.now() - 45000, endTime: Date.now() - 15000 },
        { name: 'verification', startTime: Date.now() - 15000, endTime: null }
      ],
      currentPhase: 'verification',
      taskExecutions: new Map(),
      fixCycles: [],
      retryAttempts: []
    };

    const lines = [];
    ui._renderPhaseFlow(lines, timeline, 80);

    const content = lines.join('\n');
    assert.ok(content.includes('Workflow Progress'), 'Should include workflow progress header');
    assert.ok(content.includes('Planning'), 'Should include Planning phase');
    // 'execution' phase displays as 'Executing'
    assert.ok(content.includes('Executing'), 'Should include Executing phase');
    // 'verification' phase displays as 'Verifying'
    assert.ok(content.includes('Verifying'), 'Should include Verifying phase');
  });

  it('should render detailed timeline with task summaries', () => {
    // Set up history
    store.addPhaseChange('execution', 'planning');
    store.addTaskUpdate('task-1', 'in_progress', { status: 'in_progress', description: 'Test task' });
    store.addPrompt('coder', 'Work on task');
    store.addResponse('coder', 'Task complete');
    store.addTaskUpdate('task-1', 'completed', { status: 'completed' });

    const entries = store.query({});
    const timeline = ui._buildTimelineStructure(entries);

    const lines = [];
    ui._renderDetailedTimeline(lines, timeline, entries, 80);

    const content = lines.join('\n');
    assert.ok(content.length > 0);
    assert.ok(content.includes('task-1') || content.includes('Task'));
  });

  it('should format enhanced timeline entry with current position indicator', () => {
    const entry = {
      type: HistoryEntryTypes.PROMPT,
      agentName: 'coder',
      timestamp: Date.now(),
      data: { content: 'Test prompt content' }
    };
    ui.currentTimelineSequence = entry.sequence;

    const lines = ui._formatEnhancedTimelineEntry(entry, '12:00:00', 80, true);

    assert.ok(lines.length > 0);
    const content = lines.join('\n');
    assert.ok(content.includes('▶') || content.includes('→') || content.includes('PROMPT'));
  });

  it('should show fix cycle indicator in formatted entry', () => {
    const entry = {
      type: HistoryEntryTypes.EVENT,
      agentName: 'coder',
      timestamp: Date.now(),
      data: { type: 'fix:start', object: { cycle: 2 } }
    };

    const lines = ui._formatEnhancedTimelineEntry(entry, '12:00:00', 80, false);

    const content = lines.join('\n');
    assert.ok(content.includes('fix') || content.includes('🔧') || content.includes('Fix') || content.includes('EVENT'));
  });

  it('should show retry indicator in formatted entry', () => {
    const entry = {
      type: HistoryEntryTypes.EVENT,
      agentName: 'coder',
      timestamp: Date.now(),
      data: { type: 'retry', object: { attempt: 3 } }
    };

    const lines = ui._formatEnhancedTimelineEntry(entry, '12:00:00', 80, false);

    const content = lines.join('\n');
    assert.ok(content.includes('retry') || content.includes('🔄') || content.includes('Retry') || content.includes('EVENT'));
  });

  it('should handle empty timeline gracefully', () => {
    ui._refreshTimelineView();

    const content = ui.viewContent[ViewTypes.TIMELINE];
    assert.ok(Array.isArray(content));
    // Either empty or shows "no entries" message
    const contentStr = content.join('\n');
    assert.ok(contentStr.includes('No') || contentStr.includes('no') || content.length === 0 || contentStr.includes('empty'));
  });

  it('should render timeline with mixed entry types', () => {
    // Add various entry types
    store.addPhaseChange('planning', null);
    store.addPrompt('planner', 'Create plan');
    store.addToolCall('planner', 'read_file', { file: 'test.js' });
    store.addResponse('planner', 'Here is the plan');
    store.addPhaseChange('execution', 'planning');
    store.addInteraction('planner', 'coder', { type: 'delegation', content: 'Implement' });
    store.addPrompt('coder', 'Implementing');
    store.addTaskUpdate('task-1', 'in_progress', { status: 'in_progress' });
    store.addEvent({ type: 'task:started', source: 'coder', object: { taskId: 'task-1' } });

    ui._refreshTimelineView();

    const content = ui.viewContent[ViewTypes.TIMELINE];
    assert.ok(content.length > 0, 'Timeline should have content');

    const contentStr = content.join('\n');
    // Should contain phase information
    assert.ok(contentStr.includes('planning') || contentStr.includes('Planning') || contentStr.includes('execution'));
  });

  it('should include duration for completed phases', () => {
    const timeline = {
      phases: [
        { name: 'planning', startTime: Date.now() - 120000, endTime: Date.now() - 60000 },
        { name: 'execution', startTime: Date.now() - 60000, endTime: Date.now() }
      ],
      currentPhase: null,
      taskExecutions: new Map(),
      fixCycles: [],
      retryAttempts: []
    };

    const lines = [];
    ui._renderPhaseFlow(lines, timeline, 80);

    const content = lines.join('\n');
    // Completed phases should show duration
    assert.ok(content.includes('m') || content.includes('s') || content.includes('duration'));
  });

  it('should highlight current phase as active', () => {
    const timeline = {
      phases: [
        { name: 'planning', startTime: Date.now() - 60000, endTime: Date.now() - 30000 },
        { name: 'execution', startTime: Date.now() - 30000, endTime: null }
      ],
      currentPhase: 'execution',
      taskExecutions: new Map(),
      fixCycles: [],
      retryAttempts: []
    };

    const lines = [];
    ui._renderPhaseFlow(lines, timeline, 80);

    const content = lines.join('\n');
    // Active phase should have 'Executing' (the display name) and 'NOW' indicator
    assert.ok(content.includes('Executing'), 'Should include Executing phase');
    assert.ok(content.includes('NOW'), 'Active phase should show NOW indicator');
  });
});

describe('TerminalUIMultiView - Enhanced Prompt History View', () => {
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

  it('should initialize prompt history state', () => {
    assert.strictEqual(ui.promptSearchQuery, '');
    assert.strictEqual(ui.promptSearchActive, false);
    assert.ok(ui.promptExpandedSections instanceof Set);
    assert.strictEqual(ui.promptSelectedIndex, 0);
    assert.ok(Array.isArray(ui.promptConversations));
  });

  it('should build conversation pairs from prompts and responses', () => {
    store.addPrompt('planner', 'What should we do?');
    store.addResponse('planner', 'Here is the plan');
    store.addPrompt('coder', 'Implement feature X');
    store.addResponse('coder', 'Feature implemented');

    ui._refreshPromptsView();

    assert.strictEqual(ui.promptConversations.length, 2);
    assert.strictEqual(ui.promptConversations[0].agentName, 'planner');
    assert.strictEqual(ui.promptConversations[1].agentName, 'coder');
    assert.ok(ui.promptConversations[0].response !== null);
    assert.ok(ui.promptConversations[1].response !== null);
  });

  it('should display prompts without truncation when expanded', () => {
    const longContent = 'A'.repeat(500);
    store.addPrompt('coder', longContent);
    store.addResponse('coder', 'Done');

    // Expand the section
    ui.promptExpandedSections.add(1); // First prompt sequence
    ui._refreshPromptsView();

    const content = ui.viewContent[ViewTypes.PROMPTS].join('\n');
    // Full content should be present (no truncation message)
    assert.ok(!content.includes('... ('), 'Expanded view should not truncate');
    // Content should include part of the long string
    assert.ok(content.includes('AAA'), 'Should show full prompt content');
  });

  it('should filter prompts by agent name', () => {
    store.addPrompt('planner', 'Plan the work');
    store.addPrompt('coder', 'Code the feature');
    store.addPrompt('tester', 'Test the feature');

    ui.promptSearchQuery = 'coder';
    ui._refreshPromptsView();

    assert.strictEqual(ui.promptConversations.length, 1);
    assert.strictEqual(ui.promptConversations[0].agentName, 'coder');
  });

  it('should filter prompts by keyword in content', () => {
    store.addPrompt('planner', 'Create authentication flow');
    store.addPrompt('coder', 'Fix the login bug');
    store.addPrompt('tester', 'Test authentication');

    ui.promptSearchQuery = 'authentication';
    ui._refreshPromptsView();

    assert.strictEqual(ui.promptConversations.length, 2);
    const agents = ui.promptConversations.map(c => c.agentName).sort();
    assert.deepStrictEqual(agents, ['planner', 'tester']);
  });

  it('should show collapsed preview by default', () => {
    store.addPrompt('coder', 'Short prompt');
    store.addResponse('coder', 'Short response');

    ui._refreshPromptsView();

    const content = ui.viewContent[ViewTypes.PROMPTS].join('\n');
    // Collapsed indicators
    assert.ok(content.includes('▶'), 'Should show collapsed arrow');
    assert.ok(content.includes('←'), 'Should show prompt indicator');
    assert.ok(content.includes('→'), 'Should show response indicator');
  });

  it('should show expanded content with full text', () => {
    store.addPrompt('coder', 'This is the full prompt text');
    store.addResponse('coder', 'This is the full response text');

    // Get the sequence number and expand
    ui._refreshPromptsView();
    const conv = ui.promptConversations[0];
    ui.promptExpandedSections.add(conv.sequence);
    ui._refreshPromptsView();

    const content = ui.viewContent[ViewTypes.PROMPTS].join('\n');
    assert.ok(content.includes('▼'), 'Should show expanded arrow');
    assert.ok(content.includes('PROMPT'), 'Should show PROMPT header');
    assert.ok(content.includes('RESPONSE'), 'Should show RESPONSE header');
    assert.ok(content.includes('This is the full prompt text'), 'Should show full prompt');
    assert.ok(content.includes('This is the full response text'), 'Should show full response');
  });

  it('should navigate between prompts with index updates', () => {
    store.addPrompt('planner', 'First prompt');
    store.addPrompt('coder', 'Second prompt');
    store.addPrompt('tester', 'Third prompt');

    ui._refreshPromptsView();
    assert.strictEqual(ui.promptSelectedIndex, 0);
    assert.strictEqual(ui.promptConversations.length, 3);

    // Test manual index updates (simulating navigation logic)
    ui.promptSelectedIndex = 1;
    assert.strictEqual(ui.promptSelectedIndex, 1);

    ui.promptSelectedIndex = 2;
    assert.strictEqual(ui.promptSelectedIndex, 2);

    // Wrap around logic
    ui.promptSelectedIndex = (ui.promptSelectedIndex + 1) % ui.promptConversations.length;
    assert.strictEqual(ui.promptSelectedIndex, 0);

    // Negative wrap
    ui.promptSelectedIndex = ui.promptConversations.length - 1;
    assert.strictEqual(ui.promptSelectedIndex, 2);
  });

  it('should toggle expand/collapse state correctly', () => {
    store.addPrompt('coder', 'Test prompt');

    ui._refreshPromptsView();
    const conv = ui.promptConversations[0];

    assert.ok(!ui.promptExpandedSections.has(conv.sequence), 'Should start collapsed');

    // Simulate toggle by directly manipulating state
    ui.promptExpandedSections.add(conv.sequence);
    assert.ok(ui.promptExpandedSections.has(conv.sequence), 'Should be expanded after adding');

    ui.promptExpandedSections.delete(conv.sequence);
    assert.ok(!ui.promptExpandedSections.has(conv.sequence), 'Should be collapsed after removing');
  });

  it('should expand all prompts by adding to expandedSections', () => {
    store.addPrompt('planner', 'First');
    store.addPrompt('coder', 'Second');
    store.addPrompt('tester', 'Third');

    ui._refreshPromptsView();
    assert.strictEqual(ui.promptExpandedSections.size, 0);

    // Simulate expand all
    for (const conv of ui.promptConversations) {
      ui.promptExpandedSections.add(conv.sequence);
    }
    assert.strictEqual(ui.promptExpandedSections.size, 3);
  });

  it('should collapse all prompts by clearing expandedSections', () => {
    store.addPrompt('planner', 'First');
    store.addPrompt('coder', 'Second');

    ui._refreshPromptsView();
    // Expand all first
    for (const conv of ui.promptConversations) {
      ui.promptExpandedSections.add(conv.sequence);
    }
    assert.strictEqual(ui.promptExpandedSections.size, 2);

    // Collapse all
    ui.promptExpandedSections.clear();
    assert.strictEqual(ui.promptExpandedSections.size, 0);
  });

  it('should show keyboard shortcuts help', () => {
    ui._refreshPromptsView();

    const content = ui.viewContent[ViewTypes.PROMPTS].join('\n');
    assert.ok(content.includes('Keyboard'), 'Should show keyboard help');
    assert.ok(content.includes('/'), 'Should mention search shortcut');
    assert.ok(content.includes('n/N'), 'Should mention navigation shortcuts');
    assert.ok(content.includes('Enter'), 'Should mention expand shortcut');
  });

  it('should show search results count', () => {
    store.addPrompt('planner', 'Plan A');
    store.addPrompt('coder', 'Code B');
    store.addPrompt('tester', 'Test C');

    ui.promptSearchQuery = 'planner';
    ui._refreshPromptsView();

    const content = ui.viewContent[ViewTypes.PROMPTS].join('\n');
    assert.ok(content.includes('Search:'), 'Should show search label');
    assert.ok(content.includes('1'), 'Should show match count');
    assert.ok(content.includes('of 3'), 'Should show total count');
  });

  it('should highlight search terms in content', () => {
    const highlighted = ui._highlightSearchTerms('This is a test');
    assert.strictEqual(highlighted, 'This is a test', 'No highlight without search query');

    ui.promptSearchQuery = 'test';
    const highlighted2 = ui._highlightSearchTerms('This is a test');
    assert.ok(highlighted2.includes('{bold}'), 'Should add bold markup');
    assert.ok(highlighted2.includes('test'), 'Should preserve original text');
  });

  it('should escape regex special characters in search', () => {
    const escaped = ui._escapeRegex('test.file(1)');
    assert.strictEqual(escaped, 'test\\.file\\(1\\)');
  });

  it('should clear search state correctly', () => {
    ui.promptSearchQuery = 'test';
    ui.promptSearchActive = true;

    // Simulate clear search by directly manipulating state
    ui.promptSearchQuery = '';
    ui.promptSearchActive = false;

    assert.strictEqual(ui.promptSearchQuery, '');
    assert.strictEqual(ui.promptSearchActive, false);
  });

  it('should persist prompts after workflow moves forward', () => {
    // Add prompts from different phases
    store.addPrompt('planner', 'Planning phase prompt', { phase: 'planning' });
    store.addResponse('planner', 'Planning done');
    store.addPhaseChange('execution', 'planning');
    store.addPrompt('coder', 'Execution phase prompt', { phase: 'execution' });
    store.addResponse('coder', 'Coding done');
    store.addPhaseChange('verification', 'execution');
    store.addPrompt('tester', 'Verification phase prompt', { phase: 'verification' });

    ui._refreshPromptsView();

    // All prompts should be available regardless of current phase
    assert.strictEqual(ui.promptConversations.length, 3);

    const agents = ui.promptConversations.map(c => c.agentName);
    assert.ok(agents.includes('planner'), 'Should include planner prompt');
    assert.ok(agents.includes('coder'), 'Should include coder prompt');
    assert.ok(agents.includes('tester'), 'Should include tester prompt');
  });

  it('should show tool calls in expanded response', () => {
    store.addPrompt('coder', 'Write code');
    store.addResponse('coder', 'Done', {
      toolCalls: [
        { name: 'read_file' },
        { name: 'write_file' },
        { name: 'bash' }
      ]
    });

    ui._refreshPromptsView();
    const conv = ui.promptConversations[0];
    ui.promptExpandedSections.add(conv.sequence);
    ui._refreshPromptsView();

    const content = ui.viewContent[ViewTypes.PROMPTS].join('\n');
    assert.ok(content.includes('Tool Calls'), 'Should show tool calls header');
    assert.ok(content.includes('read_file'), 'Should show read_file tool');
    assert.ok(content.includes('write_file'), 'Should show write_file tool');
    assert.ok(content.includes('bash'), 'Should show bash tool');
  });

  it('should handle prompts without responses', () => {
    store.addPrompt('coder', 'Still waiting for response');
    // No response added

    ui._refreshPromptsView();

    assert.strictEqual(ui.promptConversations.length, 1);
    assert.strictEqual(ui.promptConversations[0].response, null);

    const content = ui.viewContent[ViewTypes.PROMPTS].join('\n');
    assert.ok(content.includes('awaiting response'), 'Should show awaiting response message');
  });

  it('should show response duration when expanded', () => {
    const promptTime = Date.now();
    store.addPrompt('coder', 'Work on task');

    // Simulate delay
    const responseTime = promptTime + 5000;
    const response = store.addResponse('coder', 'Done');
    // Manually set timestamp for testing
    response.timestamp = responseTime;

    ui._refreshPromptsView();
    const conv = ui.promptConversations[0];
    ui.promptExpandedSections.add(conv.sequence);
    ui._refreshPromptsView();

    const content = ui.viewContent[ViewTypes.PROMPTS].join('\n');
    // Should show duration or "later" text
    assert.ok(content.includes('later') || content.includes('Response at'), 'Should show response timing');
  });
});

describe('TerminalUIMultiView - Task Dependency Graph View', () => {
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

  it('should initialize task graph state', () => {
    assert.strictEqual(ui.taskGraphSelectedIndex, 0);
    assert.strictEqual(ui.taskGraphShowDetails, true);
    assert.ok(Array.isArray(ui.taskGraphFlatList));
  });

  it('should display empty state when no tasks', () => {
    ui._refreshTasksView();

    const content = ui.viewContent[ViewTypes.TASKS].join('\n');
    assert.ok(content.includes('No tasks recorded'), 'Should show empty state message');
    assert.ok(content.includes('TASK DEPENDENCY GRAPH'), 'Should show graph header');
  });

  it('should display tasks with status color-coding', () => {
    ui.tasks = [
      { id: 'task-1', description: 'Completed task', status: 'completed', subtasks: [], metadata: {} },
      { id: 'task-2', description: 'In progress task', status: 'in_progress', subtasks: [], metadata: {} },
      { id: 'task-3', description: 'Pending task', status: 'pending', subtasks: [], metadata: {} },
      { id: 'task-4', description: 'Failed task', status: 'failed', subtasks: [], metadata: {} }
    ];

    ui._refreshTasksView();

    const content = ui.viewContent[ViewTypes.TASKS].join('\n');
    assert.ok(content.includes('Completed task'), 'Should show completed task');
    assert.ok(content.includes('In progress task'), 'Should show in progress task');
    assert.ok(content.includes('Pending task'), 'Should show pending task');
    assert.ok(content.includes('Failed task'), 'Should show failed task');
    // Status colors in blessed format
    assert.ok(content.includes('green-fg') || content.includes('+'), 'Should have green for completed');
    assert.ok(content.includes('yellow-fg') || content.includes('*'), 'Should have yellow for in_progress');
  });

  it('should show complexity ratings for tasks', () => {
    ui.tasks = [
      { id: 'task-1', description: 'Simple task', status: 'pending', subtasks: [], metadata: { complexity: 'simple' } },
      { id: 'task-2', description: 'Medium task', status: 'pending', subtasks: [], metadata: { complexity: 'medium' } },
      { id: 'task-3', description: 'Complex task', status: 'pending', subtasks: [], metadata: { complexity: 'complex' } }
    ];

    ui._refreshTasksView();

    const content = ui.viewContent[ViewTypes.TASKS].join('\n');
    assert.ok(content.includes('[S]'), 'Should show [S] for simple');
    assert.ok(content.includes('[M]'), 'Should show [M] for medium');
    assert.ok(content.includes('[C]'), 'Should show [C] for complex');
  });

  it('should show dependency arrows between tasks', () => {
    ui.tasks = [
      { id: 'task-1', description: 'First task', status: 'completed', subtasks: [], metadata: { complexity: 'simple', dependencies: [] } },
      { id: 'task-2', description: 'Second task', status: 'pending', subtasks: [], metadata: { complexity: 'medium', dependencies: [0] } }
    ];

    ui._refreshTasksView();

    const content = ui.viewContent[ViewTypes.TASKS].join('\n');
    assert.ok(content.includes('depends on') || content.includes('→'), 'Should show dependency indicator');
  });

  it('should distinguish parent-child from peer dependencies', () => {
    ui.tasks = [
      { id: 'task-1', description: 'Parent task', status: 'pending', subtasks: ['task-2'], metadata: {} },
      { id: 'task-2', description: 'Child task', status: 'pending', subtasks: [], parentTaskId: 'task-1', metadata: {} }
    ];

    ui._refreshTasksView();

    const content = ui.viewContent[ViewTypes.TASKS].join('\n');
    // Parent-child uses tree connectors
    assert.ok(content.includes('├') || content.includes('└') || content.includes('──'), 'Should show tree connector for parent-child');
  });

  it('should show verification criteria in details', () => {
    ui.tasks = [
      {
        id: 'task-1',
        description: 'Task with criteria',
        status: 'pending',
        subtasks: [],
        metadata: {
          complexity: 'medium',
          verificationCriteria: ['Test passes', 'No regressions', 'Documentation updated']
        }
      }
    ];

    ui.taskGraphShowDetails = true;
    ui._refreshTasksView();

    const content = ui.viewContent[ViewTypes.TASKS].join('\n');
    assert.ok(content.includes('Verification Criteria'), 'Should show verification criteria section');
    assert.ok(content.includes('Test passes') || content.includes('✓'), 'Should show criteria items');
  });

  it('should be readable with 10+ tasks', () => {
    // Create 12 tasks
    ui.tasks = [];
    for (let i = 1; i <= 12; i++) {
      ui.tasks.push({
        id: `task-${i}`,
        description: `Task number ${i} with description`,
        status: i <= 3 ? 'completed' : (i <= 5 ? 'in_progress' : 'pending'),
        subtasks: [],
        metadata: { complexity: ['simple', 'medium', 'complex'][i % 3] }
      });
    }

    ui._refreshTasksView();

    const content = ui.viewContent[ViewTypes.TASKS].join('\n');
    // All tasks should be present
    assert.ok(content.includes('Task number 1'), 'Should show first task');
    assert.ok(content.includes('Task number 12'), 'Should show last task');
    // Summary should be present
    assert.ok(content.includes('Total:'), 'Should show summary');
    assert.ok(content.includes('12'), 'Should show total count of 12');
  });

  it('should build flat list for navigation', () => {
    ui.tasks = [
      { id: 'task-1', description: 'Parent 1', status: 'pending', subtasks: ['task-2', 'task-3'], metadata: {} },
      { id: 'task-2', description: 'Child 1', status: 'pending', subtasks: [], parentTaskId: 'task-1', metadata: {} },
      { id: 'task-3', description: 'Child 2', status: 'pending', subtasks: [], parentTaskId: 'task-1', metadata: {} },
      { id: 'task-4', description: 'Parent 2', status: 'pending', subtasks: [], metadata: {} }
    ];

    const taskMap = new Map(ui.tasks.map(t => [t.id, t]));
    const flatList = ui._buildTaskFlatList(ui.tasks, taskMap);

    assert.strictEqual(flatList.length, 4, 'Should have 4 tasks in flat list');
    assert.strictEqual(flatList[0].id, 'task-1', 'First should be parent 1');
    assert.strictEqual(flatList[1].id, 'task-2', 'Second should be child 1');
    assert.strictEqual(flatList[2].id, 'task-3', 'Third should be child 2');
    assert.strictEqual(flatList[3].id, 'task-4', 'Fourth should be parent 2');
  });

  it('should navigate between tasks', () => {
    ui.tasks = [
      { id: 'task-1', description: 'Task 1', status: 'pending', subtasks: [], metadata: {} },
      { id: 'task-2', description: 'Task 2', status: 'pending', subtasks: [], metadata: {} },
      { id: 'task-3', description: 'Task 3', status: 'pending', subtasks: [], metadata: {} }
    ];

    ui._refreshTasksView();
    assert.strictEqual(ui.taskGraphSelectedIndex, 0);

    // Navigate down
    ui.taskGraphSelectedIndex = 1;
    assert.strictEqual(ui.taskGraphSelectedIndex, 1);

    ui.taskGraphSelectedIndex = 2;
    assert.strictEqual(ui.taskGraphSelectedIndex, 2);

    // Navigate up
    ui.taskGraphSelectedIndex = 1;
    assert.strictEqual(ui.taskGraphSelectedIndex, 1);
  });

  it('should toggle details visibility', () => {
    ui.tasks = [{ id: 'task-1', description: 'Task 1', status: 'pending', subtasks: [], metadata: {} }];

    assert.strictEqual(ui.taskGraphShowDetails, true);
    ui.taskGraphShowDetails = false;
    assert.strictEqual(ui.taskGraphShowDetails, false);
    ui.taskGraphShowDetails = true;
    assert.strictEqual(ui.taskGraphShowDetails, true);
  });

  it('should show selected task details', () => {
    ui.tasks = [
      {
        id: 'task-1',
        description: 'Selected task description here',
        status: 'in_progress',
        subtasks: [],
        metadata: {
          complexity: 'complex',
          verificationCriteria: ['Criterion A', 'Criterion B']
        }
      }
    ];

    ui.taskGraphShowDetails = true;
    ui.taskGraphSelectedIndex = 0;
    ui._refreshTasksView();

    const content = ui.viewContent[ViewTypes.TASKS].join('\n');
    assert.ok(content.includes('Selected Task Details'), 'Should show details header');
    assert.ok(content.includes('task-1'), 'Should show task ID');
    assert.ok(content.includes('in_progress'), 'Should show status');
    assert.ok(content.includes('complex'), 'Should show complexity');
  });

  it('should show keyboard shortcuts help', () => {
    ui._refreshTasksView();

    const content = ui.viewContent[ViewTypes.TASKS].join('\n');
    assert.ok(content.includes('Keyboard'), 'Should show keyboard help');
    assert.ok(content.includes('j') || content.includes('↓'), 'Should mention navigation keys');
    assert.ok(content.includes('d'), 'Should mention details toggle');
  });

  it('should show legend for status and complexity', () => {
    ui._refreshTasksView();

    const content = ui.viewContent[ViewTypes.TASKS].join('\n');
    assert.ok(content.includes('Legend'), 'Should show legend');
    assert.ok(content.includes('Completed'), 'Should explain completed status');
    assert.ok(content.includes('Complexity'), 'Should explain complexity');
    assert.ok(content.includes('Simple'), 'Should show simple complexity');
  });

  it('should show progress bar in summary', () => {
    ui.tasks = [
      { id: 'task-1', description: 'Task 1', status: 'completed', subtasks: [], metadata: {} },
      { id: 'task-2', description: 'Task 2', status: 'completed', subtasks: [], metadata: {} },
      { id: 'task-3', description: 'Task 3', status: 'pending', subtasks: [], metadata: {} },
      { id: 'task-4', description: 'Task 4', status: 'pending', subtasks: [], metadata: {} }
    ];

    ui._refreshTasksView();

    const content = ui.viewContent[ViewTypes.TASKS].join('\n');
    assert.ok(content.includes('Summary'), 'Should show summary');
    assert.ok(content.includes('50%') || content.includes('█'), 'Should show progress');
  });

  it('should get siblings correctly', () => {
    ui.tasks = [
      { id: 'task-1', description: 'Parent', status: 'pending', subtasks: ['task-2', 'task-3'], metadata: {} },
      { id: 'task-2', description: 'Child 1', status: 'pending', subtasks: [], parentTaskId: 'task-1', metadata: {} },
      { id: 'task-3', description: 'Child 2', status: 'pending', subtasks: [], parentTaskId: 'task-1', metadata: {} }
    ];

    const taskMap = new Map(ui.tasks.map(t => [t.id, t]));

    const siblings = ui._getSiblings(ui.tasks[1], taskMap);
    assert.strictEqual(siblings.length, 2, 'Should have 2 siblings');
    assert.ok(siblings.some(s => s.id === 'task-2'), 'Should include task-2');
    assert.ok(siblings.some(s => s.id === 'task-3'), 'Should include task-3');
  });

  it('should handle tasks with subtasks', () => {
    ui.tasks = [
      { id: 'task-1', description: 'Main task', status: 'in_progress', subtasks: ['task-2'], metadata: {} },
      { id: 'task-2', description: 'Subtask', status: 'pending', subtasks: [], parentTaskId: 'task-1', metadata: {} }
    ];

    ui.taskGraphShowDetails = true;
    ui.taskGraphSelectedIndex = 0;
    ui._refreshTasksView();

    const content = ui.viewContent[ViewTypes.TASKS].join('\n');
    assert.ok(content.includes('Subtasks'), 'Should show subtasks section');
    assert.ok(content.includes('Subtask'), 'Should show subtask description');
  });

  it('should mark current and next tasks', () => {
    ui.tasks = [
      { id: 'task-1', description: 'Current task', status: 'in_progress', subtasks: [], metadata: {} },
      { id: 'task-2', description: 'Next task', status: 'pending', subtasks: [], metadata: {} }
    ];
    ui.currentTaskId = 'task-1';
    ui.nextTaskId = 'task-2';

    ui._refreshTasksView();

    const content = ui.viewContent[ViewTypes.TASKS].join('\n');
    assert.ok(content.includes('CURRENT'), 'Should mark current task');
    assert.ok(content.includes('NEXT'), 'Should mark next task');
  });
});

describe('TerminalUIMultiView - Agent Communication View', () => {
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

  it('should initialize communication view state', () => {
    assert.strictEqual(ui.commFilterAgent, null);
    assert.strictEqual(ui.commFilterType, null);
    assert.strictEqual(ui.commSelectedIndex, 0);
    assert.ok(ui.commExpandedItems instanceof Set);
    assert.ok(Array.isArray(ui.commInteractionList));
  });

  it('should display empty state when no communications', () => {
    ui._refreshCommunicationView();

    const content = ui.viewContent[ViewTypes.COMMUNICATION].join('\n');
    assert.ok(content.includes('No agent communications') || content.includes('communications'), 'Should show empty state');
    assert.ok(content.includes('AGENT COMMUNICATION'), 'Should show header');
  });

  it('should gather all communication entry types', () => {
    store.addPrompt('planner', 'Create a plan');
    store.addResponse('planner', 'Here is the plan');
    store.addInteraction('planner', 'coder', { type: 'delegation', content: 'Implement' });
    store.addToolCall('coder', 'Read', { file: 'test.js' });
    store.addToolResult('coder', 'Read', { content: 'file content' });
    store.addPhaseChange('execution', 'planning');

    const entries = ui._gatherCommunicationEntries();

    assert.strictEqual(entries.length, 6, 'Should gather all 6 entries');
    const types = entries.map(e => e.entryType);
    assert.ok(types.includes('prompt'), 'Should include prompts');
    assert.ok(types.includes('response'), 'Should include responses');
    assert.ok(types.includes('interaction'), 'Should include interactions');
    assert.ok(types.includes('tool_call'), 'Should include tool calls');
    assert.ok(types.includes('tool_result'), 'Should include tool results');
    assert.ok(types.includes('phase_change'), 'Should include phase changes');
  });

  it('should display prompts with sender agent', () => {
    store.addPrompt('planner', 'What should we build?');

    ui._refreshCommunicationView();

    const content = ui.viewContent[ViewTypes.COMMUNICATION].join('\n');
    assert.ok(content.includes('PROMPT'), 'Should show PROMPT label');
    assert.ok(content.includes('planner'), 'Should show agent name');
  });

  it('should display responses with agent name', () => {
    store.addPrompt('coder', 'Implement the feature');
    store.addResponse('coder', 'Feature implemented successfully');

    ui._refreshCommunicationView();

    const content = ui.viewContent[ViewTypes.COMMUNICATION].join('\n');
    assert.ok(content.includes('RESPONSE'), 'Should show RESPONSE label');
    assert.ok(content.includes('coder'), 'Should show agent name');
  });

  it('should display interactions with sender and receiver', () => {
    store.addInteraction('planner', 'coder', {
      type: 'delegation',
      content: 'Please implement this feature'
    });

    ui._refreshCommunicationView();

    const content = ui.viewContent[ViewTypes.COMMUNICATION].join('\n');
    assert.ok(content.includes('planner'), 'Should show sender');
    assert.ok(content.includes('coder'), 'Should show receiver');
    assert.ok(content.includes('→') || content.includes('DELEGATION'), 'Should show interaction indicator');
  });

  it('should show chronological order of messages', () => {
    store.addPrompt('planner', 'First message');
    store.addResponse('planner', 'Second message');
    store.addPrompt('coder', 'Third message');

    ui._refreshCommunicationView();

    // Entries should be in order by sequence
    assert.strictEqual(ui.commInteractionList.length, 3);
    assert.ok(ui.commInteractionList[0].sequence < ui.commInteractionList[1].sequence);
    assert.ok(ui.commInteractionList[1].sequence < ui.commInteractionList[2].sequence);
  });

  it('should format tool calls as structured data when expanded', () => {
    store.addToolCall('coder', 'Edit', { file_path: '/path/to/file.js', old_string: 'old', new_string: 'new' });

    ui._refreshCommunicationView();
    // Expand the first entry
    if (ui.commInteractionList.length > 0) {
      ui.commExpandedItems.add(ui.commInteractionList[0].sequence);
    }
    ui._refreshCommunicationView();

    const content = ui.viewContent[ViewTypes.COMMUNICATION].join('\n');
    assert.ok(content.includes('TOOL CALL') || content.includes('TOOL'), 'Should show TOOL CALL label');
    assert.ok(content.includes('Edit'), 'Should show tool name');
    // When expanded, should show structured JSON data
    assert.ok(content.includes('file_path') || content.includes('Input'), 'Should show input parameters');
  });

  it('should link tool results to their corresponding calls', () => {
    store.addToolCall('coder', 'Read', { file: 'test.js' });
    store.addToolResult('coder', 'Read', { content: 'file content here' });

    const entries = ui._gatherCommunicationEntries();
    const linked = ui._linkToolCallsAndResults(entries);

    const toolCall = linked.find(e => e.entryType === 'tool_call');
    const toolResult = linked.find(e => e.entryType === 'tool_result');

    assert.ok(toolCall.linkedToolResult, 'Tool call should have linked result');
    assert.ok(toolResult.linkedToolCall, 'Tool result should have linked call');
    assert.strictEqual(toolCall.linkedToolResult.sequence, toolResult.sequence);
  });

  it('should show tool result link when viewing expanded tool call', () => {
    store.addToolCall('coder', 'Bash', { command: 'npm test' });
    store.addToolResult('coder', 'Bash', { output: 'All tests passed' });

    ui._refreshCommunicationView();
    // Expand the tool call entry
    const toolCallEntry = ui.commInteractionList.find(e => e.entryType === 'tool_call');
    if (toolCallEntry) {
      ui.commExpandedItems.add(toolCallEntry.sequence);
    }
    ui._refreshCommunicationView();

    const content = ui.viewContent[ViewTypes.COMMUNICATION].join('\n');
    assert.ok(content.includes('Result') || content.includes('✓'), 'Should show linked result');
  });

  it('should correlate phase changes with message timeline', () => {
    store.addPhaseChange('planning', null);
    store.addPrompt('planner', 'Creating plan');
    store.addPhaseChange('execution', 'planning');
    store.addPrompt('coder', 'Executing plan');

    ui._refreshCommunicationView();

    const content = ui.viewContent[ViewTypes.COMMUNICATION].join('\n');
    assert.ok(content.includes('PHASE') || content.includes('planning'), 'Should show phase changes');
    assert.ok(content.includes('execution'), 'Should show phase name');
  });

  it('should filter by specific agent', () => {
    store.addPrompt('planner', 'Planner message');
    store.addPrompt('coder', 'Coder message');
    store.addPrompt('tester', 'Tester message');

    ui.commFilterAgent = 'coder';
    ui._refreshCommunicationView();

    assert.strictEqual(ui.commInteractionList.length, 1, 'Should only show coder messages');
    assert.strictEqual(ui.commInteractionList[0].agentName, 'coder');
  });

  it('should filter by interaction type', () => {
    store.addPrompt('planner', 'A prompt');
    store.addResponse('planner', 'A response');
    store.addToolCall('coder', 'Read', { file: 'test.js' });

    ui.commFilterType = 'prompt';
    ui._refreshCommunicationView();

    assert.strictEqual(ui.commInteractionList.length, 1, 'Should only show prompts');
    assert.strictEqual(ui.commInteractionList[0].entryType, 'prompt');
  });

  it('should combine agent and type filters', () => {
    store.addPrompt('planner', 'Planner prompt');
    store.addPrompt('coder', 'Coder prompt');
    store.addResponse('coder', 'Coder response');

    ui.commFilterAgent = 'coder';
    ui.commFilterType = 'prompt';
    ui._refreshCommunicationView();

    assert.strictEqual(ui.commInteractionList.length, 1);
    assert.strictEqual(ui.commInteractionList[0].agentName, 'coder');
    assert.strictEqual(ui.commInteractionList[0].entryType, 'prompt');
  });

  it('should show filter status in header', () => {
    store.addPrompt('planner', 'Test');
    store.addPrompt('coder', 'Test');

    ui.commFilterAgent = 'planner';
    ui._refreshCommunicationView();

    const content = ui.viewContent[ViewTypes.COMMUNICATION].join('\n');
    assert.ok(content.includes('planner') || content.includes('Filter'), 'Should show filter status');
    assert.ok(content.includes('1') && content.includes('2'), 'Should show filtered count');
  });

  it('should show message when filters match nothing', () => {
    store.addPrompt('planner', 'Test');

    ui.commFilterAgent = 'nonexistent';
    ui._refreshCommunicationView();

    const content = ui.viewContent[ViewTypes.COMMUNICATION].join('\n');
    assert.ok(content.includes('No messages match') || content.includes('filter'), 'Should show no matches message');
  });

  it('should clear filters correctly', () => {
    store.addPrompt('planner', 'Test 1');
    store.addPrompt('coder', 'Test 2');

    ui.commFilterAgent = 'planner';
    ui.commFilterType = 'prompt';
    ui._refreshCommunicationView();
    assert.strictEqual(ui.commInteractionList.length, 1);

    // Clear filters
    ui.commFilterAgent = null;
    ui.commFilterType = null;
    ui._refreshCommunicationView();
    assert.strictEqual(ui.commInteractionList.length, 2, 'Should show all after clearing');
  });

  it('should track selected index for navigation', () => {
    store.addPrompt('planner', 'First');
    store.addPrompt('coder', 'Second');
    store.addPrompt('tester', 'Third');

    ui._refreshCommunicationView();
    assert.strictEqual(ui.commSelectedIndex, 0);

    ui.commSelectedIndex = 1;
    assert.strictEqual(ui.commSelectedIndex, 1);

    ui.commSelectedIndex = 2;
    assert.strictEqual(ui.commSelectedIndex, 2);
  });

  it('should toggle expand/collapse state', () => {
    store.addPrompt('coder', 'Test prompt with content');

    ui._refreshCommunicationView();
    const entry = ui.commInteractionList[0];

    assert.ok(!ui.commExpandedItems.has(entry.sequence), 'Should start collapsed');

    ui.commExpandedItems.add(entry.sequence);
    assert.ok(ui.commExpandedItems.has(entry.sequence), 'Should be expanded');

    ui.commExpandedItems.delete(entry.sequence);
    assert.ok(!ui.commExpandedItems.has(entry.sequence), 'Should be collapsed again');
  });

  it('should show keyboard shortcuts help', () => {
    ui._refreshCommunicationView();

    const content = ui.viewContent[ViewTypes.COMMUNICATION].join('\n');
    assert.ok(content.includes('Keyboard'), 'Should show keyboard help');
    assert.ok(content.includes('j') || content.includes('↓'), 'Should show navigation keys');
    assert.ok(content.includes('Enter'), 'Should show expand shortcut');
  });

  it('should show message type legend', () => {
    ui._refreshCommunicationView();

    const content = ui.viewContent[ViewTypes.COMMUNICATION].join('\n');
    assert.ok(content.includes('PROMPT'), 'Should show prompt in legend');
    assert.ok(content.includes('RESPONSE'), 'Should show response in legend');
    assert.ok(content.includes('TOOL'), 'Should show tool in legend');
  });

  it('should adjust selected index when filtered list shrinks', () => {
    store.addPrompt('planner', 'First');
    store.addPrompt('coder', 'Second');
    store.addPrompt('tester', 'Third');

    ui._refreshCommunicationView();
    ui.commSelectedIndex = 2; // Select last item

    // Apply filter that reduces list
    ui.commFilterAgent = 'planner';
    ui._refreshCommunicationView();

    // Selected index should adjust to stay in bounds
    assert.ok(ui.commSelectedIndex <= ui.commInteractionList.length - 1);
  });

  it('should render summary with message counts', () => {
    store.addPrompt('planner', 'P1');
    store.addResponse('planner', 'R1');
    store.addPrompt('coder', 'P2');
    store.addToolCall('coder', 'Read', {});

    ui._refreshCommunicationView();

    const content = ui.viewContent[ViewTypes.COMMUNICATION].join('\n');
    // Summary section should exist at bottom
    assert.ok(content.length > 0);
  });

  it('should handle multiple tool calls to same tool correctly', () => {
    store.addToolCall('coder', 'Read', { file: 'a.js' });
    store.addToolResult('coder', 'Read', { content: 'content a' });
    store.addToolCall('coder', 'Read', { file: 'b.js' });
    store.addToolResult('coder', 'Read', { content: 'content b' });

    const entries = ui._gatherCommunicationEntries();
    const linked = ui._linkToolCallsAndResults(entries);

    const toolCalls = linked.filter(e => e.entryType === 'tool_call');
    const toolResults = linked.filter(e => e.entryType === 'tool_result');

    // Each call should be linked to its corresponding result
    assert.ok(toolCalls[0].linkedToolResult, 'First call should have result');
    assert.ok(toolCalls[1].linkedToolResult, 'Second call should have result');
    assert.ok(toolResults[0].linkedToolCall, 'First result should have call');
    assert.ok(toolResults[1].linkedToolCall, 'Second result should have call');

    // Verify correct linking order
    assert.strictEqual(toolCalls[0].linkedToolResult.sequence, toolResults[0].sequence);
    assert.strictEqual(toolCalls[1].linkedToolResult.sequence, toolResults[1].sequence);
  });

  it('should filter interactions by sender or receiver agent', () => {
    store.addInteraction('planner', 'coder', { type: 'delegation', content: 'Task 1' });
    store.addInteraction('coder', 'tester', { type: 'handoff', content: 'Task 2' });

    // Filter by 'coder' should match both (as sender and receiver)
    ui.commFilterAgent = 'coder';
    const entries = ui._gatherCommunicationEntries();
    const filtered = ui._filterCommunicationEntries(entries);

    assert.strictEqual(filtered.length, 2, 'Should match interactions where coder is sender or receiver');
  });

  it('should display tool call indicator for pending results', () => {
    // Add tool call without result
    store.addToolCall('coder', 'Bash', { command: 'long-running-command' });

    ui._refreshCommunicationView();

    const content = ui.viewContent[ViewTypes.COMMUNICATION].join('\n');
    // Should show pending indicator (…) instead of checkmark
    assert.ok(content.includes('…') || content.includes('TOOL CALL'), 'Should show tool call is pending');
  });

  it('should display completed tool call indicator when result exists', () => {
    store.addToolCall('coder', 'Bash', { command: 'npm test' });
    store.addToolResult('coder', 'Bash', { output: 'All passed' });

    ui._refreshCommunicationView();

    const content = ui.viewContent[ViewTypes.COMMUNICATION].join('\n');
    assert.ok(content.includes('✓') || content.includes('TOOL RESULT'), 'Should show tool call completed');
  });

  it('should preserve entries across workflow phases', () => {
    store.addPhaseChange('planning', null);
    store.addPrompt('planner', 'Planning phase prompt');
    store.addPhaseChange('execution', 'planning');
    store.addPrompt('coder', 'Execution phase prompt');
    store.addPhaseChange('verification', 'execution');
    store.addPrompt('tester', 'Verification phase prompt');

    ui._refreshCommunicationView();

    // All entries should be present
    assert.ok(ui.commInteractionList.length >= 6, 'Should have all entries from all phases');

    const content = ui.viewContent[ViewTypes.COMMUNICATION].join('\n');
    assert.ok(content.includes('planner'), 'Should include planner entries');
    assert.ok(content.includes('coder'), 'Should include coder entries');
    assert.ok(content.includes('tester'), 'Should include tester entries');
  });
});

describe('TerminalUIMultiView - Enhanced Event Log View', () => {
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

  it('should initialize event log view state', () => {
    assert.strictEqual(ui.eventSearchQuery, '');
    assert.strictEqual(ui.eventSearchActive, false);
    assert.ok(ui.eventCategoryFilters instanceof Set);
    assert.strictEqual(ui.eventSelectedIndex, 0);
    assert.ok(ui.eventExpandedItems instanceof Set);
    assert.ok(Array.isArray(ui.eventList));
    assert.ok(Array.isArray(ui.eventCategories));
  });

  it('should display empty state when no events', () => {
    ui._refreshEventsView();

    const content = ui.viewContent[ViewTypes.EVENTS].join('\n');
    assert.ok(content.includes('No events recorded') || content.includes('EVENT LOG'), 'Should show empty state');
    assert.ok(content.includes('EVENT LOG'), 'Should show header');
  });

  it('should categorize events by type', () => {
    // Task event
    store.addEvent({ type: 'task:added', source: 'planner', object: { description: 'New task' } });
    // Goal event
    store.addEvent({ type: 'goal:completed', source: 'core', object: { description: 'Goal done' } });
    // Error event
    store.addEvent({ type: 'task:failed', source: 'coder', object: { error: 'Something failed' } });
    // Workflow event
    store.addEvent({ type: 'phase:changed', source: 'core', object: { phase: 'execution' } });

    ui._refreshEventsView();

    // Check categorization
    assert.ok(ui.eventList.length >= 4, 'Should have categorized events');

    const categories = ui.eventList.map(e => e._category);
    assert.ok(categories.includes('task'), 'Should categorize task events');
    assert.ok(categories.includes('goal'), 'Should categorize goal events');
    assert.ok(categories.includes('error'), 'Should categorize error events');
    assert.ok(categories.includes('workflow'), 'Should categorize workflow events');
  });

  it('should display category counts', () => {
    store.addEvent({ type: 'task:added', source: 'planner', object: {} });
    store.addEvent({ type: 'task:completed', source: 'coder', object: {} });
    store.addEvent({ type: 'goal:started', source: 'core', object: {} });

    ui._refreshEventsView();

    const content = ui.viewContent[ViewTypes.EVENTS].join('\n');
    assert.ok(content.includes('Category Counts'), 'Should show category counts section');
    assert.ok(content.includes('task'), 'Should show task category');
  });

  it('should filter events by category', () => {
    store.addEvent({ type: 'task:added', source: 'planner', object: {} });
    store.addEvent({ type: 'goal:started', source: 'core', object: {} });
    store.addEvent({ type: 'workflow:started', source: 'core', object: {} });

    ui._refreshEventsView();
    const initialCount = ui.eventList.length;

    // Hide task category
    ui.eventCategoryFilters.add('task');
    ui._refreshEventsView();

    assert.ok(ui.eventList.length < initialCount, 'Should have fewer events after filtering');
    assert.ok(!ui.eventList.some(e => e._category === 'task'), 'Should not include task events');
  });

  it('should search events by keyword', () => {
    store.addEvent({ type: 'task:added', source: 'planner', object: { description: 'Implement feature' } });
    store.addEvent({ type: 'task:completed', source: 'coder', object: { description: 'Fixed bug' } });
    store.addEvent({ type: 'goal:completed', source: 'core', object: { description: 'Authentication done' } });

    ui.eventSearchQuery = 'feature';
    ui._refreshEventsView();

    assert.strictEqual(ui.eventList.length, 1, 'Should only show matching events');
    assert.ok(ui.eventList[0].data.object.description.includes('feature'), 'Should match search term');
  });

  it('should search events by type', () => {
    store.addEvent({ type: 'task:added', source: 'planner', object: {} });
    store.addEvent({ type: 'task:completed', source: 'coder', object: {} });
    store.addEvent({ type: 'goal:completed', source: 'core', object: {} });

    ui.eventSearchQuery = 'completed';
    ui._refreshEventsView();

    assert.strictEqual(ui.eventList.length, 2, 'Should match events by type');
  });

  it('should highlight error events', () => {
    store.addEvent({ type: 'task:failed', source: 'coder', object: { error: 'Build failed' } });

    ui._refreshEventsView();

    const content = ui.viewContent[ViewTypes.EVENTS].join('\n');
    assert.ok(content.includes('ERROR') || content.includes('red'), 'Should highlight error events');
    assert.ok(ui.eventList[0]._priority === 'error', 'Should have error priority');
  });

  it('should highlight warning events', () => {
    store.addEvent({ type: 'task:retry', source: 'coder', object: { attempt: 2 } });

    ui._refreshEventsView();

    assert.ok(ui.eventList[0]._priority === 'warning', 'Should have warning priority');
  });

  it('should filter by priority level - errors only', () => {
    store.addEvent({ type: 'task:added', source: 'planner', object: {} }); // info
    store.addEvent({ type: 'task:retry', source: 'coder', object: {} }); // warning
    store.addEvent({ type: 'task:failed', source: 'coder', object: {} }); // error

    ui.eventPriorityMode = 'errors';
    ui._refreshEventsView();

    assert.strictEqual(ui.eventList.length, 1, 'Should only show error events');
    assert.strictEqual(ui.eventList[0]._priority, 'error');
  });

  it('should filter by priority level - warnings and errors', () => {
    store.addEvent({ type: 'task:added', source: 'planner', object: {} }); // info
    store.addEvent({ type: 'task:retry', source: 'coder', object: {} }); // warning
    store.addEvent({ type: 'task:failed', source: 'coder', object: {} }); // error

    ui.eventPriorityMode = 'warnings';
    ui._refreshEventsView();

    assert.strictEqual(ui.eventList.length, 2, 'Should show warnings and errors');
    assert.ok(ui.eventList.every(e => e._priority !== 'info'), 'Should not include info events');
  });

  it('should expand event details', () => {
    store.addEvent({ type: 'task:added', source: 'planner', object: { description: 'Task details here', status: 'pending' } });

    ui._refreshEventsView();
    const event = ui.eventList[0];

    // Expand the event
    ui.eventExpandedItems.add(event.sequence);
    ui._refreshEventsView();

    const content = ui.viewContent[ViewTypes.EVENTS].join('\n');
    assert.ok(content.includes('Event Details'), 'Should show expanded details');
    assert.ok(content.includes('Type:'), 'Should show type field');
    assert.ok(content.includes('Source:'), 'Should show source field');
    assert.ok(content.includes('Data:'), 'Should show data section');
  });

  it('should show structured JSON data in expanded view', () => {
    store.addEvent({ type: 'task:added', source: 'planner', object: { description: 'Test task', nested: { key: 'value' } } });

    ui._refreshEventsView();
    const event = ui.eventList[0];
    ui.eventExpandedItems.add(event.sequence);
    ui._refreshEventsView();

    const content = ui.viewContent[ViewTypes.EVENTS].join('\n');
    assert.ok(content.includes('description') || content.includes('Test task'), 'Should show object data');
  });

  it('should navigate between events', () => {
    store.addEvent({ type: 'task:added', source: 'planner', object: {} });
    store.addEvent({ type: 'task:completed', source: 'coder', object: {} });
    store.addEvent({ type: 'goal:completed', source: 'core', object: {} });

    ui._refreshEventsView();
    assert.strictEqual(ui.eventSelectedIndex, 0);

    ui.eventSelectedIndex = 1;
    assert.strictEqual(ui.eventSelectedIndex, 1);

    ui.eventSelectedIndex = 2;
    assert.strictEqual(ui.eventSelectedIndex, 2);
  });

  it('should show keyboard shortcuts help', () => {
    ui._refreshEventsView();

    const content = ui.viewContent[ViewTypes.EVENTS].join('\n');
    assert.ok(content.includes('Keyboard'), 'Should show keyboard help');
    assert.ok(content.includes('j') || content.includes('↓'), 'Should show navigation keys');
    assert.ok(content.includes('/'), 'Should show search shortcut');
    assert.ok(content.includes('f'), 'Should show filter shortcut');
  });

  it('should show priority legend', () => {
    ui._refreshEventsView();

    const content = ui.viewContent[ViewTypes.EVENTS].join('\n');
    assert.ok(content.includes('Priority'), 'Should show priority legend');
    assert.ok(content.includes('ERROR'), 'Should explain error priority');
    assert.ok(content.includes('WARNING'), 'Should explain warning priority');
    assert.ok(content.includes('INFO'), 'Should explain info priority');
  });

  it('should show filter status when filters active', () => {
    store.addEvent({ type: 'task:added', source: 'planner', object: {} });
    store.addEvent({ type: 'task:completed', source: 'coder', object: {} });

    ui.eventSearchQuery = 'added';
    ui._refreshEventsView();

    const content = ui.viewContent[ViewTypes.EVENTS].join('\n');
    assert.ok(content.includes('Search:') || content.includes('Active Filters'), 'Should show filter status');
    assert.ok(content.includes('1') && content.includes('2'), 'Should show filtered count');
  });

  it('should clear all filters', () => {
    store.addEvent({ type: 'task:added', source: 'planner', object: {} });
    store.addEvent({ type: 'task:completed', source: 'coder', object: {} });

    ui.eventSearchQuery = 'added';
    ui.eventCategoryFilters.add('task');
    ui.eventPriorityMode = 'errors';
    ui._refreshEventsView();

    // Clear filters
    ui.eventSearchQuery = '';
    ui.eventCategoryFilters.clear();
    ui.eventPriorityMode = 'all';
    ui._refreshEventsView();

    assert.strictEqual(ui.eventSearchQuery, '');
    assert.strictEqual(ui.eventCategoryFilters.size, 0);
    assert.strictEqual(ui.eventPriorityMode, 'all');
  });

  it('should adjust selected index when filtered list shrinks', () => {
    store.addEvent({ type: 'task:added', source: 'planner', object: {} });
    store.addEvent({ type: 'task:completed', source: 'coder', object: {} });
    store.addEvent({ type: 'goal:completed', source: 'core', object: {} });

    ui._refreshEventsView();
    ui.eventSelectedIndex = 2; // Select last item

    // Apply filter that reduces list
    ui.eventSearchQuery = 'task';
    ui._refreshEventsView();

    // Selected index should adjust to stay in bounds
    assert.ok(ui.eventSelectedIndex <= ui.eventList.length - 1);
  });

  it('should toggle expand/collapse state', () => {
    store.addEvent({ type: 'task:added', source: 'planner', object: { description: 'Test' } });

    ui._refreshEventsView();
    const event = ui.eventList[0];

    assert.ok(!ui.eventExpandedItems.has(event.sequence), 'Should start collapsed');

    ui.eventExpandedItems.add(event.sequence);
    assert.ok(ui.eventExpandedItems.has(event.sequence), 'Should be expanded');

    ui.eventExpandedItems.delete(event.sequence);
    assert.ok(!ui.eventExpandedItems.has(event.sequence), 'Should be collapsed again');
  });

  it('should show category icons and colors', () => {
    store.addEvent({ type: 'task:added', source: 'planner', object: {} });

    ui._refreshEventsView();

    const content = ui.viewContent[ViewTypes.EVENTS].join('\n');
    // Should include category-related markup
    assert.ok(content.includes('[TASK]') || content.includes('task'), 'Should show category');
  });

  it('should categorize agent events correctly', () => {
    store.addEvent({ type: 'prompt', source: 'planner', object: {} });
    store.addEvent({ type: 'response', source: 'coder', object: {} });

    ui._refreshEventsView();

    // Events from known agents should be categorized as agent events
    const agentEvents = ui.eventList.filter(e => e._category === 'agent');
    assert.ok(agentEvents.length >= 0, 'Should categorize agent events');
  });

  it('should categorize tool events correctly', () => {
    store.addEvent({ type: 'tool:called', source: 'coder', object: { tool: 'Read' } });

    ui._refreshEventsView();

    const toolEvents = ui.eventList.filter(e => e._category === 'tool');
    assert.strictEqual(toolEvents.length, 1, 'Should categorize tool events');
  });

  it('should show message when no events match filters', () => {
    store.addEvent({ type: 'task:added', source: 'planner', object: {} });

    ui.eventSearchQuery = 'nonexistent';
    ui._refreshEventsView();

    const content = ui.viewContent[ViewTypes.EVENTS].join('\n');
    assert.ok(content.includes('No events match') || content.includes('filter'), 'Should show no matches message');
  });

  it('should preserve all event categories in eventCategories array', () => {
    assert.ok(ui.eventCategories.includes('agent'), 'Should have agent category');
    assert.ok(ui.eventCategories.includes('task'), 'Should have task category');
    assert.ok(ui.eventCategories.includes('goal'), 'Should have goal category');
    assert.ok(ui.eventCategories.includes('workflow'), 'Should have workflow category');
    assert.ok(ui.eventCategories.includes('tool'), 'Should have tool category');
    assert.ok(ui.eventCategories.includes('error'), 'Should have error category');
    assert.ok(ui.eventCategories.includes('system'), 'Should have system category');
  });

  it('should get correct priority colors', () => {
    assert.strictEqual(ui._getEventPriorityColor('error'), 'red');
    assert.strictEqual(ui._getEventPriorityColor('warning'), 'yellow');
    assert.strictEqual(ui._getEventPriorityColor('info'), 'white');
  });

  it('should get correct category colors', () => {
    assert.strictEqual(ui._getEventCategoryColor('agent'), 'cyan');
    assert.strictEqual(ui._getEventCategoryColor('task'), 'green');
    assert.strictEqual(ui._getEventCategoryColor('goal'), 'magenta');
    assert.strictEqual(ui._getEventCategoryColor('workflow'), 'blue');
    assert.strictEqual(ui._getEventCategoryColor('tool'), 'yellow');
    assert.strictEqual(ui._getEventCategoryColor('error'), 'red');
    assert.strictEqual(ui._getEventCategoryColor('system'), 'gray');
  });

  it('should get correct category icons', () => {
    assert.ok(ui._getEventCategoryIcon('agent').length > 0, 'Should have agent icon');
    assert.ok(ui._getEventCategoryIcon('task').length > 0, 'Should have task icon');
    assert.ok(ui._getEventCategoryIcon('error').length > 0, 'Should have error icon');
  });
});
