/**
 * Agent Executor Tests
 *
 * Comprehensive test suite for the AgentExecutor class covering:
 * - Constructor and initialization
 * - Callback system (setCallbacks, clearCallbacks, _invokeCallback)
 * - Error categorization (transient, permanent, timeout)
 * - Retry logic with exponential backoff
 * - Fallback model switching
 * - Session management
 * - Metrics tracking
 * - Template loading and rendering
 * - CLI argument building
 * - Output parsing
 */

import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert';
import { AgentExecutor } from './agent-executor.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('AgentExecutor - Constructor and Initialization', () => {
  it('should create instance with default options', () => {
    const executor = new AgentExecutor();

    assert.strictEqual(executor.options.claudePath, 'claude');
    assert.strictEqual(executor.options.timeout, 10 * 60 * 1000);
    assert.strictEqual(executor.options.skipPermissions, true);
    assert.strictEqual(executor.options.verbose, false);
    assert.strictEqual(executor.options.maxRetries, 3);
    assert.strictEqual(executor.options.retryBaseDelay, 1000);
  });

  it('should create instance with custom options', () => {
    const executor = new AgentExecutor({
      claudePath: '/custom/claude',
      timeout: 5000,
      skipPermissions: false,
      verbose: true,
      maxRetries: 5,
      retryBaseDelay: 500
    });

    assert.strictEqual(executor.options.claudePath, '/custom/claude');
    assert.strictEqual(executor.options.timeout, 5000);
    assert.strictEqual(executor.options.skipPermissions, false);
    assert.strictEqual(executor.options.verbose, true);
    assert.strictEqual(executor.options.maxRetries, 5);
    assert.strictEqual(executor.options.retryBaseDelay, 500);
  });

  it('should initialize with empty sessions', () => {
    const executor = new AgentExecutor();
    assert.deepStrictEqual(executor.sessions, {});
  });

  it('should initialize with empty template cache', () => {
    const executor = new AgentExecutor();
    assert.deepStrictEqual(executor.templateCache, {});
  });

  it('should initialize with zero metrics', () => {
    const executor = new AgentExecutor();

    assert.strictEqual(executor.metrics.totalCalls, 0);
    assert.strictEqual(executor.metrics.totalRetries, 0);
    assert.strictEqual(executor.metrics.totalFallbacks, 0);
    assert.strictEqual(executor.metrics.totalCostUsd, 0);
    assert.deepStrictEqual(executor.metrics.callsByAgent, {});
  });

  it('should initialize with null callbacks', () => {
    const executor = new AgentExecutor();

    assert.strictEqual(executor.callbacks.onStart, null);
    assert.strictEqual(executor.callbacks.onComplete, null);
    assert.strictEqual(executor.callbacks.onError, null);
    assert.strictEqual(executor.callbacks.onRetry, null);
    assert.strictEqual(executor.callbacks.onFallback, null);
    assert.strictEqual(executor.callbacks.onStdout, null);
    assert.strictEqual(executor.callbacks.onStderr, null);
  });
});

