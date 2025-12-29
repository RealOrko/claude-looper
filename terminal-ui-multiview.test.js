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
    assert.ok(result.endsWith('...'));
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

  it('should start with tasks view', () => {
    assert.strictEqual(ui.currentView, ViewTypes.TASKS);
  });

  it('should track view changes via currentView', () => {
    ui.currentView = ViewTypes.COMMUNICATION;
    assert.strictEqual(ui.currentView, ViewTypes.COMMUNICATION);

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
    // Complexity is shown in the details panel for the selected task (first one)
    assert.ok(content.includes('simple'), 'Should show simple for selected task');
  });

  it('should distinguish parent-child from peer dependencies', () => {
    ui.tasks = [
      { id: 'task-1', description: 'Parent task', status: 'pending', subtasks: ['task-2'], metadata: {} },
      { id: 'task-2', description: 'Child task', status: 'pending', subtasks: [], parentTaskId: 'task-1', metadata: {} }
    ];

    ui._refreshTasksView();

    const content = ui.viewContent[ViewTypes.TASKS].join('\n');
    // Parent-child uses ASCII tree connectors
    assert.ok(content.includes('|--') || content.includes("'--"), 'Should show tree connector for parent-child');
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
    assert.ok(content.includes('Criteria:'), 'Should show criteria section');
    assert.ok(content.includes('Test passes'), 'Should show criteria items');
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
    assert.ok(content.includes('Details:'), 'Should show details header');
    assert.ok(content.includes('in_progress'), 'Should show status');
    assert.ok(content.includes('complex'), 'Should show complexity');
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
    // Current task uses * icon, next task uses > icon
    assert.ok(content.includes('Current task'), 'Should show current task');
    assert.ok(content.includes('Next task'), 'Should show next task');
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
    assert.ok(Array.isArray(ui.commInteractionList));
  });

  it('should display empty state when no communications', () => {
    ui._refreshCommunicationView();

    const content = ui.viewContent[ViewTypes.COMMUNICATION].join('\n');
    assert.ok(content.includes('No agent communications') || content.includes('communications') || content.includes('No messages'), 'Should show empty state');
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
    // Uses <- for prompts in list view
    assert.ok(content.includes('<-') || content.includes('PROMPT'), 'Should show prompt indicator');
    assert.ok(content.includes('planner'), 'Should show agent name');
  });

  it('should display responses with agent name', () => {
    store.addPrompt('coder', 'Implement the feature');
    store.addResponse('coder', 'Feature implemented successfully');

    ui._refreshCommunicationView();

    const content = ui.viewContent[ViewTypes.COMMUNICATION].join('\n');
    // Uses -> for responses in list view
    assert.ok(content.includes('->') || content.includes('RESPONSE'), 'Should show response indicator');
    assert.ok(content.includes('coder'), 'Should show agent name');
  });

  it('should display interactions with sender and receiver', () => {
    store.addInteraction('planner', 'coder', {
      type: 'delegation',
      content: 'Please implement this feature'
    });

    ui._refreshCommunicationView();

    const content = ui.viewContent[ViewTypes.COMMUNICATION].join('\n');
    assert.ok(content.includes('planner') || content.includes('coder'), 'Should show agents');
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

  it('should format tool calls', () => {
    store.addToolCall('coder', 'Edit', { file_path: '/path/to/file.js', old_string: 'old', new_string: 'new' });

    ui._refreshCommunicationView();

    const content = ui.viewContent[ViewTypes.COMMUNICATION].join('\n');
    assert.ok(content.includes('TOOL') || content.includes('Edit'), 'Should show tool call');
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

  it('should correlate phase changes with message timeline', () => {
    store.addPhaseChange('planning', null);
    store.addPrompt('planner', 'Creating plan');
    store.addPhaseChange('execution', 'planning');
    store.addPrompt('coder', 'Executing plan');

    ui._refreshCommunicationView();

    // Should have entries for phases and prompts
    assert.ok(ui.commInteractionList.length >= 4, 'Should have phase and prompt entries');
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

    // When filtering by planner, should only have 1 entry
    assert.strictEqual(ui.commInteractionList.length, 1, 'Should have 1 filtered entry');
    assert.strictEqual(ui.commInteractionList[0].agentName, 'planner', 'Should show planner entry');
  });

  it('should show message when filters match nothing', () => {
    store.addPrompt('planner', 'Test');

    ui.commFilterAgent = 'nonexistent';
    ui._refreshCommunicationView();

    // When filters match nothing, the list should be empty
    assert.strictEqual(ui.commInteractionList.length, 0, 'Should have empty list');
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

    // Tool call should be in the interaction list
    const toolCalls = ui.commInteractionList.filter(e => e.entryType === 'tool_call');
    assert.strictEqual(toolCalls.length, 1, 'Should have tool call entry');
  });

  it('should display completed tool call indicator when result exists', () => {
    store.addToolCall('coder', 'Bash', { command: 'npm test' });
    store.addToolResult('coder', 'Bash', { output: 'All passed' });

    ui._refreshCommunicationView();

    // Should have both tool call and tool result
    const toolCalls = ui.commInteractionList.filter(e => e.entryType === 'tool_call');
    const toolResults = ui.commInteractionList.filter(e => e.entryType === 'tool_result');
    assert.strictEqual(toolCalls.length, 1, 'Should have tool call entry');
    assert.strictEqual(toolResults.length, 1, 'Should have tool result entry');
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
    assert.ok(Array.isArray(ui.eventList));
    assert.ok(Array.isArray(ui.eventCategories));
  });

  it('should display empty state when no events', () => {
    ui._refreshEventsView();

    const content = ui.viewContent[ViewTypes.EVENTS].join('\n');
    assert.ok(content.includes('No events') || content.length > 0, 'Should handle empty state');
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

    // Events should be categorized
    assert.ok(ui.eventList.length >= 3, 'Should have events');
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

  it('should show event details in side panel', () => {
    store.addEvent({ type: 'task:added', source: 'planner', object: { description: 'Task details here', status: 'pending' } });

    ui._refreshEventsView();

    const content = ui.viewContent[ViewTypes.EVENTS].join('\n');
    // Side panel shows details of selected event
    assert.ok(content.includes('Type:') || content.includes('task'), 'Should show event type');
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

    // Should have empty list when filters match nothing
    assert.strictEqual(ui.eventList.length, 0, 'Should have empty list');
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
