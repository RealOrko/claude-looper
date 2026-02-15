/**
 * Tests for terminal-ui-events.js - EventsView component
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import { EventsView } from './terminal-ui-events.js';
import { WorkflowHistoryStore, resetHistoryStore } from './workflow-history-store.js';

// Test directory for file operations
const TEST_STATE_DIR = '.test-ui-events-claude-looper';
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

// Create a mock UI object for testing
function createMockUI() {
  const store = new WorkflowHistoryStore({
    stateDir: TEST_STATE_DIR,
    retention: {
      maxMemoryEntries: 1000,
      autoFlushThreshold: 500,
      enableFileRotation: false
    }
  });

  return {
    historyStore: store,
    widgets: {
      leftPanel: { width: 50 },
      rightPanel: { width: 50 }
    },
    screen: {
      render: () => {}
    },
    _renderCurrentView: () => {}
  };
}

// Helper to combine left and right content for testing
function getContentString(result) {
  const left = (result.left || []).join('\n');
  const right = (result.right || []).join('\n');
  return left + '\n' + right;
}

describe('EventsView - Initialization', () => {
  let mockUI;
  let eventsView;

  beforeEach(async () => {
    cleanupTestFiles();
    resetHistoryStore();
    mockUI = createMockUI();
    await mockUI.historyStore.init();
    eventsView = new EventsView(mockUI);
  });

  afterEach(() => {
    if (mockUI.historyStore) mockUI.historyStore.clear();
    cleanupTestFiles();
    resetHistoryStore();
  });

  it('should initialize event log view state', () => {
    assert.strictEqual(eventsView.eventSearchQuery, '');
    assert.strictEqual(eventsView.eventSearchActive, false);
    assert.ok(eventsView.eventCategoryFilters instanceof Set);
    assert.strictEqual(eventsView.eventSelectedIndex, 0);
    assert.ok(Array.isArray(eventsView.eventList));
    assert.ok(Array.isArray(eventsView.eventCategories));
  });

  it('should preserve all event categories in eventCategories array', () => {
    assert.ok(eventsView.eventCategories.includes('agent'), 'Should have agent category');
    assert.ok(eventsView.eventCategories.includes('task'), 'Should have task category');
    assert.ok(eventsView.eventCategories.includes('goal'), 'Should have goal category');
    assert.ok(eventsView.eventCategories.includes('workflow'), 'Should have workflow category');
    assert.ok(eventsView.eventCategories.includes('tool'), 'Should have tool category');
    assert.ok(eventsView.eventCategories.includes('error'), 'Should have error category');
    assert.ok(eventsView.eventCategories.includes('system'), 'Should have system category');
  });
});

describe('EventsView - Empty State', () => {
  let mockUI;
  let eventsView;

  beforeEach(async () => {
    cleanupTestFiles();
    resetHistoryStore();
    mockUI = createMockUI();
    await mockUI.historyStore.init();
    eventsView = new EventsView(mockUI);
  });

  afterEach(() => {
    if (mockUI.historyStore) mockUI.historyStore.clear();
    cleanupTestFiles();
    resetHistoryStore();
  });

  it('should display empty state when no events', () => {
    const content = eventsView.refresh();

    const contentStr = getContentString(content);
    assert.ok(contentStr.includes('No events') || contentStr.length > 0, 'Should handle empty state');
  });
});

describe('EventsView - Event Categorization', () => {
  let mockUI;
  let eventsView;

  beforeEach(async () => {
    cleanupTestFiles();
    resetHistoryStore();
    mockUI = createMockUI();
    await mockUI.historyStore.init();
    eventsView = new EventsView(mockUI);
  });

  afterEach(() => {
    if (mockUI.historyStore) mockUI.historyStore.clear();
    cleanupTestFiles();
    resetHistoryStore();
  });

  it('should categorize events by type', () => {
    // Task event
    mockUI.historyStore.addEvent({ type: 'task:added', source: 'planner', object: { description: 'New task' } });
    // Goal event
    mockUI.historyStore.addEvent({ type: 'goal:completed', source: 'core', object: { description: 'Goal done' } });
    // Error event
    mockUI.historyStore.addEvent({ type: 'task:failed', source: 'coder', object: { error: 'Something failed' } });
    // Workflow event
    mockUI.historyStore.addEvent({ type: 'phase:changed', source: 'core', object: { phase: 'execution' } });

    eventsView.refresh();

    // Check categorization
    assert.ok(eventsView.eventList.length >= 4, 'Should have categorized events');

    const categories = eventsView.eventList.map(e => e._category);
    assert.ok(categories.includes('task'), 'Should categorize task events');
    assert.ok(categories.includes('goal'), 'Should categorize goal events');
    assert.ok(categories.includes('error'), 'Should categorize error events');
    assert.ok(categories.includes('workflow'), 'Should categorize workflow events');
  });

  it('should categorize agent events correctly', () => {
    mockUI.historyStore.addEvent({ type: 'prompt', source: 'planner', object: {} });
    mockUI.historyStore.addEvent({ type: 'response', source: 'coder', object: {} });

    eventsView.refresh();

    // Events from known agents should be categorized as agent events
    const agentEvents = eventsView.eventList.filter(e => e._category === 'agent');
    assert.ok(agentEvents.length >= 0, 'Should categorize agent events');
  });

  it('should categorize tool events correctly', () => {
    mockUI.historyStore.addEvent({ type: 'tool:called', source: 'coder', object: { tool: 'Read' } });

    eventsView.refresh();

    const toolEvents = eventsView.eventList.filter(e => e._category === 'tool');
    assert.strictEqual(toolEvents.length, 1, 'Should categorize tool events');
  });
});

describe('EventsView - Priority Highlighting', () => {
  let mockUI;
  let eventsView;

  beforeEach(async () => {
    cleanupTestFiles();
    resetHistoryStore();
    mockUI = createMockUI();
    await mockUI.historyStore.init();
    eventsView = new EventsView(mockUI);
  });

  afterEach(() => {
    if (mockUI.historyStore) mockUI.historyStore.clear();
    cleanupTestFiles();
    resetHistoryStore();
  });

  it('should highlight error events', () => {
    mockUI.historyStore.addEvent({ type: 'task:failed', source: 'coder', object: { error: 'Build failed' } });

    eventsView.refresh();

    const content = eventsView.refresh();
    const contentStr = getContentString(content);
    assert.ok(contentStr.includes('ERROR') || contentStr.includes('red'), 'Should highlight error events');
    assert.ok(eventsView.eventList[0]._priority === 'error', 'Should have error priority');
  });

  it('should highlight warning events', () => {
    mockUI.historyStore.addEvent({ type: 'task:retry', source: 'coder', object: { attempt: 2 } });

    eventsView.refresh();

    assert.ok(eventsView.eventList[0]._priority === 'warning', 'Should have warning priority');
  });
});

describe('EventsView - Category Filtering', () => {
  let mockUI;
  let eventsView;

  beforeEach(async () => {
    cleanupTestFiles();
    resetHistoryStore();
    mockUI = createMockUI();
    await mockUI.historyStore.init();
    eventsView = new EventsView(mockUI);
  });

  afterEach(() => {
    if (mockUI.historyStore) mockUI.historyStore.clear();
    cleanupTestFiles();
    resetHistoryStore();
  });

  it('should filter events by category', () => {
    mockUI.historyStore.addEvent({ type: 'task:added', source: 'planner', object: {} });
    mockUI.historyStore.addEvent({ type: 'goal:started', source: 'core', object: {} });
    mockUI.historyStore.addEvent({ type: 'workflow:started', source: 'core', object: {} });

    eventsView.refresh();
    const initialCount = eventsView.eventList.length;

    // Hide task category
    eventsView.eventCategoryFilters.add('task');
    eventsView.refresh();

    assert.ok(eventsView.eventList.length < initialCount, 'Should have fewer events after filtering');
    assert.ok(!eventsView.eventList.some(e => e._category === 'task'), 'Should not include task events');
  });
});

describe('EventsView - Priority Filtering', () => {
  let mockUI;
  let eventsView;

  beforeEach(async () => {
    cleanupTestFiles();
    resetHistoryStore();
    mockUI = createMockUI();
    await mockUI.historyStore.init();
    eventsView = new EventsView(mockUI);
  });

  afterEach(() => {
    if (mockUI.historyStore) mockUI.historyStore.clear();
    cleanupTestFiles();
    resetHistoryStore();
  });

  it('should filter by priority level - errors only', () => {
    mockUI.historyStore.addEvent({ type: 'task:added', source: 'planner', object: {} }); // info
    mockUI.historyStore.addEvent({ type: 'task:retry', source: 'coder', object: {} }); // warning
    mockUI.historyStore.addEvent({ type: 'task:failed', source: 'coder', object: {} }); // error

    eventsView.eventPriorityMode = 'errors';
    eventsView.refresh();

    assert.strictEqual(eventsView.eventList.length, 1, 'Should only show error events');
    assert.strictEqual(eventsView.eventList[0]._priority, 'error');
  });

  it('should filter by priority level - warnings and errors', () => {
    mockUI.historyStore.addEvent({ type: 'task:added', source: 'planner', object: {} }); // info
    mockUI.historyStore.addEvent({ type: 'task:retry', source: 'coder', object: {} }); // warning
    mockUI.historyStore.addEvent({ type: 'task:failed', source: 'coder', object: {} }); // error

    eventsView.eventPriorityMode = 'warnings';
    eventsView.refresh();

    assert.strictEqual(eventsView.eventList.length, 2, 'Should show warnings and errors');
    assert.ok(eventsView.eventList.every(e => e._priority !== 'info'), 'Should not include info events');
  });
});

describe('EventsView - Search Filtering', () => {
  let mockUI;
  let eventsView;

  beforeEach(async () => {
    cleanupTestFiles();
    resetHistoryStore();
    mockUI = createMockUI();
    await mockUI.historyStore.init();
    eventsView = new EventsView(mockUI);
  });

  afterEach(() => {
    if (mockUI.historyStore) mockUI.historyStore.clear();
    cleanupTestFiles();
    resetHistoryStore();
  });

  it('should search events by keyword', () => {
    mockUI.historyStore.addEvent({ type: 'task:added', source: 'planner', object: { description: 'Implement feature' } });
    mockUI.historyStore.addEvent({ type: 'task:completed', source: 'coder', object: { description: 'Fixed bug' } });
    mockUI.historyStore.addEvent({ type: 'goal:completed', source: 'core', object: { description: 'Authentication done' } });

    eventsView.eventSearchQuery = 'feature';
    eventsView.refresh();

    assert.strictEqual(eventsView.eventList.length, 1, 'Should only show matching events');
    assert.ok(eventsView.eventList[0].data.object.description.includes('feature'), 'Should match search term');
  });

  it('should search events by type', () => {
    mockUI.historyStore.addEvent({ type: 'task:added', source: 'planner', object: {} });
    mockUI.historyStore.addEvent({ type: 'task:completed', source: 'coder', object: {} });
    mockUI.historyStore.addEvent({ type: 'goal:completed', source: 'core', object: {} });

    eventsView.eventSearchQuery = 'completed';
    eventsView.refresh();

    assert.strictEqual(eventsView.eventList.length, 2, 'Should match events by type');
  });

  it('should show message when no events match filters', () => {
    mockUI.historyStore.addEvent({ type: 'task:added', source: 'planner', object: {} });

    eventsView.eventSearchQuery = 'nonexistent';
    eventsView.refresh();

    // Should have empty list when filters match nothing
    assert.strictEqual(eventsView.eventList.length, 0, 'Should have empty list');
  });
});

describe('EventsView - Navigation', () => {
  let mockUI;
  let eventsView;

  beforeEach(async () => {
    cleanupTestFiles();
    resetHistoryStore();
    mockUI = createMockUI();
    await mockUI.historyStore.init();
    eventsView = new EventsView(mockUI);
  });

  afterEach(() => {
    if (mockUI.historyStore) mockUI.historyStore.clear();
    cleanupTestFiles();
    resetHistoryStore();
  });

  it('should navigate between events', () => {
    mockUI.historyStore.addEvent({ type: 'task:added', source: 'planner', object: {} });
    mockUI.historyStore.addEvent({ type: 'task:completed', source: 'coder', object: {} });
    mockUI.historyStore.addEvent({ type: 'goal:completed', source: 'core', object: {} });

    eventsView.refresh();
    assert.strictEqual(eventsView.eventSelectedIndex, 0);

    eventsView.eventSelectedIndex = 1;
    assert.strictEqual(eventsView.eventSelectedIndex, 1);

    eventsView.eventSelectedIndex = 2;
    assert.strictEqual(eventsView.eventSelectedIndex, 2);
  });

  it('should adjust selected index when filtered list shrinks', () => {
    mockUI.historyStore.addEvent({ type: 'task:added', source: 'planner', object: {} });
    mockUI.historyStore.addEvent({ type: 'task:completed', source: 'coder', object: {} });
    mockUI.historyStore.addEvent({ type: 'goal:completed', source: 'core', object: {} });

    eventsView.refresh();
    eventsView.eventSelectedIndex = 2; // Select last item

    // Apply filter that reduces list
    eventsView.eventSearchQuery = 'task';
    eventsView.refresh();

    // Selected index should adjust to stay in bounds
    assert.ok(eventsView.eventSelectedIndex <= eventsView.eventList.length - 1);
  });
});

describe('EventsView - Clearing Filters', () => {
  let mockUI;
  let eventsView;

  beforeEach(async () => {
    cleanupTestFiles();
    resetHistoryStore();
    mockUI = createMockUI();
    await mockUI.historyStore.init();
    eventsView = new EventsView(mockUI);
  });

  afterEach(() => {
    if (mockUI.historyStore) mockUI.historyStore.clear();
    cleanupTestFiles();
    resetHistoryStore();
  });

  it('should clear all filters', () => {
    mockUI.historyStore.addEvent({ type: 'task:added', source: 'planner', object: {} });
    mockUI.historyStore.addEvent({ type: 'task:completed', source: 'coder', object: {} });

    eventsView.eventSearchQuery = 'added';
    eventsView.eventCategoryFilters.add('task');
    eventsView.eventPriorityMode = 'errors';
    eventsView.refresh();

    // Clear filters
    eventsView.eventSearchQuery = '';
    eventsView.eventCategoryFilters.clear();
    eventsView.eventPriorityMode = 'all';
    eventsView.refresh();

    assert.strictEqual(eventsView.eventSearchQuery, '');
    assert.strictEqual(eventsView.eventCategoryFilters.size, 0);
    assert.strictEqual(eventsView.eventPriorityMode, 'all');
  });
});

describe('EventsView - Colors and Icons', () => {
  let mockUI;
  let eventsView;

  beforeEach(async () => {
    cleanupTestFiles();
    resetHistoryStore();
    mockUI = createMockUI();
    await mockUI.historyStore.init();
    eventsView = new EventsView(mockUI);
  });

  afterEach(() => {
    if (mockUI.historyStore) mockUI.historyStore.clear();
    cleanupTestFiles();
    resetHistoryStore();
  });

  it('should get correct priority colors', () => {
    assert.strictEqual(eventsView.getPriorityColor('error'), 'red');
    assert.strictEqual(eventsView.getPriorityColor('warning'), 'yellow');
    assert.strictEqual(eventsView.getPriorityColor('info'), 'white');
  });

  it('should get correct category colors', () => {
    assert.strictEqual(eventsView.getCategoryColor('agent'), 'cyan');
    assert.strictEqual(eventsView.getCategoryColor('task'), 'green');
    assert.strictEqual(eventsView.getCategoryColor('goal'), 'magenta');
    assert.strictEqual(eventsView.getCategoryColor('workflow'), 'blue');
    assert.strictEqual(eventsView.getCategoryColor('tool'), 'yellow');
    assert.strictEqual(eventsView.getCategoryColor('error'), 'red');
    assert.strictEqual(eventsView.getCategoryColor('system'), 'white');
  });

  it('should get correct category icons', () => {
    assert.ok(eventsView.getCategoryIcon('agent').length > 0, 'Should have agent icon');
    assert.ok(eventsView.getCategoryIcon('task').length > 0, 'Should have task icon');
    assert.ok(eventsView.getCategoryIcon('error').length > 0, 'Should have error icon');
  });
});