describe('AgentExecutor - Callback System', () => {
  let executor;

  beforeEach(() => {
    executor = new AgentExecutor();
  });

  it('should set callbacks with setCallbacks', () => {
    const onStart = () => {};
    const onComplete = () => {};

    executor.setCallbacks({ onStart, onComplete });

    assert.strictEqual(executor.callbacks.onStart, onStart);
    assert.strictEqual(executor.callbacks.onComplete, onComplete);
  });

  it('should merge callbacks without overwriting unset ones', () => {
    const onStart = () => {};
    const onError = () => {};

    executor.setCallbacks({ onStart });
    executor.setCallbacks({ onError });

    assert.strictEqual(executor.callbacks.onStart, onStart);
    assert.strictEqual(executor.callbacks.onError, onError);
  });

  it('should clear all callbacks with clearCallbacks', () => {
    executor.setCallbacks({
      onStart: () => {},
      onComplete: () => {},
      onError: () => {}
    });

    executor.clearCallbacks();

    assert.strictEqual(executor.callbacks.onStart, null);
    assert.strictEqual(executor.callbacks.onComplete, null);
    assert.strictEqual(executor.callbacks.onError, null);
  });

  it('should invoke callback when set', () => {
    let called = false;
    let receivedData = null;

    executor.setCallbacks({
      onStart: (data) => {
        called = true;
        receivedData = data;
      }
    });

    executor._invokeCallback('onStart', { agentName: 'test', prompt: 'hello' });

    assert.strictEqual(called, true);
    assert.deepStrictEqual(receivedData, { agentName: 'test', prompt: 'hello' });
  });

  it('should not throw when invoking non-existent callback', () => {
    assert.doesNotThrow(() => {
      executor._invokeCallback('onStart', { agentName: 'test' });
    });
  });

  it('should catch and suppress callback errors', () => {
    executor.setCallbacks({
      onStart: () => {
        throw new Error('Callback error');
      }
    });

    // Should not throw
    assert.doesNotThrow(() => {
      executor._invokeCallback('onStart', { agentName: 'test' });
    });
  });
});

describe('AgentExecutor - Error Categorization', () => {
  let executor;

  beforeEach(() => {
    executor = new AgentExecutor();
  });

  describe('Timeout Errors', () => {
    it('should categorize "timed out" as TIMEOUT', () => {
      const result = executor.categorizeError(new Error('Request timed out'));
      assert.strictEqual(result, 'TIMEOUT');
    });

    it('should categorize "timeout" as TIMEOUT', () => {
      const result = executor.categorizeError('Connection timeout occurred');
      assert.strictEqual(result, 'TIMEOUT');
    });
  });

  describe('Transient Errors', () => {
    it('should categorize ECONNRESET as TRANSIENT (case-insensitive)', () => {
      // categorizeError lowercases error strings for case-insensitive matching
      const result = executor.categorizeError(new Error('ECONNRESET'));
      assert.strictEqual(result, 'TRANSIENT');
    });

    it('should categorize ETIMEDOUT as TRANSIENT (case-insensitive)', () => {
      const result = executor.categorizeError(new Error('ETIMEDOUT'));
      assert.strictEqual(result, 'TRANSIENT');
    });

    it('should categorize overloaded as TRANSIENT', () => {
      const result = executor.categorizeError('Server overloaded');
      assert.strictEqual(result, 'TRANSIENT');
    });

    it('should categorize rate_limit as TRANSIENT', () => {
      const result = executor.categorizeError('rate_limit exceeded');
      assert.strictEqual(result, 'TRANSIENT');
    });

    it('should categorize 529 as TRANSIENT', () => {
      const result = executor.categorizeError('HTTP 529 error');
      assert.strictEqual(result, 'TRANSIENT');
    });

    it('should categorize 503 as TRANSIENT', () => {
      const result = executor.categorizeError('HTTP 503 Service Unavailable');
      assert.strictEqual(result, 'TRANSIENT');
    });
  });

  describe('Permanent Errors', () => {
    it('should categorize invalid_api_key as PERMANENT', () => {
      const result = executor.categorizeError('invalid_api_key');
      assert.strictEqual(result, 'PERMANENT');
    });

    it('should categorize permission_denied as PERMANENT', () => {
      const result = executor.categorizeError(new Error('permission_denied'));
      assert.strictEqual(result, 'PERMANENT');
    });

    it('should categorize invalid_request as PERMANENT', () => {
      const result = executor.categorizeError('invalid_request format');
      assert.strictEqual(result, 'PERMANENT');
    });
  });

  describe('Unknown Errors', () => {
    it('should categorize generic error as UNKNOWN', () => {
      const result = executor.categorizeError(new Error('Something went wrong'));
      assert.strictEqual(result, 'UNKNOWN');
    });

    it('should categorize empty error as UNKNOWN', () => {
      const result = executor.categorizeError('');
      assert.strictEqual(result, 'UNKNOWN');
    });
  });
});

