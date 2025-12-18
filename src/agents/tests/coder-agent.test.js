/**
 * Tests for coder-agent.js - Code implementation and fixes
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CoderAgent, CodeOutput } from '../coder-agent.js';
import { MessageType, AgentRole, AgentMessage, PlanStep } from '../interfaces.js';

// Mock Claude client
function createMockClient() {
  return {
    sendPrompt: vi.fn(),
    startSession: vi.fn(),
  };
}

describe('CodeOutput', () => {
  describe('File Management', () => {
    it('should add files with detected language', () => {
      const output = new CodeOutput('step_1');
      output.addFile('src/app.js', 'created', 'console.log("hello")');

      expect(output.files.length).toBe(1);
      expect(output.files[0].language).toBe('javascript');
    });

    it('should detect various languages', () => {
      const output = new CodeOutput('step_1');

      output.addFile('main.py', 'created', '');
      expect(output.files[0].language).toBe('python');

      output.addFile('server.ts', 'modified', '');
      expect(output.files[1].language).toBe('typescript');

      output.addFile('Cargo.toml', 'created', '');
      // No mapping for .toml, defaults to text
    });

    it('should truncate long content', () => {
      const output = new CodeOutput('step_1');
      const longContent = 'x'.repeat(10000);
      output.addFile('big.js', 'created', longContent);

      expect(output.files[0].content.length).toBe(5000);
    });
  });

  describe('Command Tracking', () => {
    it('should track commands executed', () => {
      const output = new CodeOutput('step_1');
      output.addCommand('npm install', 'installed 50 packages', 0);
      output.addCommand('npm test', 'all tests passed', 0);

      expect(output.commands.length).toBe(2);
      expect(output.commands[0].exitCode).toBe(0);
    });
  });

  describe('Test Tracking', () => {
    it('should track test files created', () => {
      const output = new CodeOutput('step_1');
      output.addTest('test/app.test.js', 'unit', 'test code here');

      expect(output.tests.length).toBe(1);
      expect(output.tests[0].testType).toBe('unit');
    });
  });

  describe('Blocking', () => {
    it('should track blocked status', () => {
      const output = new CodeOutput('step_1');
      expect(output.blocked).toBe(false);

      output.setBlocked('Missing dependency');
      expect(output.blocked).toBe(true);
      expect(output.blockReason).toBe('Missing dependency');
    });
  });

  describe('Artifacts', () => {
    it('should summarize artifacts', () => {
      const output = new CodeOutput('step_1');
      output.addFile('src/new.js', 'created', '');
      output.addFile('src/existing.js', 'modified', '');
      output.addTest('test/new.test.js', 'unit', '');
      output.addCommand('npm test', '', 0);

      const artifacts = output.getArtifacts();

      expect(artifacts.filesCreated).toContain('src/new.js');
      expect(artifacts.filesModified).toContain('src/existing.js');
      expect(artifacts.testsCreated).toContain('test/new.test.js');
      expect(artifacts.commandsRun).toBe(1);
    });
  });
});

describe('CoderAgent', () => {
  let coder;
  let mockClient;

  beforeEach(() => {
    mockClient = createMockClient();
    coder = new CoderAgent(mockClient, {
      model: 'opus',
      workingDirectory: '/test/project',
    });
  });

  describe('Initialization', () => {
    it('should initialize with correct role', () => {
      expect(coder.role).toBe(AgentRole.CODER);
    });

    it('should use configured model', () => {
      expect(coder.model).toBe('opus');
    });
  });

  describe('Step Implementation', () => {
    it('should implement a step', async () => {
      mockClient.startSession.mockResolvedValue({
        sessionId: 'session_123',
        response: `
### Summary
Implemented the user authentication feature.

### Files Modified
- \`src/auth.js\` - Added login function
- \`src/user.js\` - Added user model

### Implementation
\`\`\`javascript
function login(username, password) {
  // implementation
}
\`\`\`

### Tests Created
- \`test/auth.test.js\` - Unit tests for login

### Status
COMPLETE
`,
      });

      const step = new PlanStep(1, 'Implement user authentication', 'medium');
      const output = await coder.implementStep(step, {});

      expect(output.blocked).toBe(false);
      expect(output.files.length).toBeGreaterThan(0);
    });

    it('should detect blocked steps', async () => {
      mockClient.startSession.mockResolvedValue({
        sessionId: 'session_123',
        response: `
### Summary
Cannot proceed with implementation.

STEP BLOCKED: Missing required database configuration

### Status
BLOCKED
`,
      });

      const step = new PlanStep(1, 'Connect to database', 'high');
      const output = await coder.implementStep(step, {});

      expect(output.blocked).toBe(true);
      expect(output.blockReason).toContain('database');
    });

    it('should use existing session for subsequent steps', async () => {
      mockClient.startSession.mockResolvedValue({
        sessionId: 'session_abc',
        response: '### Summary\nFirst step\n### Status\nCOMPLETE',
      });
      mockClient.sendPrompt.mockResolvedValue({
        response: '### Summary\nSecond step\n### Status\nCOMPLETE',
      });

      const step1 = new PlanStep(1, 'First step', 'low');
      const step2 = new PlanStep(2, 'Second step', 'low');

      await coder.implementStep(step1, {});
      await coder.implementStep(step2, {});

      expect(mockClient.startSession).toHaveBeenCalledTimes(1);
      expect(mockClient.sendPrompt).toHaveBeenCalledTimes(1);
    });
  });

  describe('Fix Application', () => {
    it('should apply fixes from test feedback', async () => {
      coder.sessionId = 'existing_session';

      mockClient.sendPrompt.mockResolvedValue({
        response: `
### Summary
Fixed the null pointer issue.

### Files Modified
- \`src/app.js\` - Added null check

### Fixes Applied
\`\`\`javascript
if (user != null) {
  // safe to use user
}
\`\`\`

### Status
COMPLETE
`,
      });

      const step = new PlanStep(1, 'User handler', 'medium');
      const fixPlan = {
        issues: [
          { severity: 'major', description: 'Null pointer exception in user handler' },
        ],
        priority: 'high',
      };

      const output = await coder.applyFix(step, fixPlan);

      expect(output.blocked).toBe(false);
      expect(output.summary).toContain('Fix applied');
    });
  });

  describe('Message Handling', () => {
    it('should handle CODE_REQUEST message', async () => {
      mockClient.startSession.mockResolvedValue({
        sessionId: 'sess',
        response: '### Summary\nDone\n### Status\nCOMPLETE',
      });

      const request = new AgentMessage(
        MessageType.CODE_REQUEST,
        AgentRole.ORCHESTRATOR,
        AgentRole.CODER,
        {
          step: new PlanStep(1, 'Implement feature', 'low'),
          context: {},
        }
      );

      const response = await coder.handleMessage(request);

      expect(response.type).toBe(MessageType.CODE_RESPONSE);
      expect(response.payload.success).toBe(true);
    });

    it('should handle CODE_FIX_REQUEST message', async () => {
      coder.sessionId = 'existing';

      mockClient.sendPrompt.mockResolvedValue({
        response: '### Summary\nFixed\n### Status\nCOMPLETE',
      });

      const request = new AgentMessage(
        MessageType.CODE_FIX_REQUEST,
        AgentRole.ORCHESTRATOR,
        AgentRole.CODER,
        {
          step: new PlanStep(1, 'Buggy code', 'medium'),
          fixPlan: { issues: [{ description: 'Bug' }] },
        }
      );

      const response = await coder.handleMessage(request);

      expect(response.type).toBe(MessageType.CODE_RESPONSE);
      expect(response.payload.fixApplied).toBe(true);
    });
  });

  describe('Response Parsing', () => {
    it('should parse file modifications', () => {
      const output = new CodeOutput('step_1');
      const response = `
### Files Modified
- \`src/app.js\` - main application
- \`src/utils.js\` - helper functions

### Implementation
\`\`\`javascript
// code
\`\`\`
`;

      coder.parseImplementationResponse(response, output);

      expect(output.files.some(f => f.path === 'src/app.js')).toBe(true);
      expect(output.files.some(f => f.path === 'src/utils.js')).toBe(true);
    });

    it('should parse test files', () => {
      const output = new CodeOutput('step_1');
      const response = `
### Tests Created
- \`test/app.test.js\` - main tests
- \`test/utils.spec.js\` - utility tests
`;

      coder.parseImplementationResponse(response, output);

      expect(output.tests.some(t => t.path.includes('test'))).toBe(true);
    });

    it('should parse bash commands', () => {
      const output = new CodeOutput('step_1');
      const response = `
### Commands Run
\`\`\`bash
$ npm install express
$ npm test
\`\`\`
`;

      coder.parseImplementationResponse(response, output);

      expect(output.commands.some(c => c.command.includes('npm install'))).toBe(true);
    });
  });

  describe('Session Management', () => {
    it('should reset session', async () => {
      coder.sessionId = 'old_session';
      coder.resetSession();

      expect(coder.sessionId).toBeNull();
    });
  });

  describe('Statistics', () => {
    it('should return agent stats', () => {
      const stats = coder.getStats();

      expect(stats.role).toBe(AgentRole.CODER);
      expect(stats.model).toBe('opus');
      expect(stats.sessionActive).toBe(false);
      expect(stats.implementationsCount).toBe(0);
    });

    it('should track session state', async () => {
      mockClient.startSession.mockResolvedValue({
        sessionId: 'sess',
        response: '### Summary\nDone\n### Status\nCOMPLETE',
      });

      const step = new PlanStep(1, 'Step', 'low');
      await coder.implementStep(step, {});

      const stats = coder.getStats();
      expect(stats.sessionActive).toBe(true);
    });
  });
});
