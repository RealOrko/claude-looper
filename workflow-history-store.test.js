/**
 * Tests for WorkflowHistoryStore
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import {
  WorkflowHistoryStore,
  HistoryEntryTypes,
  getHistoryStore,
  resetHistoryStore
} from './workflow-history-store.js';

// Test directory for file operations
const TEST_STATE_DIR = '.test-claude-looper';
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

describe('WorkflowHistoryStore - Basic Operations', () => {
  let store;

  beforeEach(() => {
    cleanupTestFiles();
    resetHistoryStore();
    store = new WorkflowHistoryStore({
      stateDir: TEST_STATE_DIR,
      retention: {
        maxMemoryEntries: 100,
        maxMemoryAgeMs: 60 * 60 * 1000,
        autoFlushThreshold: 50,
        enableFileRotation: false
      }
    });
  });

  afterEach(() => {
    if (store) {
      store.clear();
    }
    cleanupTestFiles();
    resetHistoryStore();
  });

  it('should initialize store', async () => {
    await store.init();
    assert.strictEqual(store.initialized, true);
  });

  it('should add prompt entries', () => {
    const entry = store.addPrompt('planner', 'Create a plan for task X');
    assert.ok(entry.id);
    assert.strictEqual(entry.type, HistoryEntryTypes.PROMPT);
    assert.strictEqual(entry.data.content, 'Create a plan for task X');
    assert.strictEqual(entry.agentName, 'planner');
    assert.ok(entry.timestamp);
    assert.strictEqual(entry.sequence, 1);
  });

  it('should add response entries', () => {
    const entry = store.addResponse('planner', 'Plan created with 3 tasks', {
      toolCalls: [{ name: 'createTask', input: { description: 'Task 1' } }]
    });
    assert.strictEqual(entry.type, HistoryEntryTypes.RESPONSE);
    assert.strictEqual(entry.data.content, 'Plan created with 3 tasks');
    assert.strictEqual(entry.data.toolCalls.length, 1);
  });

  it('should add event entries', () => {
    const event = {
      type: 'task:added',
      source: 'planner',
      object: { description: 'New task' },
      changeType: 'added'
    };
    const entry = store.addEvent(event);
    assert.strictEqual(entry.type, HistoryEntryTypes.EVENT);
    assert.strictEqual(entry.data.type, 'task:added');
    assert.strictEqual(entry.agentName, 'planner');
  });

  it('should add interaction entries', () => {
    const entry = store.addInteraction('coder', 'tester', {
      content: 'Code implementation complete'
    });
    assert.strictEqual(entry.type, HistoryEntryTypes.INTERACTION);
    assert.strictEqual(entry.data.from, 'coder');
    assert.strictEqual(entry.data.to, 'tester');
  });

  it('should add tool call entries', () => {
    const entry = store.addToolCall('coder', 'Edit', {
      file: 'main.js',
      content: 'new code'
    });
    assert.strictEqual(entry.type, HistoryEntryTypes.TOOL_CALL);
    assert.strictEqual(entry.data.toolName, 'Edit');
  });

  it('should add tool result entries', () => {
    const entry = store.addToolResult('coder', 'Edit', 'File updated successfully');
    assert.strictEqual(entry.type, HistoryEntryTypes.TOOL_RESULT);
    assert.strictEqual(entry.data.result, 'File updated successfully');
  });

  it('should add phase change entries', () => {
    const entry = store.addPhaseChange('execution', 'planning');
    assert.strictEqual(entry.type, HistoryEntryTypes.PHASE_CHANGE);
    assert.strictEqual(entry.data.newPhase, 'execution');
    assert.strictEqual(entry.data.previousPhase, 'planning');
  });

  it('should add task update entries', () => {
    const entry = store.addTaskUpdate('task-123', 'completed', {
      result: 'Task finished'
    });
    assert.strictEqual(entry.type, HistoryEntryTypes.TASK_UPDATE);
    assert.strictEqual(entry.data.taskId, 'task-123');
    assert.strictEqual(entry.data.status, 'completed');
  });
});

describe('WorkflowHistoryStore - Unlimited Storage', () => {
  let store;

  beforeEach(() => {
    cleanupTestFiles();
    resetHistoryStore();
    store = new WorkflowHistoryStore({
      stateDir: TEST_STATE_DIR,
      retention: {
        maxMemoryEntries: 1000,
        autoFlushThreshold: 500
      }
    });
  });

  afterEach(() => {
    if (store) store.clear();
    cleanupTestFiles();
    resetHistoryStore();
  });

  it('should store unlimited prompts and responses without loss', () => {
    for (let i = 0; i < 100; i++) {
      store.addPrompt('agent', `Prompt ${i}`);
      store.addResponse('agent', `Response ${i}`);
    }

    const prompts = store.queryByType(HistoryEntryTypes.PROMPT);
    const responses = store.queryByType(HistoryEntryTypes.RESPONSE);

    assert.strictEqual(prompts.length, 100);
    assert.strictEqual(responses.length, 100);

    // Verify ordering is preserved
    assert.strictEqual(prompts[0].data.content, 'Prompt 0');
    assert.strictEqual(prompts[99].data.content, 'Prompt 99');
  });

  it('should store events beyond 500-event limit', () => {
    const largeStore = new WorkflowHistoryStore({
      stateDir: TEST_STATE_DIR,
      retention: {
        maxMemoryEntries: 10000,
        autoFlushThreshold: 1000
      }
    });

    for (let i = 0; i < 600; i++) {
      largeStore.addEvent({
        type: 'test:event',
        source: 'test',
        object: { index: i }
      });
    }

    const events = largeStore.queryByType(HistoryEntryTypes.EVENT);
    assert.strictEqual(events.length, 600);

    largeStore.clear();
  });

  it('should store agent interactions with full context and timestamps', () => {
    store.setContext({
      workflowName: 'test-workflow',
      phase: 'execution',
      taskId: 'task-1',
      goalId: 'goal-1'
    });

    const entry = store.addInteraction('planner', 'coder', {
      type: 'delegation',
      content: 'Please implement this task',
      toolCalls: [{ name: 'delegate', input: {} }]
    });

    assert.strictEqual(entry.workflowName, 'test-workflow');
    assert.strictEqual(entry.phase, 'execution');
    assert.strictEqual(entry.taskId, 'task-1');
    assert.strictEqual(entry.goalId, 'goal-1');
    assert.ok(entry.timestamp);
    assert.ok(entry.sequence > 0);
  });
});

describe('WorkflowHistoryStore - Querying', () => {
  let store;

  beforeEach(() => {
    cleanupTestFiles();
    resetHistoryStore();
    store = new WorkflowHistoryStore({
      stateDir: TEST_STATE_DIR,
      retention: { maxMemoryEntries: 100, autoFlushThreshold: 50 }
    });

    // Set up test data
    store.setContext({ phase: 'planning', taskId: 'task-1' });
    store.addPrompt('planner', 'Plan prompt 1');
    store.addResponse('planner', 'Plan response 1');

    store.setContext({ phase: 'execution', taskId: 'task-2' });
    store.addPrompt('coder', 'Code prompt 1');
    store.addResponse('coder', 'Code response 1');
    store.addPrompt('coder', 'Code prompt 2');

    store.setContext({ phase: 'verification', taskId: 'task-3' });
    store.addPrompt('tester', 'Test prompt 1');
  });

  afterEach(() => {
    if (store) store.clear();
    cleanupTestFiles();
    resetHistoryStore();
  });

  it('should query by agent name', () => {
    const coderEntries = store.queryByAgent('coder');
    assert.strictEqual(coderEntries.length, 3); // 2 prompts + 1 response

    const plannerEntries = store.queryByAgent('planner');
    assert.strictEqual(plannerEntries.length, 2); // 1 prompt + 1 response
  });

  it('should query by task ID', () => {
    const task1Entries = store.queryByTask('task-1');
    assert.strictEqual(task1Entries.length, 2);

    const task2Entries = store.queryByTask('task-2');
    assert.strictEqual(task2Entries.length, 3);
  });

  it('should query by phase', () => {
    const planningEntries = store.queryByPhase('planning');
    assert.strictEqual(planningEntries.length, 2);

    const executionEntries = store.queryByPhase('execution');
    assert.strictEqual(executionEntries.length, 3);

    const verificationEntries = store.queryByPhase('verification');
    assert.strictEqual(verificationEntries.length, 1);
  });

  it('should query by type', () => {
    const prompts = store.queryByType(HistoryEntryTypes.PROMPT);
    assert.strictEqual(prompts.length, 4);

    const responses = store.queryByType(HistoryEntryTypes.RESPONSE);
    assert.strictEqual(responses.length, 2);
  });

  it('should query by time range', () => {
    const now = Date.now();
    const entries = store.queryByTimeRange(now - 10000, now + 10000);
    assert.strictEqual(entries.length, 6);
  });

  it('should query with multiple filters', () => {
    const results = store.query({
      agentName: 'coder',
      phase: 'execution'
    });
    assert.strictEqual(results.length, 3);

    const typedResults = store.query({
      agentName: 'coder',
      type: HistoryEntryTypes.PROMPT
    });
    assert.strictEqual(typedResults.length, 2);
  });

  it('should support limit and offset options', () => {
    const limited = store.query({}, { limit: 2 });
    assert.strictEqual(limited.length, 2);

    const offset = store.query({}, { offset: 2, limit: 2 });
    assert.strictEqual(offset.length, 2);
    assert.strictEqual(offset[0].sequence, 3);
  });

  it('should support descending order', () => {
    const desc = store.query({}, { order: 'desc' });
    assert.ok(desc[0].sequence > desc[desc.length - 1].sequence);
  });
});

describe('WorkflowHistoryStore - Convenience Methods', () => {
  let store;

  beforeEach(() => {
    cleanupTestFiles();
    resetHistoryStore();
    store = new WorkflowHistoryStore({
      stateDir: TEST_STATE_DIR,
      retention: { maxMemoryEntries: 100, autoFlushThreshold: 50 }
    });

    store.addPrompt('planner', 'Prompt 1');
    store.addResponse('planner', 'Response 1');
    store.addPrompt('planner', 'Prompt 2');
    store.addResponse('planner', 'Response 2');
    store.addEvent({ type: 'test', source: 'core', object: {} });
  });

  afterEach(() => {
    if (store) store.clear();
    cleanupTestFiles();
    resetHistoryStore();
  });

  it('should get agent prompts', () => {
    const prompts = store.getAgentPrompts('planner');
    assert.strictEqual(prompts.length, 2);
    assert.ok(prompts.every(p => p.type === HistoryEntryTypes.PROMPT));
  });

  it('should get agent responses', () => {
    const responses = store.getAgentResponses('planner');
    assert.strictEqual(responses.length, 2);
    assert.ok(responses.every(r => r.type === HistoryEntryTypes.RESPONSE));
  });

  it('should get agent conversation', () => {
    const conversation = store.getAgentConversation('planner');
    assert.strictEqual(conversation.length, 4);
    // Check alternating pattern
    assert.strictEqual(conversation[0].type, HistoryEntryTypes.PROMPT);
    assert.strictEqual(conversation[1].type, HistoryEntryTypes.RESPONSE);
  });

  it('should get all events', () => {
    const events = store.getAllEvents();
    assert.strictEqual(events.length, 1);
  });
});

describe('WorkflowHistoryStore - Memory Retention Policy', () => {
  let store;

  afterEach(() => {
    if (store) store.clear();
    cleanupTestFiles();
    resetHistoryStore();
  });

  it('should enforce max memory entries', () => {
    cleanupTestFiles();
    resetHistoryStore();
    store = new WorkflowHistoryStore({
      stateDir: TEST_STATE_DIR,
      retention: {
        maxMemoryEntries: 10,
        autoFlushThreshold: 100
      }
    });

    // Add 20 entries
    for (let i = 0; i < 20; i++) {
      store.addPrompt('agent', `Prompt ${i}`);
    }

    // Should only keep 10
    const entries = store.query({});
    assert.strictEqual(entries.length, 10);

    // Should keep the newest entries
    assert.strictEqual(entries[0].data.content, 'Prompt 10');
    assert.strictEqual(entries[9].data.content, 'Prompt 19');
  });

  it('should track estimated memory usage', () => {
    cleanupTestFiles();
    resetHistoryStore();
    store = new WorkflowHistoryStore({
      stateDir: TEST_STATE_DIR,
      retention: { maxMemoryEntries: 100, autoFlushThreshold: 50 }
    });

    for (let i = 0; i < 10; i++) {
      store.addPrompt('agent', 'A'.repeat(1000));
    }

    const stats = store.getStats();
    assert.ok(stats.estimatedMemoryBytes > 0);
  });
});

describe('WorkflowHistoryStore - File Persistence', () => {
  let persistentStore;

  beforeEach(async () => {
    cleanupTestFiles();
    resetHistoryStore();
    persistentStore = new WorkflowHistoryStore({
      stateDir: TEST_STATE_DIR,
      retention: {
        maxMemoryEntries: 50,
        autoFlushThreshold: 10,
        enableFileRotation: true
      }
    });
    await persistentStore.init();
  });

  afterEach(() => {
    if (persistentStore) {
      persistentStore.clear();
    }
    cleanupTestFiles();
    resetHistoryStore();
  });

  it('should create history directory on init', async () => {
    assert.ok(fs.existsSync(TEST_HISTORY_DIR));
  });

  it('should export to file', () => {
    persistentStore.addPrompt('agent', 'Test prompt');
    persistentStore.addResponse('agent', 'Test response');

    const exportPath = persistentStore.exportToFile('export-test.json');
    assert.ok(fs.existsSync(exportPath));

    const data = JSON.parse(fs.readFileSync(exportPath, 'utf8'));
    assert.strictEqual(data.version, 1);
    assert.strictEqual(data.entryCount, 2);
    assert.strictEqual(data.entries.length, 2);
  });

  it('should import from file', () => {
    // First export
    persistentStore.addPrompt('agent', 'Test prompt');
    persistentStore.exportToFile('import-test.json');

    // Clear and import
    persistentStore.clear();
    const imported = persistentStore.importFromFile('import-test.json');
    assert.strictEqual(imported, 1);

    const entries = persistentStore.query({});
    assert.strictEqual(entries.length, 1);
    assert.strictEqual(entries[0].data.content, 'Test prompt');
  });
});

describe('WorkflowHistoryStore - Statistics', () => {
  let store;

  beforeEach(() => {
    cleanupTestFiles();
    resetHistoryStore();
    store = new WorkflowHistoryStore({
      stateDir: TEST_STATE_DIR,
      retention: { maxMemoryEntries: 100, autoFlushThreshold: 50 }
    });
  });

  afterEach(() => {
    if (store) store.clear();
    cleanupTestFiles();
    resetHistoryStore();
  });

  it('should provide detailed statistics', () => {
    store.addPrompt('planner', 'Prompt 1');
    store.addPrompt('coder', 'Prompt 2');
    store.addResponse('planner', 'Response 1');
    store.addEvent({ type: 'test', source: 'core', object: {} });

    const stats = store.getStats();

    assert.strictEqual(stats.totalEntries, 4);
    assert.strictEqual(stats.byType[HistoryEntryTypes.PROMPT], 2);
    assert.strictEqual(stats.byType[HistoryEntryTypes.RESPONSE], 1);
    assert.strictEqual(stats.byType[HistoryEntryTypes.EVENT], 1);
    assert.strictEqual(stats.byAgent['planner'], 2);
    assert.strictEqual(stats.byAgent['coder'], 1);
    assert.strictEqual(stats.sequenceCounter, 4);
    assert.ok(stats.retention);
  });
});

describe('WorkflowHistoryStore - Context Management', () => {
  let store;

  beforeEach(() => {
    cleanupTestFiles();
    resetHistoryStore();
    store = new WorkflowHistoryStore({
      stateDir: TEST_STATE_DIR,
      retention: { maxMemoryEntries: 100, autoFlushThreshold: 50 }
    });
  });

  afterEach(() => {
    if (store) store.clear();
    cleanupTestFiles();
    resetHistoryStore();
  });

  it('should inherit context for new entries', () => {
    store.setContext({
      workflowName: 'main-workflow',
      phase: 'planning',
      taskId: 'task-1',
      goalId: 'goal-1'
    });

    const entry = store.addPrompt('planner', 'Test');

    assert.strictEqual(entry.workflowName, 'main-workflow');
    assert.strictEqual(entry.phase, 'planning');
    assert.strictEqual(entry.taskId, 'task-1');
    assert.strictEqual(entry.goalId, 'goal-1');
  });

  it('should allow context override per entry', () => {
    store.setContext({
      phase: 'planning',
      taskId: 'task-1'
    });

    const entry = store.addPrompt('planner', 'Test', {
      taskId: 'task-override'
    });

    assert.strictEqual(entry.taskId, 'task-override');
    assert.strictEqual(entry.phase, 'planning');
  });

  it('should update context on phase change', () => {
    store.addPhaseChange('execution', 'planning');
    const entry = store.addPrompt('coder', 'Test');

    assert.strictEqual(entry.phase, 'execution');
  });
});

describe('WorkflowHistoryStore - Singleton Pattern', () => {
  afterEach(() => {
    cleanupTestFiles();
    resetHistoryStore();
  });

  it('should return same instance', () => {
    resetHistoryStore();
    const store1 = getHistoryStore();
    const store2 = getHistoryStore();
    assert.strictEqual(store1, store2);
  });

  it('should accept options on first call', () => {
    resetHistoryStore();
    const store1 = getHistoryStore({
      stateDir: TEST_STATE_DIR
    });
    assert.strictEqual(store1.stateDir, TEST_STATE_DIR);
  });
});

describe('WorkflowHistoryStore - Clear and Shutdown', () => {
  let store;

  beforeEach(() => {
    cleanupTestFiles();
    resetHistoryStore();
    store = new WorkflowHistoryStore({
      stateDir: TEST_STATE_DIR,
      retention: { maxMemoryEntries: 100, autoFlushThreshold: 50 }
    });
  });

  afterEach(() => {
    cleanupTestFiles();
    resetHistoryStore();
  });

  it('should clear all data', () => {
    store.addPrompt('agent', 'Test');
    store.addResponse('agent', 'Response');

    store.clear();

    assert.strictEqual(store.entries.size, 0);
    assert.strictEqual(store.sequenceCounter, 0);
    assert.strictEqual(store.query({}).length, 0);
  });

  it('should shutdown gracefully', () => {
    store.addPrompt('agent', 'Test');
    store.shutdown();
    // Should not throw
    assert.ok(true);
  });
});

describe('WorkflowHistoryStore - Edge Cases and Error Handling', () => {
  let store;

  beforeEach(() => {
    cleanupTestFiles();
    resetHistoryStore();
    store = new WorkflowHistoryStore({
      stateDir: TEST_STATE_DIR,
      retention: { maxMemoryEntries: 100, autoFlushThreshold: 50 }
    });
  });

  afterEach(() => {
    if (store) store.clear();
    cleanupTestFiles();
    resetHistoryStore();
  });

  it('should handle query for non-existent agent', () => {
    const results = store.queryByAgent('nonexistent');
    assert.deepStrictEqual(results, []);
  });

  it('should handle query for non-existent task', () => {
    const results = store.queryByTask('nonexistent-task');
    assert.deepStrictEqual(results, []);
  });

  it('should handle query for non-existent phase', () => {
    const results = store.queryByPhase('nonexistent-phase');
    assert.deepStrictEqual(results, []);
  });

  it('should handle query for non-existent type', () => {
    const results = store.queryByType('nonexistent-type');
    assert.deepStrictEqual(results, []);
  });

  it('should handle empty time range query', () => {
    store.addPrompt('agent', 'Test');
    // Query for far future time range
    const results = store.queryByTimeRange(Date.now() + 100000, Date.now() + 200000);
    assert.deepStrictEqual(results, []);
  });

  it('should handle query with no matching filters', () => {
    store.addPrompt('agent1', 'Test', { phase: 'planning' });
    const results = store.query({
      agentName: 'agent1',
      phase: 'execution' // Different phase
    });
    assert.deepStrictEqual(results, []);
  });

  it('should handle entry toJSON correctly', () => {
    const entry = store.addPrompt('agent', 'Test prompt', {
      taskId: 'task-1',
      goalId: 'goal-1',
      workflowName: 'workflow-1',
      phase: 'planning'
    });

    const json = entry.toJSON();

    // Verify toJSON preserves all fields
    assert.strictEqual(json.id, entry.id);
    assert.strictEqual(json.type, entry.type);
    assert.strictEqual(json.timestamp, entry.timestamp);
    assert.strictEqual(json.sequence, entry.sequence);
    assert.strictEqual(json.agentName, 'agent');
    assert.strictEqual(json.taskId, 'task-1');
    assert.strictEqual(json.goalId, 'goal-1');
    assert.strictEqual(json.workflowName, 'workflow-1');
    assert.strictEqual(json.phase, 'planning');
    assert.strictEqual(json.data.content, 'Test prompt');
  });

  it('should handle multiple agents with same phase', () => {
    store.setContext({ phase: 'execution' });
    store.addPrompt('coder', 'Coder prompt');
    store.addPrompt('reviewer', 'Reviewer prompt');
    
    const results = store.queryByPhase('execution');
    assert.strictEqual(results.length, 2);
    
    // Both entries should be found
    const agents = results.map(r => r.agentName);
    assert.ok(agents.includes('coder'));
    assert.ok(agents.includes('reviewer'));
  });

  it('should return all entries when query has no filters', () => {
    store.addPrompt('agent', 'Prompt 1');
    store.addResponse('agent', 'Response 1');
    store.addEvent({ type: 'test', source: 'core', object: {} });
    
    const results = store.query({});
    assert.strictEqual(results.length, 3);
  });

  it('should handle getAgentConversation with limit', () => {
    for (let i = 0; i < 10; i++) {
      store.addPrompt('agent', `Prompt ${i}`);
      store.addResponse('agent', `Response ${i}`);
    }
    
    const conversation = store.getAgentConversation('agent', { limit: 4 });
    assert.strictEqual(conversation.length, 4);
    // Should get the last 4 entries
    assert.ok(conversation[0].data.content.includes('8') || conversation[0].data.content.includes('Response'));
  });

  it('should handle index removal when entry is evicted', () => {
    const smallStore = new WorkflowHistoryStore({
      stateDir: TEST_STATE_DIR,
      retention: { maxMemoryEntries: 5, autoFlushThreshold: 100 }
    });
    
    // Add entries that will be evicted
    for (let i = 0; i < 10; i++) {
      smallStore.addPrompt('agent', `Prompt ${i}`, { phase: 'phase-' + i });
    }
    
    // Verify old entries are not in index
    const oldPhaseResults = smallStore.queryByPhase('phase-0');
    assert.strictEqual(oldPhaseResults.length, 0);
    
    smallStore.clear();
  });
});

describe('WorkflowHistoryStore - Age-based Retention', () => {
  afterEach(() => {
    cleanupTestFiles();
    resetHistoryStore();
  });

  it('should evict entries older than maxMemoryAgeMs', async () => {
    const store = new WorkflowHistoryStore({
      stateDir: TEST_STATE_DIR,
      retention: {
        maxMemoryEntries: 1000,
        maxMemoryAgeMs: 100, // 100ms for quick testing
        autoFlushThreshold: 1000
      }
    });
    
    store.addPrompt('agent', 'Old prompt');
    
    // Wait for entry to expire
    await new Promise(resolve => setTimeout(resolve, 150));
    
    // Add new entry to trigger retention check
    store.addPrompt('agent', 'New prompt');
    
    const entries = store.query({});
    assert.strictEqual(entries.length, 1);
    assert.strictEqual(entries[0].data.content, 'New prompt');
    
    store.clear();
  });
});

describe('WorkflowHistoryStore - File Operations', () => {
  afterEach(() => {
    cleanupTestFiles();
    resetHistoryStore();
  });

  it('should handle import of non-duplicate entries', async () => {
    const store = new WorkflowHistoryStore({
      stateDir: TEST_STATE_DIR,
      retention: { maxMemoryEntries: 100, autoFlushThreshold: 50, enableFileRotation: true }
    });
    await store.init();
    
    store.addPrompt('agent', 'Original prompt');
    const exportPath = store.exportToFile('duplicate-test.json');
    
    // Try to import same entries again
    const imported = store.importFromFile('duplicate-test.json');
    
    // Should not import duplicates
    assert.strictEqual(imported, 0);
    
    store.clear();
  });

  it('should update sequence counter on import', async () => {
    const store = new WorkflowHistoryStore({
      stateDir: TEST_STATE_DIR,
      retention: { maxMemoryEntries: 100, autoFlushThreshold: 50, enableFileRotation: true }
    });
    await store.init();
    
    store.addPrompt('agent', 'Prompt 1');
    store.addPrompt('agent', 'Prompt 2');
    store.exportToFile('sequence-test.json');
    
    // Create new store and import
    store.clear();
    const newStore = new WorkflowHistoryStore({
      stateDir: TEST_STATE_DIR,
      retention: { maxMemoryEntries: 100, autoFlushThreshold: 50, enableFileRotation: true }
    });
    await newStore.init();
    
    newStore.importFromFile('sequence-test.json');
    
    // Sequence counter should be updated
    assert.ok(newStore.sequenceCounter >= 2);
    
    newStore.clear();
  });

  it('should handle disabled file rotation', () => {
    const store = new WorkflowHistoryStore({
      stateDir: TEST_STATE_DIR,
      retention: {
        maxMemoryEntries: 10,
        autoFlushThreshold: 5,
        enableFileRotation: false
      }
    });
    
    // Add more than flush threshold
    for (let i = 0; i < 20; i++) {
      store.addPrompt('agent', `Prompt ${i}`);
    }
    
    // Should not have created any history files
    assert.strictEqual(store.fileManifest.length, 0);
    
    store.clear();
  });
});

describe('WorkflowHistoryStore - Index Statistics', () => {
  afterEach(() => {
    cleanupTestFiles();
    resetHistoryStore();
  });

  it('should provide index statistics', () => {
    const store = new WorkflowHistoryStore({
      stateDir: TEST_STATE_DIR,
      retention: { maxMemoryEntries: 100, autoFlushThreshold: 50 }
    });
    
    store.addPrompt('agent1', 'Prompt', { phase: 'planning', taskId: 'task-1' });
    store.addPrompt('agent2', 'Prompt', { phase: 'execution', taskId: 'task-2' });
    
    const stats = store.getStats();
    
    assert.strictEqual(stats.indexStats.agents, 2);
    assert.strictEqual(stats.indexStats.tasks, 2);
    assert.strictEqual(stats.indexStats.phases, 2);
    assert.strictEqual(stats.indexStats.types, 1); // Only PROMPT type
    assert.strictEqual(stats.indexStats.timeRangeEntries, 2);
    
    store.clear();
  });
});