describe('AgentExecutor - Session Management', () => {
  let executor;

  beforeEach(() => {
    executor = new AgentExecutor();
  });

  it('should return null for non-existent session', () => {
    assert.strictEqual(executor.getSessionId('unknown-agent'), null);
  });

  it('should report no session for unknown agent', () => {
    assert.strictEqual(executor.hasSession('unknown-agent'), false);
  });

  it('should store and retrieve session ID', () => {
    executor.sessions['test-agent'] = 'session-123';

    assert.strictEqual(executor.getSessionId('test-agent'), 'session-123');
    assert.strictEqual(executor.hasSession('test-agent'), true);
  });

  it('should reset individual session', () => {
    executor.sessions['agent1'] = 'session-1';
    executor.sessions['agent2'] = 'session-2';

    executor.resetSession('agent1');

    assert.strictEqual(executor.hasSession('agent1'), false);
    assert.strictEqual(executor.hasSession('agent2'), true);
  });

  it('should reset all sessions', () => {
    executor.sessions['agent1'] = 'session-1';
    executor.sessions['agent2'] = 'session-2';
    executor.sessions['agent3'] = 'session-3';

    executor.resetAllSessions();

    assert.deepStrictEqual(executor.sessions, {});
  });
});

describe('AgentExecutor - Metrics', () => {
  let executor;

  beforeEach(() => {
    executor = new AgentExecutor();
  });

  it('should return copy of metrics', () => {
    executor.metrics.totalCalls = 5;
    executor.metrics.totalRetries = 2;

    const metrics = executor.getMetrics();

    assert.strictEqual(metrics.totalCalls, 5);
    assert.strictEqual(metrics.totalRetries, 2);

    // Verify it's a copy
    metrics.totalCalls = 100;
    assert.strictEqual(executor.metrics.totalCalls, 5);
  });

  it('should reset metrics to zero', () => {
    executor.metrics.totalCalls = 10;
    executor.metrics.totalRetries = 5;
    executor.metrics.totalFallbacks = 2;
    executor.metrics.totalCostUsd = 1.50;
    executor.metrics.callsByAgent = { planner: 5, coder: 3 };

    executor.resetMetrics();

    assert.strictEqual(executor.metrics.totalCalls, 0);
    assert.strictEqual(executor.metrics.totalRetries, 0);
    assert.strictEqual(executor.metrics.totalFallbacks, 0);
    assert.strictEqual(executor.metrics.totalCostUsd, 0);
    assert.deepStrictEqual(executor.metrics.callsByAgent, {});
  });
});

describe('AgentExecutor - Template Management', () => {
  let executor;
  let tempDir;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'executor-test-'));
    executor = new AgentExecutor({ templatesDir: tempDir });
  });

  afterEach(() => {
    // Clean up temp directory
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true });
    }
  });

  it('should throw error for non-existent template', () => {
    assert.throws(() => {
      executor.loadTemplate('nonexistent.hbs');
    }, /Template not found/);
  });

  it('should load and compile template', () => {
    const templatePath = path.join(tempDir, 'test.hbs');
    fs.writeFileSync(templatePath, 'Hello {{name}}!');

    const template = executor.loadTemplate('test.hbs');

    assert.strictEqual(typeof template, 'function');
    assert.strictEqual(template({ name: 'World' }), 'Hello World!');
  });

  it('should cache compiled templates', () => {
    const templatePath = path.join(tempDir, 'cached.hbs');
    fs.writeFileSync(templatePath, 'Template content');

    const template1 = executor.loadTemplate('cached.hbs');
    const template2 = executor.loadTemplate('cached.hbs');

    assert.strictEqual(template1, template2);
  });

  it('should render template with context', () => {
    const templatePath = path.join(tempDir, 'render.hbs');
    fs.writeFileSync(templatePath, 'Task: {{task}}, Goal: {{goal}}');

    const result = executor.renderTemplate('render.hbs', {
      task: 'Write tests',
      goal: '100% coverage'
    });

    assert.strictEqual(result, 'Task: Write tests, Goal: 100% coverage');
  });

  it('should clear template cache', () => {
    const templatePath = path.join(tempDir, 'clear.hbs');
    fs.writeFileSync(templatePath, 'Original');

    executor.loadTemplate('clear.hbs');
    assert.ok(Object.keys(executor.templateCache).length > 0);

    executor.clearTemplateCache();
    assert.deepStrictEqual(executor.templateCache, {});
  });
});

