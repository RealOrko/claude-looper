# 🧪 Testing Guide

## 🏃 Running Tests

```bash
npm test                         # Run all tests
npm run test:coverage            # With coverage report
npm run test:coverage:check      # With coverage thresholds
```

### 🎯 Run Specific Tests

```bash
node --test agent-planner.test.js                           # Single file
node --test --test-name-pattern "should parse" *.test.js    # By name
node --test --test-reporter spec *.test.js                  # Verbose output
```

## 📁 Test Files

| File | Tests |
|------|-------|
| `agent-planner.test.js` | 📝 Plan parsing, task management |
| `agent-coder.test.js` | 💻 Implementation result parsing |
| `agent-tester.test.js` | 🧪 Test result parsing, fix plans |
| `agent-supervisor.test.js` | 👁️ Verification, escalation |
| `agent-executor.test.js` | ⚡ Prompt building, tool handling |
| `orchestrator.test.js` | 🎯 Workflow phases, state management |
| `integration.test.js` | 🔗 End-to-end workflows |

## ✍️ Writing Tests

```javascript
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import agentCore from './agent-core.js';

describe('MyAgent', () => {
  beforeEach(() => {
    agentCore.reset();  // 🔄 Always reset state
  });

  it('should do something', () => {
    const result = myAgent.method(input);
    assert.strictEqual(result.status, 'expected');
  });
});
```

### 📋 Key Patterns

- 🔄 **Always reset** `agentCore.reset()` in `beforeEach`
- ✅ **Use strict** `assert.strictEqual()` over `assert.equal()`
- 🔀 **Test both paths** — structured output AND text fallback
- ⚠️ **Test edge cases** — empty input, long strings, missing fields

## 📊 Coverage Targets

| Metric | Target |
|--------|--------|
| 📏 Lines | 80% |
| 🌿 Branches | 75% |
| 🔧 Functions | 90% |

## 🐛 Debugging

```bash
NODE_DEBUG=test node --test agent-planner.test.js
```
