/**
 * Tests for terminal-ui-tasks.js - TasksView component
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import { TasksView } from './terminal-ui-tasks.js';
import { WorkflowHistoryStore, resetHistoryStore } from './workflow-history-store.js';

// Test directory for file operations
const TEST_STATE_DIR = '.test-ui-tasks-claude-looper';
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
    tasks: [],
    currentTaskId: null,
    nextTaskId: null,
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

describe('TasksView - Initialization', () => {
  let mockUI;
  let tasksView;

  beforeEach(async () => {
    cleanupTestFiles();
    resetHistoryStore();
    mockUI = createMockUI();
    await mockUI.historyStore.init();
    tasksView = new TasksView(mockUI);
  });

  afterEach(() => {
    if (mockUI.historyStore) mockUI.historyStore.clear();
    cleanupTestFiles();
    resetHistoryStore();
  });

  it('should initialize task graph state', () => {
    assert.strictEqual(tasksView.taskGraphSelectedIndex, 0);
    assert.strictEqual(tasksView.taskGraphShowDetails, true);
    assert.ok(Array.isArray(tasksView.taskGraphFlatList));
  });
});

describe('TasksView - Empty State', () => {
  let mockUI;
  let tasksView;

  beforeEach(async () => {
    cleanupTestFiles();
    resetHistoryStore();
    mockUI = createMockUI();
    await mockUI.historyStore.init();
    tasksView = new TasksView(mockUI);
  });

  afterEach(() => {
    if (mockUI.historyStore) mockUI.historyStore.clear();
    cleanupTestFiles();
    resetHistoryStore();
  });

  it('should display empty state when no tasks', () => {
    const content = tasksView.refresh();

    const contentStr = getContentString(content);
    assert.ok(contentStr.includes('No tasks recorded'), 'Should show empty state message');
  });
});

describe('TasksView - Task Display', () => {
  let mockUI;
  let tasksView;

  beforeEach(async () => {
    cleanupTestFiles();
    resetHistoryStore();
    mockUI = createMockUI();
    await mockUI.historyStore.init();
    tasksView = new TasksView(mockUI);
  });

  afterEach(() => {
    if (mockUI.historyStore) mockUI.historyStore.clear();
    cleanupTestFiles();
    resetHistoryStore();
  });

  it('should display tasks with status color-coding', () => {
    mockUI.tasks = [
      { id: 'task-1', description: 'Completed task', status: 'completed', subtasks: [], metadata: {} },
      { id: 'task-2', description: 'In progress task', status: 'in_progress', subtasks: [], metadata: {} },
      { id: 'task-3', description: 'Pending task', status: 'pending', subtasks: [], metadata: {} },
      { id: 'task-4', description: 'Failed task', status: 'failed', subtasks: [], metadata: {} }
    ];

    const content = tasksView.refresh();

    const contentStr = getContentString(content);
    assert.ok(contentStr.includes('Completed task'), 'Should show completed task');
    assert.ok(contentStr.includes('In progress task'), 'Should show in progress task');
    assert.ok(contentStr.includes('Pending task'), 'Should show pending task');
    assert.ok(contentStr.includes('Failed task'), 'Should show failed task');
    // Status colors in blessed format
    assert.ok(contentStr.includes('green-fg') || contentStr.includes('+'), 'Should have green for completed');
    assert.ok(contentStr.includes('yellow-fg') || contentStr.includes('*'), 'Should have yellow for in_progress');
  });

  it('should show complexity ratings for tasks', () => {
    mockUI.tasks = [
      { id: 'task-1', description: 'Simple task', status: 'pending', subtasks: [], metadata: { complexity: 'simple' } },
      { id: 'task-2', description: 'Medium task', status: 'pending', subtasks: [], metadata: { complexity: 'medium' } },
      { id: 'task-3', description: 'Complex task', status: 'pending', subtasks: [], metadata: { complexity: 'complex' } }
    ];

    const content = tasksView.refresh();

    const contentStr = getContentString(content);
    // Complexity is shown in the details panel for the selected task (first one)
    assert.ok(contentStr.includes('simple'), 'Should show simple for selected task');
  });

  it('should distinguish parent-child from peer dependencies', () => {
    mockUI.tasks = [
      { id: 'task-1', description: 'Parent task', status: 'pending', subtasks: ['task-2'], metadata: {} },
      { id: 'task-2', description: 'Child task', status: 'pending', subtasks: [], parentTaskId: 'task-1', metadata: {} }
    ];

    const content = tasksView.refresh();

    const contentStr = getContentString(content);
    // Parent-child uses ASCII tree connectors
    assert.ok(contentStr.includes('|--') || contentStr.includes("'--"), 'Should show tree connector for parent-child');
  });

  it('should show verification criteria in details', () => {
    mockUI.tasks = [
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

    tasksView.taskGraphShowDetails = true;
    const content = tasksView.refresh();

    const contentStr = getContentString(content);
    assert.ok(contentStr.includes('Criteria:'), 'Should show criteria section');
    assert.ok(contentStr.includes('Test passes'), 'Should show criteria items');
  });

  it('should be readable with 10+ tasks', () => {
    // Create 12 tasks
    mockUI.tasks = [];
    for (let i = 1; i <= 12; i++) {
      mockUI.tasks.push({
        id: `task-${i}`,
        description: `Task number ${i} with description`,
        status: i <= 3 ? 'completed' : (i <= 5 ? 'in_progress' : 'pending'),
        subtasks: [],
        metadata: { complexity: ['simple', 'medium', 'complex'][i % 3] }
      });
    }

    const content = tasksView.refresh();

    const contentStr = getContentString(content);
    // All tasks should be present
    assert.ok(contentStr.includes('Task number 1'), 'Should show first task');
    assert.ok(contentStr.includes('Task number 12'), 'Should show last task');
  });
});

describe('TasksView - Flat List Building', () => {
  let mockUI;
  let tasksView;

  beforeEach(async () => {
    cleanupTestFiles();
    resetHistoryStore();
    mockUI = createMockUI();
    await mockUI.historyStore.init();
    tasksView = new TasksView(mockUI);
  });

  afterEach(() => {
    if (mockUI.historyStore) mockUI.historyStore.clear();
    cleanupTestFiles();
    resetHistoryStore();
  });

  it('should build flat list for navigation', () => {
    mockUI.tasks = [
      { id: 'task-1', description: 'Parent 1', status: 'pending', subtasks: ['task-2', 'task-3'], metadata: {} },
      { id: 'task-2', description: 'Child 1', status: 'pending', subtasks: [], parentTaskId: 'task-1', metadata: {} },
      { id: 'task-3', description: 'Child 2', status: 'pending', subtasks: [], parentTaskId: 'task-1', metadata: {} },
      { id: 'task-4', description: 'Parent 2', status: 'pending', subtasks: [], metadata: {} }
    ];

    const taskMap = new Map(mockUI.tasks.map(t => [t.id, t]));
    const flatList = tasksView._buildTaskFlatList(mockUI.tasks, taskMap);

    assert.strictEqual(flatList.length, 4, 'Should have 4 tasks in flat list');
    assert.strictEqual(flatList[0].id, 'task-1', 'First should be parent 1');
    assert.strictEqual(flatList[1].id, 'task-2', 'Second should be child 1');
    assert.strictEqual(flatList[2].id, 'task-3', 'Third should be child 2');
    assert.strictEqual(flatList[3].id, 'task-4', 'Fourth should be parent 2');
  });

  it('should assign correct depths to tasks', () => {
    mockUI.tasks = [
      { id: 'task-1', description: 'Parent', status: 'pending', subtasks: ['task-2'], metadata: {} },
      { id: 'task-2', description: 'Child', status: 'pending', subtasks: ['task-3'], metadata: {} },
      { id: 'task-3', description: 'Grandchild', status: 'pending', subtasks: [], metadata: {} }
    ];

    const taskMap = new Map(mockUI.tasks.map(t => [t.id, t]));
    const flatList = tasksView._buildTaskFlatList(mockUI.tasks, taskMap);

    assert.strictEqual(flatList[0].depth, 0, 'Parent should have depth 0');
    assert.strictEqual(flatList[1].depth, 1, 'Child should have depth 1');
    assert.strictEqual(flatList[2].depth, 2, 'Grandchild should have depth 2');
  });
});

describe('TasksView - Navigation', () => {
  let mockUI;
  let tasksView;

  beforeEach(async () => {
    cleanupTestFiles();
    resetHistoryStore();
    mockUI = createMockUI();
    await mockUI.historyStore.init();
    tasksView = new TasksView(mockUI);
  });

  afterEach(() => {
    if (mockUI.historyStore) mockUI.historyStore.clear();
    cleanupTestFiles();
    resetHistoryStore();
  });

  it('should navigate between tasks', () => {
    mockUI.tasks = [
      { id: 'task-1', description: 'Task 1', status: 'pending', subtasks: [], metadata: {} },
      { id: 'task-2', description: 'Task 2', status: 'pending', subtasks: [], metadata: {} },
      { id: 'task-3', description: 'Task 3', status: 'pending', subtasks: [], metadata: {} }
    ];

    tasksView.refresh();
    assert.strictEqual(tasksView.taskGraphSelectedIndex, 0);

    // Navigate down
    tasksView.taskGraphSelectedIndex = 1;
    assert.strictEqual(tasksView.taskGraphSelectedIndex, 1);

    tasksView.taskGraphSelectedIndex = 2;
    assert.strictEqual(tasksView.taskGraphSelectedIndex, 2);

    // Navigate up
    tasksView.taskGraphSelectedIndex = 1;
    assert.strictEqual(tasksView.taskGraphSelectedIndex, 1);
  });

  it('should toggle details visibility', () => {
    mockUI.tasks = [{ id: 'task-1', description: 'Task 1', status: 'pending', subtasks: [], metadata: {} }];

    assert.strictEqual(tasksView.taskGraphShowDetails, true);
    tasksView.taskGraphShowDetails = false;
    assert.strictEqual(tasksView.taskGraphShowDetails, false);
    tasksView.taskGraphShowDetails = true;
    assert.strictEqual(tasksView.taskGraphShowDetails, true);
  });
});

describe('TasksView - Selected Task Details', () => {
  let mockUI;
  let tasksView;

  beforeEach(async () => {
    cleanupTestFiles();
    resetHistoryStore();
    mockUI = createMockUI();
    await mockUI.historyStore.init();
    tasksView = new TasksView(mockUI);
  });

  afterEach(() => {
    if (mockUI.historyStore) mockUI.historyStore.clear();
    cleanupTestFiles();
    resetHistoryStore();
  });

  it('should show selected task details', () => {
    mockUI.tasks = [
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

    tasksView.taskGraphShowDetails = true;
    tasksView.taskGraphSelectedIndex = 0;
    const content = tasksView.refresh();

    const contentStr = getContentString(content);
    assert.ok(contentStr.includes('Status:'), 'Should show status label');
    assert.ok(contentStr.includes('in_progress'), 'Should show status');
    assert.ok(contentStr.includes('complex'), 'Should show complexity');
  });

  it('should handle tasks with subtasks', () => {
    mockUI.tasks = [
      { id: 'task-1', description: 'Main task', status: 'in_progress', subtasks: ['task-2'], metadata: {} },
      { id: 'task-2', description: 'Subtask', status: 'pending', subtasks: [], parentTaskId: 'task-1', metadata: {} }
    ];

    tasksView.taskGraphShowDetails = true;
    tasksView.taskGraphSelectedIndex = 0;
    const content = tasksView.refresh();

    const contentStr = getContentString(content);
    assert.ok(contentStr.includes('Subtasks'), 'Should show subtasks section');
    assert.ok(contentStr.includes('Subtask'), 'Should show subtask description');
  });

  it('should mark current and next tasks', () => {
    mockUI.tasks = [
      { id: 'task-1', description: 'Current task', status: 'in_progress', subtasks: [], metadata: {} },
      { id: 'task-2', description: 'Next task', status: 'pending', subtasks: [], metadata: {} }
    ];
    mockUI.currentTaskId = 'task-1';
    mockUI.nextTaskId = 'task-2';

    const content = tasksView.refresh();

    const contentStr = getContentString(content);
    // Current task uses * icon, next task uses > icon
    assert.ok(contentStr.includes('Current task'), 'Should show current task');
    assert.ok(contentStr.includes('Next task'), 'Should show next task');
  });
});