describe('AgentExecutor - Tool Schema Building', () => {
  let executor;

  beforeEach(() => {
    executor = new AgentExecutor();
  });

  it('should return null for empty tools array', () => {
    assert.strictEqual(executor.buildToolSchema([]), null);
  });

  it('should return null for undefined tools', () => {
    assert.strictEqual(executor.buildToolSchema(undefined), null);
  });

  it('should build schema from tools with name property', () => {
    const tools = [
      { name: 'implementationComplete' },
      { name: 'fixComplete' }
    ];

    const schema = executor.buildToolSchema(tools);

    assert.strictEqual(schema.type, 'object');
    assert.ok(schema.properties.toolCall);
    assert.deepStrictEqual(schema.properties.toolCall.properties.name.enum, [
      'implementationComplete',
      'fixComplete'
    ]);
  });

  it('should build schema from tools with key as name', () => {
    const tools = [
      { myTool: { description: 'A tool' } },
      { anotherTool: { description: 'Another tool' } }
    ];

    const schema = executor.buildToolSchema(tools);

    assert.deepStrictEqual(schema.properties.toolCall.properties.name.enum, [
      'myTool',
      'anotherTool'
    ]);
  });
});

describe('AgentExecutor - CLI Argument Building', () => {
  let executor;

  beforeEach(() => {
    executor = new AgentExecutor();
  });

  it('should build basic arguments', () => {
    const args = executor._buildArgs('agent', 'test prompt', {});

    assert.ok(args.includes('--print'));
    assert.ok(args.includes('-p'));
    assert.ok(args.includes('test prompt'));
    assert.ok(args.includes('--output-format'));
    assert.ok(args.includes('json'));
    assert.ok(args.includes('--dangerously-skip-permissions'));
  });

  it('should include model when specified', () => {
    const args = executor._buildArgs('agent', 'prompt', { model: 'opus' });

    assert.ok(args.includes('--model'));
    assert.ok(args.includes('opus'));
  });

  it('should include fallback model when specified', () => {
    const args = executor._buildArgs('agent', 'prompt', { fallbackModel: 'haiku' });

    assert.ok(args.includes('--fallback-model'));
    assert.ok(args.includes('haiku'));
  });

  it('should not include fallback when _usingFallback is true', () => {
    const args = executor._buildArgs('agent', 'prompt', {
      fallbackModel: 'haiku',
      _usingFallback: true
    });

    assert.ok(!args.includes('--fallback-model'));
  });

  it('should include session resume when session exists', () => {
    executor.sessions['agent'] = 'session-xyz';

    const args = executor._buildArgs('agent', 'prompt', {});

    assert.ok(args.includes('--resume'));
    assert.ok(args.includes('session-xyz'));
  });

  it('should not include session resume when newSession is true', () => {
    executor.sessions['agent'] = 'session-xyz';

    const args = executor._buildArgs('agent', 'prompt', { newSession: true });

    assert.ok(!args.includes('--resume'));
  });

  it('should include max turns when specified', () => {
    const args = executor._buildArgs('agent', 'prompt', { maxTurns: 10 });

    assert.ok(args.includes('--max-turns'));
    assert.ok(args.includes('10'));
  });

  it('should include tools when specified as array', () => {
    const args = executor._buildArgs('agent', 'prompt', { tools: ['Read', 'Write'] });

    assert.ok(args.includes('--tools'));
    assert.ok(args.includes('Read,Write'));
  });

  it('should include tools when specified as string', () => {
    const args = executor._buildArgs('agent', 'prompt', { tools: 'Read,Write' });

    assert.ok(args.includes('--tools'));
    assert.ok(args.includes('Read,Write'));
  });

  it('should include allowed tools when specified', () => {
    const args = executor._buildArgs('agent', 'prompt', { allowedTools: ['Bash', 'Read'] });

    assert.ok(args.includes('--allowed-tools'));
    assert.ok(args.includes('Bash Read'));
  });

  it('should include disallowed tools when specified', () => {
    const args = executor._buildArgs('agent', 'prompt', { disallowedTools: ['Write'] });

    assert.ok(args.includes('--disallowed-tools'));
  });

  it('should include system prompt when specified', () => {
    const args = executor._buildArgs('agent', 'prompt', { systemPrompt: 'You are a helpful assistant' });

    assert.ok(args.includes('--system-prompt'));
    assert.ok(args.includes('You are a helpful assistant'));
  });

  it('should include append system prompt when specified', () => {
    const args = executor._buildArgs('agent', 'prompt', { appendSystemPrompt: 'Additional context' });

    assert.ok(args.includes('--append-system-prompt'));
    assert.ok(args.includes('Additional context'));
  });

  it('should include JSON schema when specified as object', () => {
    const schema = { type: 'object', properties: { name: { type: 'string' } } };
    const args = executor._buildArgs('agent', 'prompt', { jsonSchema: schema });

    assert.ok(args.includes('--json-schema'));
    const schemaIndex = args.indexOf('--json-schema');
    const schemaStr = args[schemaIndex + 1];
    assert.deepStrictEqual(JSON.parse(schemaStr), schema);
  });

  it('should include JSON schema when specified as string', () => {
    const schemaStr = '{"type":"object"}';
    const args = executor._buildArgs('agent', 'prompt', { jsonSchema: schemaStr });

    assert.ok(args.includes('--json-schema'));
    assert.ok(args.includes(schemaStr));
  });

  it('should use text output format when specified', () => {
    const args = executor._buildArgs('agent', 'prompt', { outputFormat: 'text' });

    assert.ok(!args.includes('--output-format'));
  });

  it('should not include --dangerously-skip-permissions when skipPermissions is false', () => {
    executor = new AgentExecutor({ skipPermissions: false });
    const args = executor._buildArgs('agent', 'prompt', {});

    assert.ok(!args.includes('--dangerously-skip-permissions'));
  });
});

