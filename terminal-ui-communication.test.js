/**
 * Tests for terminal-ui-communication.js - CommunicationView component
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import { CommunicationView } from './terminal-ui-communication.js';
import { WorkflowHistoryStore, resetHistoryStore } from './workflow-history-store.js';

// Test directory for file operations
const TEST_STATE_DIR = '.test-ui-comm-claude-looper';
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
      mainPanel: { width: 100 }
    },
    screen: {
      render: () => {}
    },
    _renderCurrentView: () => {}
  };
}

describe('CommunicationView - Initialization', () => {
  let mockUI;
  let commView;

  beforeEach(async () => {
    cleanupTestFiles();
    resetHistoryStore();
    mockUI = createMockUI();
    await mockUI.historyStore.init();
    commView = new CommunicationView(mockUI);
  });

  afterEach(() => {
    if (mockUI.historyStore) mockUI.historyStore.clear();
    cleanupTestFiles();
    resetHistoryStore();
  });

  it('should initialize communication view state', () => {
    assert.strictEqual(commView.commFilterAgent, null);
    assert.strictEqual(commView.commFilterType, null);
    assert.strictEqual(commView.commSelectedIndex, 0);
    assert.ok(Array.isArray(commView.commInteractionList));
  });
});

describe('CommunicationView - Empty State', () => {
  let mockUI;
  let commView;

  beforeEach(async () => {
    cleanupTestFiles();
    resetHistoryStore();
    mockUI = createMockUI();
    await mockUI.historyStore.init();
    commView = new CommunicationView(mockUI);
  });

  afterEach(() => {
    if (mockUI.historyStore) mockUI.historyStore.clear();
    cleanupTestFiles();
    resetHistoryStore();
  });

  it('should display empty state when no communications', () => {
    const content = commView.refresh();

    const contentStr = content.join('\n');
    assert.ok(contentStr.includes('No agent communications') || contentStr.includes('communications'), 'Should show empty state');
  });
});

describe('CommunicationView - Gathering Entries', () => {
  let mockUI;
  let commView;

  beforeEach(async () => {
    cleanupTestFiles();
    resetHistoryStore();
    mockUI = createMockUI();
    await mockUI.historyStore.init();
    commView = new CommunicationView(mockUI);
  });

  afterEach(() => {
    if (mockUI.historyStore) mockUI.historyStore.clear();
    cleanupTestFiles();
    resetHistoryStore();
  });

  it('should gather all communication entry types', () => {
    mockUI.historyStore.addPrompt('planner', 'Create a plan');
    mockUI.historyStore.addResponse('planner', 'Here is the plan');
    mockUI.historyStore.addInteraction('planner', 'coder', { type: 'delegation', content: 'Implement' });
    mockUI.historyStore.addToolCall('coder', 'Read', { file: 'test.js' });
    mockUI.historyStore.addToolResult('coder', 'Read', { content: 'file content' });
    mockUI.historyStore.addPhaseChange('execution', 'planning');

    const entries = commView._gatherCommunicationEntries();

    assert.strictEqual(entries.length, 6, 'Should gather all 6 entries');
    const types = entries.map(e => e.entryType);
    assert.ok(types.includes('prompt'), 'Should include prompts');
    assert.ok(types.includes('response'), 'Should include responses');
    assert.ok(types.includes('interaction'), 'Should include interactions');
    assert.ok(types.includes('tool_call'), 'Should include tool calls');
    assert.ok(types.includes('tool_result'), 'Should include tool results');
    assert.ok(types.includes('phase_change'), 'Should include phase changes');
  });

  it('should show chronological order of messages', () => {
    mockUI.historyStore.addPrompt('planner', 'First message');
    mockUI.historyStore.addResponse('planner', 'Second message');
    mockUI.historyStore.addPrompt('coder', 'Third message');

    commView.refresh();

    // Entries should be in order by sequence
    assert.strictEqual(commView.commInteractionList.length, 3);
    assert.ok(commView.commInteractionList[0].sequence < commView.commInteractionList[1].sequence);
    assert.ok(commView.commInteractionList[1].sequence < commView.commInteractionList[2].sequence);
  });
});

describe('CommunicationView - Displaying Entries', () => {
  let mockUI;
  let commView;

  beforeEach(async () => {
    cleanupTestFiles();
    resetHistoryStore();
    mockUI = createMockUI();
    await mockUI.historyStore.init();
    commView = new CommunicationView(mockUI);
  });

  afterEach(() => {
    if (mockUI.historyStore) mockUI.historyStore.clear();
    cleanupTestFiles();
    resetHistoryStore();
  });

  it('should display prompts with sender agent', () => {
    mockUI.historyStore.addPrompt('planner', 'What should we build?');

    const content = commView.refresh();

    const contentStr = content.join('\n');
    // Uses <- for prompts in list view
    assert.ok(contentStr.includes('<-') || contentStr.includes('PROMPT'), 'Should show prompt indicator');
    assert.ok(contentStr.includes('planner'), 'Should show agent name');
  });

  it('should display responses with agent name', () => {
    mockUI.historyStore.addPrompt('coder', 'Implement the feature');
    mockUI.historyStore.addResponse('coder', 'Feature implemented successfully');

    const content = commView.refresh();

    const contentStr = content.join('\n');
    // Uses -> for responses in list view
    assert.ok(contentStr.includes('->') || contentStr.includes('RESPONSE'), 'Should show response indicator');
    assert.ok(contentStr.includes('coder'), 'Should show agent name');
  });

  it('should display interactions with sender and receiver', () => {
    mockUI.historyStore.addInteraction('planner', 'coder', {
      type: 'delegation',
      content: 'Please implement this feature'
    });

    const content = commView.refresh();

    const contentStr = content.join('\n');
    assert.ok(contentStr.includes('planner') || contentStr.includes('coder'), 'Should show agents');
  });

  it('should format tool calls', () => {
    mockUI.historyStore.addToolCall('coder', 'Edit', { file_path: '/path/to/file.js', old_string: 'old', new_string: 'new' });

    const content = commView.refresh();

    const contentStr = content.join('\n');
    assert.ok(contentStr.includes('TOOL') || contentStr.includes('Edit'), 'Should show tool call');
  });
});

describe('CommunicationView - Tool Call Linking', () => {
  let mockUI;
  let commView;

  beforeEach(async () => {
    cleanupTestFiles();
    resetHistoryStore();
    mockUI = createMockUI();
    await mockUI.historyStore.init();
    commView = new CommunicationView(mockUI);
  });

  afterEach(() => {
    if (mockUI.historyStore) mockUI.historyStore.clear();
    cleanupTestFiles();
    resetHistoryStore();
  });

  it('should link tool results to their corresponding calls', () => {
    mockUI.historyStore.addToolCall('coder', 'Read', { file: 'test.js' });
    mockUI.historyStore.addToolResult('coder', 'Read', { content: 'file content here' });

    const entries = commView._gatherCommunicationEntries();
    const linked = commView.linkToolCallsAndResults(entries);

    const toolCall = linked.find(e => e.entryType === 'tool_call');
    const toolResult = linked.find(e => e.entryType === 'tool_result');

    assert.ok(toolCall.linkedToolResult, 'Tool call should have linked result');
    assert.ok(toolResult.linkedToolCall, 'Tool result should have linked call');
    assert.strictEqual(toolCall.linkedToolResult.sequence, toolResult.sequence);
  });

  it('should handle multiple tool calls to same tool correctly', () => {
    mockUI.historyStore.addToolCall('coder', 'Read', { file: 'a.js' });
    mockUI.historyStore.addToolResult('coder', 'Read', { content: 'content a' });
    mockUI.historyStore.addToolCall('coder', 'Read', { file: 'b.js' });
    mockUI.historyStore.addToolResult('coder', 'Read', { content: 'content b' });

    const entries = commView._gatherCommunicationEntries();
    const linked = commView.linkToolCallsAndResults(entries);

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
});

describe('CommunicationView - Filtering', () => {
  let mockUI;
  let commView;

  beforeEach(async () => {
    cleanupTestFiles();
    resetHistoryStore();
    mockUI = createMockUI();
    await mockUI.historyStore.init();
    commView = new CommunicationView(mockUI);
  });

  afterEach(() => {
    if (mockUI.historyStore) mockUI.historyStore.clear();
    cleanupTestFiles();
    resetHistoryStore();
  });

  it('should filter by specific agent', () => {
    mockUI.historyStore.addPrompt('planner', 'Planner message');
    mockUI.historyStore.addPrompt('coder', 'Coder message');
    mockUI.historyStore.addPrompt('tester', 'Tester message');

    commView.commFilterAgent = 'coder';
    commView.refresh();

    assert.strictEqual(commView.commInteractionList.length, 1, 'Should only show coder messages');
    assert.strictEqual(commView.commInteractionList[0].agentName, 'coder');
  });

  it('should filter by interaction type', () => {
    mockUI.historyStore.addPrompt('planner', 'A prompt');
    mockUI.historyStore.addResponse('planner', 'A response');
    mockUI.historyStore.addToolCall('coder', 'Read', { file: 'test.js' });

    commView.commFilterType = 'prompt';
    commView.refresh();

    assert.strictEqual(commView.commInteractionList.length, 1, 'Should only show prompts');
    assert.strictEqual(commView.commInteractionList[0].entryType, 'prompt');
  });

  it('should combine agent and type filters', () => {
    mockUI.historyStore.addPrompt('planner', 'Planner prompt');
    mockUI.historyStore.addPrompt('coder', 'Coder prompt');
    mockUI.historyStore.addResponse('coder', 'Coder response');

    commView.commFilterAgent = 'coder';
    commView.commFilterType = 'prompt';
    commView.refresh();

    assert.strictEqual(commView.commInteractionList.length, 1);
    assert.strictEqual(commView.commInteractionList[0].agentName, 'coder');
    assert.strictEqual(commView.commInteractionList[0].entryType, 'prompt');
  });

  it('should filter interactions by sender or receiver agent', () => {
    mockUI.historyStore.addInteraction('planner', 'coder', { type: 'delegation', content: 'Task 1' });
    mockUI.historyStore.addInteraction('coder', 'tester', { type: 'handoff', content: 'Task 2' });

    // Filter by 'coder' should match both (as sender and receiver)
    commView.commFilterAgent = 'coder';
    const entries = commView._gatherCommunicationEntries();
    const filtered = commView._filterCommunicationEntries(entries);

    assert.strictEqual(filtered.length, 2, 'Should match interactions where coder is sender or receiver');
  });

  it('should clear filters correctly', () => {
    mockUI.historyStore.addPrompt('planner', 'Test 1');
    mockUI.historyStore.addPrompt('coder', 'Test 2');

    commView.commFilterAgent = 'planner';
    commView.commFilterType = 'prompt';
    commView.refresh();
    assert.strictEqual(commView.commInteractionList.length, 1);

    // Clear filters
    commView.commFilterAgent = null;
    commView.commFilterType = null;
    commView.refresh();
    assert.strictEqual(commView.commInteractionList.length, 2, 'Should show all after clearing');
  });
});

describe('CommunicationView - Navigation', () => {
  let mockUI;
  let commView;

  beforeEach(async () => {
    cleanupTestFiles();
    resetHistoryStore();
    mockUI = createMockUI();
    await mockUI.historyStore.init();
    commView = new CommunicationView(mockUI);
  });

  afterEach(() => {
    if (mockUI.historyStore) mockUI.historyStore.clear();
    cleanupTestFiles();
    resetHistoryStore();
  });

  it('should track selected index for navigation', () => {
    mockUI.historyStore.addPrompt('planner', 'First');
    mockUI.historyStore.addPrompt('coder', 'Second');
    mockUI.historyStore.addPrompt('tester', 'Third');

    commView.refresh();
    assert.strictEqual(commView.commSelectedIndex, 0);

    commView.commSelectedIndex = 1;
    assert.strictEqual(commView.commSelectedIndex, 1);

    commView.commSelectedIndex = 2;
    assert.strictEqual(commView.commSelectedIndex, 2);
  });

  it('should adjust selected index when filtered list shrinks', () => {
    mockUI.historyStore.addPrompt('planner', 'First');
    mockUI.historyStore.addPrompt('coder', 'Second');
    mockUI.historyStore.addPrompt('tester', 'Third');

    commView.refresh();
    commView.commSelectedIndex = 2; // Select last item

    // Apply filter that reduces list
    commView.commFilterAgent = 'planner';
    commView.refresh();

    // Selected index should adjust to stay in bounds
    assert.ok(commView.commSelectedIndex <= commView.commInteractionList.length - 1);
  });
});

describe('CommunicationView - Phase Changes', () => {
  let mockUI;
  let commView;

  beforeEach(async () => {
    cleanupTestFiles();
    resetHistoryStore();
    mockUI = createMockUI();
    await mockUI.historyStore.init();
    commView = new CommunicationView(mockUI);
  });

  afterEach(() => {
    if (mockUI.historyStore) mockUI.historyStore.clear();
    cleanupTestFiles();
    resetHistoryStore();
  });

  it('should correlate phase changes with message timeline', () => {
    mockUI.historyStore.addPhaseChange('planning', null);
    mockUI.historyStore.addPrompt('planner', 'Creating plan');
    mockUI.historyStore.addPhaseChange('execution', 'planning');
    mockUI.historyStore.addPrompt('coder', 'Executing plan');

    commView.refresh();

    // Should have entries for phases and prompts
    assert.ok(commView.commInteractionList.length >= 4, 'Should have phase and prompt entries');
  });

  it('should preserve entries across workflow phases', () => {
    mockUI.historyStore.addPhaseChange('planning', null);
    mockUI.historyStore.addPrompt('planner', 'Planning phase prompt');
    mockUI.historyStore.addPhaseChange('execution', 'planning');
    mockUI.historyStore.addPrompt('coder', 'Execution phase prompt');
    mockUI.historyStore.addPhaseChange('verification', 'execution');
    mockUI.historyStore.addPrompt('tester', 'Verification phase prompt');

    commView.refresh();

    // All entries should be present
    assert.ok(commView.commInteractionList.length >= 6, 'Should have all entries from all phases');

    const content = commView.refresh();
    const contentStr = content.join('\n');
    assert.ok(contentStr.includes('planner'), 'Should include planner entries');
    assert.ok(contentStr.includes('coder'), 'Should include coder entries');
    assert.ok(contentStr.includes('tester'), 'Should include tester entries');
  });
});