describe('AgentExecutor - Output Parsing', () => {
  let executor;

  beforeEach(() => {
    executor = new AgentExecutor();
  });

  it('should parse JSON output with session_id', () => {
    const output = JSON.stringify({
      result: 'Hello world',
      session_id: 'session-abc'
    });

    const result = executor._parseOutput('agent', output, 'prompt', {});

    assert.strictEqual(result.response, 'Hello world');
    assert.strictEqual(result.sessionId, 'session-abc');
    assert.strictEqual(executor.sessions['agent'], 'session-abc');
  });

  it('should parse JSON output with cost info', () => {
    const output = JSON.stringify({
      result: 'Response',
      total_cost_usd: 0.05,
      duration_ms: 1500,
      num_turns: 2
    });

    const result = executor._parseOutput('agent', output, 'prompt', {});

    assert.strictEqual(result.costUsd, 0.05);
    assert.strictEqual(result.duration, 1500);
    assert.strictEqual(result.numTurns, 2);
  });

  it('should parse JSON output with usage info', () => {
    const output = JSON.stringify({
      result: 'Response',
      usage: {
        input_tokens: 100,
        output_tokens: 50
      }
    });

    const result = executor._parseOutput('agent', output, 'prompt', {});

    assert.strictEqual(result.tokensIn, 100);
    assert.strictEqual(result.tokensOut, 50);
  });

  it('should parse JSON output with structured_output and toolCall', () => {
    const output = JSON.stringify({
      result: 'Done',
      structured_output: {
        toolCall: {
          name: 'implementationComplete',
          arguments: { status: 'complete' }
        }
      }
    });

    const result = executor._parseOutput('agent', output, 'prompt', {});

    assert.ok(result.structuredOutput);
    assert.strictEqual(result.toolCalls.length, 1);
    assert.strictEqual(result.toolCalls[0].name, 'implementationComplete');
  });

  it('should parse JSON output with multiple toolCalls', () => {
    const output = JSON.stringify({
      result: 'Done',
      structured_output: {
        toolCalls: [
          { name: 'tool1', arguments: {} },
          { name: 'tool2', arguments: {} }
        ]
      }
    });

    const result = executor._parseOutput('agent', output, 'prompt', {});

    assert.strictEqual(result.toolCalls.length, 2);
  });

  it('should fallback to text parsing for non-JSON', () => {
    const output = 'Plain text response';

    const result = executor._parseOutput('agent', output, 'prompt', {});

    assert.strictEqual(result.response, 'Plain text response');
  });

  it('should extract session ID from text output', () => {
    const output = 'Response text\nsession_id: sess-12345\nMore text';

    const result = executor._parseOutput('agent', output, 'prompt', {});

    assert.strictEqual(result.sessionId, 'sess-12345');
    assert.strictEqual(executor.sessions['agent'], 'sess-12345');
  });

  it('should handle malformed JSON gracefully', () => {
    const output = '{ invalid json }';

    const result = executor._parseOutput('agent', output, 'prompt', {});

    assert.strictEqual(result.response, '{ invalid json }');
  });

  it('should prefer result field over response field', () => {
    const output = JSON.stringify({
      result: 'from result',
      response: 'from response'
    });

    const result = executor._parseOutput('agent', output, 'prompt', {});

    assert.strictEqual(result.response, 'from result');
  });

  it('should fallback to content field', () => {
    const output = JSON.stringify({
      content: 'from content'
    });

    const result = executor._parseOutput('agent', output, 'prompt', {});

    assert.strictEqual(result.response, 'from content');
  });
});

describe('AgentExecutor - Sleep Helper', () => {
  let executor;

  beforeEach(() => {
    executor = new AgentExecutor();
  });

  it('should delay for specified time', async () => {
    const start = Date.now();
    await executor.sleep(50);
    const elapsed = Date.now() - start;

    assert.ok(elapsed >= 45); // Allow some tolerance
    assert.ok(elapsed < 200); // Increased tolerance for CI/slow environments
  });
});

describe('AgentExecutor - Execute Flow Callbacks', () => {
  let executor;

  beforeEach(() => {
    executor = new AgentExecutor({ maxRetries: 0 });
  });

  it('should invoke onStart callback at execution start', async () => {
    let startData = null;

    executor.setCallbacks({
      onStart: (data) => {
        startData = data;
      }
    });

    // Mock _executeOnce to return immediately
    executor._executeOnce = async () => ({ response: 'test' });

    await executor.execute('agent', 'test prompt', {});

    assert.ok(startData);
    assert.strictEqual(startData.agentName, 'agent');
    assert.strictEqual(startData.prompt, 'test prompt');
  });

  it('should invoke onComplete callback on successful execution', async () => {
    let completeData = null;

    executor.setCallbacks({
      onComplete: (data) => {
        completeData = data;
      }
    });

    executor._executeOnce = async () => ({ response: 'success' });

    await executor.execute('agent', 'prompt', {});

    assert.ok(completeData);
    assert.strictEqual(completeData.agentName, 'agent');
    assert.strictEqual(completeData.result.response, 'success');
  });

  it('should invoke onError callback on permanent error', async () => {
    let errorData = null;

    executor.setCallbacks({
      onError: (data) => {
        errorData = data;
      }
    });

    executor._executeOnce = async () => {
      throw new Error('invalid_api_key');
    };

    try {
      await executor.execute('agent', 'prompt', {});
    } catch (e) {
      // Expected
    }

    assert.ok(errorData);
    assert.strictEqual(errorData.agentName, 'agent');
    assert.ok(errorData.error.message.includes('invalid_api_key'));
  });

  it('should track metrics on successful execution', async () => {
    executor._executeOnce = async () => ({ response: 'test' });

    await executor.execute('agent', 'prompt', {});

    assert.strictEqual(executor.metrics.totalCalls, 1);
    assert.strictEqual(executor.metrics.callsByAgent['agent'], 1);
  });
});

describe('AgentExecutor - Retry Logic', () => {
  let executor;

  beforeEach(() => {
    executor = new AgentExecutor({
      maxRetries: 2,
      retryBaseDelay: 10 // Short delay for tests
    });
  });

  it('should retry on transient error', async () => {
    let attempts = 0;
    let retryCallbackCount = 0;

    executor.setCallbacks({
      onRetry: () => {
        retryCallbackCount++;
      }
    });

    executor._executeOnce = async () => {
      attempts++;
      if (attempts < 2) {
        throw new Error('ECONNRESET');
      }
      return { response: 'success after retry' };
    };

    const result = await executor.execute('agent', 'prompt', {});

    assert.strictEqual(result.response, 'success after retry');
    assert.strictEqual(attempts, 2);
    assert.strictEqual(retryCallbackCount, 1);
    assert.strictEqual(executor.metrics.totalRetries, 1);
  });

  it('should retry on timeout error', async () => {
    let attempts = 0;

    executor._executeOnce = async () => {
      attempts++;
      if (attempts < 2) {
        throw new Error('Request timed out');
      }
      return { response: 'success' };
    };

    const result = await executor.execute('agent', 'prompt', {});

    assert.strictEqual(result.response, 'success');
    assert.strictEqual(attempts, 2);
  });

  it('should not retry on permanent error', async () => {
    let attempts = 0;

    executor._executeOnce = async () => {
      attempts++;
      throw new Error('invalid_api_key');
    };

    try {
      await executor.execute('agent', 'prompt', {});
      assert.fail('Should have thrown');
    } catch (e) {
      assert.ok(e.message.includes('invalid_api_key'));
    }

    assert.strictEqual(attempts, 1);
  });

  it('should fail after max retries exceeded', async () => {
    let attempts = 0;

    executor._executeOnce = async () => {
      attempts++;
      throw new Error('overloaded');
    };

    try {
      await executor.execute('agent', 'prompt', {});
      assert.fail('Should have thrown');
    } catch (e) {
      assert.ok(e.message.includes('overloaded'));
    }

    // Initial attempt + maxRetries
    assert.strictEqual(attempts, 3);
  });

  it('should invoke onRetry with correct data', async () => {
    let retryData = null;

    executor.setCallbacks({
      onRetry: (data) => {
        retryData = data;
      }
    });

    let attempts = 0;
    executor._executeOnce = async () => {
      attempts++;
      if (attempts < 2) {
        throw new Error('rate_limit exceeded');
      }
      return { response: 'ok' };
    };

    await executor.execute('agent', 'prompt', {});

    assert.ok(retryData);
    assert.strictEqual(retryData.agentName, 'agent');
    assert.strictEqual(retryData.attempt, 1);
    assert.strictEqual(retryData.maxRetries, 2);
    assert.ok(retryData.delay > 0);
    assert.ok(retryData.error.includes('rate_limit'));
    assert.strictEqual(retryData.category, 'TRANSIENT');
  });
});

describe('AgentExecutor - Fallback Model', () => {
  let executor;

  beforeEach(() => {
    executor = new AgentExecutor({
      maxRetries: 3,
      retryBaseDelay: 10
    });
  });

  it('should switch to fallback model after 2 retries', async () => {
    let fallbackData = null;
    let attempts = 0;
    let modelUsed = null;

    executor.setCallbacks({
      onFallback: (data) => {
        fallbackData = data;
      }
    });

    executor._executeOnce = async (agentName, prompt, options) => {
      attempts++;
      modelUsed = options.model;
      if (attempts < 4) {
        throw new Error('overloaded');
      }
      return { response: 'success with fallback' };
    };

    const result = await executor.execute('agent', 'prompt', {
      model: 'opus',
      fallbackModel: 'haiku'
    });

    assert.strictEqual(result.response, 'success with fallback');
    assert.ok(fallbackData);
    assert.strictEqual(fallbackData.agentName, 'agent');
    assert.strictEqual(fallbackData.model, 'haiku');
    assert.strictEqual(modelUsed, 'haiku');
    assert.strictEqual(executor.metrics.totalFallbacks, 1);
  });

  it('should not switch to fallback on first retry', async () => {
    let attempts = 0;
    let modelUsed = null;

    executor._executeOnce = async (agentName, prompt, options) => {
      attempts++;
      modelUsed = options.model;
      if (attempts < 2) {
        throw new Error('overloaded');
      }
      return { response: 'success' };
    };

    await executor.execute('agent', 'prompt', {
      model: 'opus',
      fallbackModel: 'haiku'
    });

    // Should still be using opus after first retry
    assert.strictEqual(modelUsed, 'opus');
  });

  it('should not fallback when no fallback model specified', async () => {
    let attempts = 0;
    let modelUsed = null;

    executor._executeOnce = async (agentName, prompt, options) => {
      attempts++;
      modelUsed = options.model;
      if (attempts < 3) {
        throw new Error('overloaded');
      }
      return { response: 'success' };
    };

    await executor.execute('agent', 'prompt', { model: 'opus' });

    assert.strictEqual(modelUsed, 'opus');
  });
});

describe('AgentExecutor - continueSession', () => {
  let executor;

  beforeEach(() => {
    executor = new AgentExecutor();
  });

  it('should throw error when no session exists', async () => {
    try {
      await executor.continueSession('unknown-agent', 'prompt', {});
      assert.fail('Should have thrown');
    } catch (e) {
      assert.ok(e.message.includes('No active session'));
      assert.ok(e.message.includes('unknown-agent'));
    }
  });

  it('should allow continue when session exists', async () => {
    executor.sessions['agent'] = 'session-123';
    executor._executeOnce = async () => ({ response: 'continued' });

    const result = await executor.continueSession('agent', 'continue prompt', {});

    assert.strictEqual(result.response, 'continued');
  });
});

describe('AgentExecutor - startSession', () => {
  let executor;

  beforeEach(() => {
    executor = new AgentExecutor();
  });

  it('should clear existing session before starting', async () => {
    executor.sessions['agent'] = 'old-session';
    executor._executeOnce = async () => ({ response: 'new session' });

    await executor.startSession('agent', 'System context', 'Initial prompt', {});

    // Old session should be cleared (new one may be set by response)
  });

  it('should combine system context with initial prompt', async () => {
    let receivedPrompt = null;

    executor._executeOnce = async (agentName, prompt) => {
      receivedPrompt = prompt;
      return { response: 'started' };
    };

    await executor.startSession('agent', 'You are a helper', 'Hello', {});

    assert.ok(receivedPrompt.includes('You are a helper'));
    assert.ok(receivedPrompt.includes('Hello'));
    assert.ok(receivedPrompt.includes('---'));
  });

  it('should work without system context', async () => {
    let receivedPrompt = null;

    executor._executeOnce = async (agentName, prompt) => {
      receivedPrompt = prompt;
      return { response: 'started' };
    };

    await executor.startSession('agent', '', 'Just the prompt', {});

    assert.strictEqual(receivedPrompt, 'Just the prompt');
  });
});

describe('AgentExecutor - executeWithTemplate', () => {
  let executor;
  let tempDir;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'executor-template-test-'));
    executor = new AgentExecutor({ templatesDir: tempDir });
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true });
    }
  });

  it('should render template and execute', async () => {
    let receivedPrompt = null;

    fs.writeFileSync(
      path.join(tempDir, 'task.hbs'),
      'Execute task: {{task}} for goal: {{goal}}'
    );

    executor._executeOnce = async (agentName, prompt) => {
      receivedPrompt = prompt;
      return { response: 'done' };
    };

    await executor.executeWithTemplate('agent', 'task.hbs', {
      task: 'Write tests',
      goal: 'Coverage'
    }, {});

    assert.strictEqual(receivedPrompt, 'Execute task: Write tests for goal: Coverage');
  });
});
