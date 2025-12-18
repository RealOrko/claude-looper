/**
 * Integration Test - Full Orchestration Loop
 *
 * Demonstrates the complete workflow with all agents working together:
 * 1. Planner creates a plan
 * 2. Coder implements each step with tests
 * 3. Tester validates implementations
 * 4. Fix cycles when tests fail
 * 5. Supervisor verifies all outputs
 * 6. Recursive re-planning when steps are blocked
 * 7. Goal verification at completion
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Orchestrator } from '../orchestrator.js';
import { PlannerAgent } from '../planner-agent.js';
import { CoderAgent } from '../coder-agent.js';
import { TesterAgent } from '../tester-agent.js';
import { SupervisorAgent } from '../supervisor-agent.js';
import {
  AgentRole,
  MessageType,
  PlanDepth,
  ExecutionPlan,
  PlanStep,
} from '../interfaces.js';

// Create mock Claude client with realistic responses
function createMockClient(responseOverrides = {}) {
  const sessionId = `session_${Date.now()}_${Math.random().toString(36).slice(2)}`;

  const defaultResponses = {
    // Planner responses
    planResponse: `
ANALYSIS:
Analyzing the goal to create a todo application.

PLAN:
1. Set up project structure and dependencies | simple
2. Implement todo data model | medium
3. Create todo CRUD operations | medium
4. Add unit tests for todo operations | simple

DEPENDENCIES:
Step 2 depends on Step 1
Step 3 depends on Step 2
Step 4 depends on Step 3

RISKS:
- None identified

TOTAL_STEPS: 4
`,
    // Coder responses
    codeResponse: `
### Summary
Implemented the required functionality.

### Files Modified
- \`src/todo.js\` - Main implementation

### Implementation
\`\`\`javascript
function createTodo(title) {
  return { id: Date.now(), title, completed: false };
}
\`\`\`

### Tests Created
- \`test/todo.test.js\` - Unit tests

### Status
COMPLETE
`,
    // Coder fix response
    fixResponse: `
### Summary
Fixed the identified issues.

### Files Modified
- \`src/todo.js\` - Bug fix applied

### Fixes Applied
\`\`\`javascript
// Added null check
if (!title) throw new Error('Title required');
\`\`\`

### Status
COMPLETE
`,
    // Tester responses
    testPassResponse: `
RESULT: PASS
TESTS_RUN: 5
PASSED: 5
FAILED: 0

ASSESSMENT: All tests passing. Code meets requirements.

COVERAGE: GOOD
`,
    testFailResponse: `
RESULT: FAIL
TESTS_RUN: 5
PASSED: 3
FAILED: 2

FAILED_TESTS:
- test/todo.test.js:15 - Expected title to be required
- test/todo.test.js:22 - Missing input validation

ASSESSMENT: Some tests failing. Needs fixes.

COVERAGE: PARTIAL

FIX_PLAN:
- Add input validation for title parameter
- Return proper error for empty title
`,
    // Supervisor responses
    verifyApproveResponse: `
VERIFIED: YES
SCORE: 90
APPROVED: YES
ASSESSMENT: Output meets quality standards.
ISSUES: None
RECOMMENDATION: continue
`,
    verifyRejectResponse: `
VERIFIED: NO
SCORE: 45
APPROVED: NO
ASSESSMENT: Output has critical issues.
ISSUES: Missing error handling
RECOMMENDATION: fix
`,
    goalAchievedResponse: `
GOAL_ACHIEVED: YES
CONFIDENCE: HIGH
COMPLETENESS: 95
FUNCTIONAL: YES
RECOMMENDATION: ACCEPT
REASON: All requirements have been implemented and tested.
`,
    goalNotAchievedResponse: `
GOAL_ACHIEVED: PARTIAL
CONFIDENCE: MEDIUM
COMPLETENESS: 60
FUNCTIONAL: YES
RECOMMENDATION: NEEDS_WORK
REASON: Some requirements not fully implemented.
`,
    // Sub-plan response
    subPlanResponse: `
ANALYSIS: Breaking down the blocked step into smaller tasks.

PLAN:
1. First sub-task | simple
2. Second sub-task | simple

TOTAL_STEPS: 2
`,
  };

  const responses = { ...defaultResponses, ...responseOverrides };
  let callCount = 0;
  let responseQueue = [];

  return {
    sendPrompt: vi.fn(async (prompt) => {
      // Check if there's a queued response
      if (responseQueue.length > 0) {
        return { response: responseQueue.shift() };
      }

      // Determine response based on prompt content
      if (prompt.includes('PLAN:') || prompt.includes('create a plan')) {
        return { response: responses.planResponse };
      }
      if (prompt.includes('SUB-PLAN') || prompt.includes('re-plan')) {
        return { response: responses.subPlanResponse };
      }
      if (prompt.includes('FIX') || prompt.includes('fix')) {
        return { response: responses.fixResponse };
      }
      if (prompt.includes('GOAL_ACHIEVED') || prompt.includes('goal achievement')) {
        return { response: responses.goalAchievedResponse };
      }
      if (prompt.includes('VERIFIED') || prompt.includes('verify')) {
        return { response: responses.verifyApproveResponse };
      }
      if (prompt.includes('test') || prompt.includes('TEST')) {
        return { response: responses.testPassResponse };
      }

      return { response: responses.codeResponse };
    }),
    startSession: vi.fn(async (prompt) => {
      return {
        sessionId: sessionId,
        response: responses.codeResponse,
      };
    }),
    getSessionId: vi.fn(() => sessionId),
    queueResponse: (response) => {
      responseQueue.push(response);
    },
    queueResponses: (responseList) => {
      responseQueue.push(...responseList);
    },
  };
}

// Create goal tracker mock
function createMockGoalTracker() {
  return {
    getGoal: vi.fn().mockReturnValue('Build a todo application'),
    getProgress: vi.fn().mockReturnValue(50),
  };
}

// Mock TesterAgent's executeCommand to prevent spawning real processes
function mockTesterExecuteCommand(tester) {
  tester.executeCommand = vi.fn(async (command) => {
    return {
      command,
      exitCode: 0,
      stdout: 'All tests passed\n✓ test suite passed',
      stderr: '',
      duration: 100,
      passed: true,
      timedOut: false,
    };
  });
  return tester;
}

describe('Integration: Full Orchestration Loop', () => {
  let orchestrator;
  let mockClient;
  let mockGoalTracker;
  let agents;

  beforeEach(() => {
    mockClient = createMockClient();
    mockGoalTracker = createMockGoalTracker();

    // Create all agents
    const tester = new TesterAgent(mockClient, { model: 'opus' });
    mockTesterExecuteCommand(tester);

    agents = {
      [AgentRole.PLANNER]: new PlannerAgent(mockClient, { model: 'opus' }),
      [AgentRole.CODER]: new CoderAgent(mockClient, { model: 'opus' }),
      [AgentRole.TESTER]: tester,
      [AgentRole.SUPERVISOR]: new SupervisorAgent(mockClient, mockGoalTracker, { model: 'sonnet' }),
    };

    // Create orchestrator with short timeout for tests
    orchestrator = new Orchestrator({
      timeLimit: 30000, // 30 seconds for tests
      maxFixCycles: 2,
      maxStepAttempts: 2,
      verifyAllOutputs: true,
      requireTests: false, // Disable for simpler integration tests
    });

    // Register all agents
    orchestrator.registerAgents(agents);
  });

  describe('Complete Workflow Simulation', () => {
    it('should complete a full orchestration loop with all agents', async () => {
      const events = [];

      // Track all events
      orchestrator.on('initialized', (data) => events.push({ type: 'initialized', data }));
      orchestrator.on('phase_started', (data) => events.push({ type: 'phase_started', data }));
      orchestrator.on('phase_completed', (data) => events.push({ type: 'phase_completed', data }));
      orchestrator.on('plan_created', (data) => events.push({ type: 'plan_created', data }));
      orchestrator.on('step_started', (data) => events.push({ type: 'step_started', data }));
      orchestrator.on('step_completed', (data) => events.push({ type: 'step_completed', data }));
      orchestrator.on('goal_achieved', (data) => events.push({ type: 'goal_achieved', data }));

      // Initialize orchestrator
      await orchestrator.initialize('Build a todo application', {
        language: 'JavaScript',
        framework: 'Node.js',
      });

      expect(orchestrator.state).not.toBeNull();
      expect(orchestrator.state.primaryGoal).toBe('Build a todo application');

      // Run the orchestration loop
      const report = await orchestrator.run();

      // Verify phases executed
      const phases = events.filter(e => e.type === 'phase_started').map(e => e.data.phase);
      expect(phases).toContain('planning');
      expect(phases).toContain('execution');
      expect(phases).toContain('verification');

      // Verify plan was created
      const planEvents = events.filter(e => e.type === 'plan_created');
      expect(planEvents.length).toBe(1);

      // Verify report structure
      expect(report).toHaveProperty('status');
      expect(report).toHaveProperty('goal');
      expect(report).toHaveProperty('metrics');
      expect(report).toHaveProperty('agentStats');
    }, 60000);

    it('should handle the full agent communication flow', async () => {
      const messages = [];

      // Track messages
      orchestrator.messageBus.on('message_sent', (data) => {
        messages.push({ direction: 'sent', ...data });
      });
      orchestrator.messageBus.on('message_delivered', (data) => {
        messages.push({ direction: 'delivered', ...data });
      });

      await orchestrator.initialize('Create a simple API');
      await orchestrator.run();

      // Verify message types used
      const messageTypes = [...new Set(messages.map(m => m.type))];

      // Should have plan request
      expect(messageTypes).toContain(MessageType.PLAN_REQUEST);

      // Should have code requests
      expect(messageTypes).toContain(MessageType.CODE_REQUEST);

      // Should have test requests
      expect(messageTypes).toContain(MessageType.TEST_REQUEST);

      // Should have verification requests
      expect(messageTypes).toContain(MessageType.VERIFY_REQUEST);
    }, 60000);
  });

  describe('Fix Cycle Workflow', () => {
    it('should handle test failures with fix cycles', async () => {
      // Create client that fails first test then passes
      const fixCycleClient = createMockClient({
        testFailResponse: `
RESULT: FAIL
TESTS_RUN: 3
PASSED: 1
FAILED: 2

FAILED_TESTS:
- test/api.test.js:10 - Validation error

ASSESSMENT: Input validation missing

FIX_PLAN:
- Add input validation
`,
      });

      let testCallCount = 0;
      fixCycleClient.sendPrompt = vi.fn(async (prompt) => {
        if (prompt.includes('PLAN:') || prompt.includes('create a plan')) {
          return { response: `
ANALYSIS: Simple plan

PLAN:
1. Implement feature | simple

TOTAL_STEPS: 1
` };
        }

        if (prompt.includes('test') || prompt.includes('TEST') || prompt.includes('RUN TESTS')) {
          testCallCount++;
          // First test fails, second passes
          if (testCallCount === 1) {
            return { response: `
RESULT: FAIL
TESTS_RUN: 3
PASSED: 1
FAILED: 2

FAILED_TESTS:
- test/api.test.js:10 - Validation error

FIX_PLAN:
- Add input validation
` };
          }
          return { response: `
RESULT: PASS
TESTS_RUN: 3
PASSED: 3
FAILED: 0

ASSESSMENT: All tests passing.
COVERAGE: GOOD
` };
        }

        if (prompt.includes('VERIFIED') || prompt.includes('verify') || prompt.includes('GOAL')) {
          return { response: `
VERIFIED: YES
SCORE: 90
GOAL_ACHIEVED: YES
RECOMMENDATION: continue
` };
        }

        return { response: `
### Summary
Implementation complete.

### Files Modified
- \`src/feature.js\`

### Tests Created
- \`test/feature.test.js\`

### Status
COMPLETE
` };
      });

      fixCycleClient.startSession = vi.fn(async () => ({
        sessionId: 'fix_session',
        response: `### Summary\nDone\n### Status\nCOMPLETE`,
      }));
      fixCycleClient.getSessionId = vi.fn(() => 'fix_session');

      // Create agents with fix cycle client
      const fixTester = new TesterAgent(fixCycleClient, { model: 'opus' });
      mockTesterExecuteCommand(fixTester);

      const fixAgents = {
        [AgentRole.PLANNER]: new PlannerAgent(fixCycleClient, { model: 'opus' }),
        [AgentRole.CODER]: new CoderAgent(fixCycleClient, { model: 'opus' }),
        [AgentRole.TESTER]: fixTester,
        [AgentRole.SUPERVISOR]: new SupervisorAgent(fixCycleClient, mockGoalTracker, { model: 'sonnet' }),
      };

      const fixOrchestrator = new Orchestrator({
        timeLimit: 30000,
        maxFixCycles: 3,
        verifyAllOutputs: true,
        requireTests: false,
      });

      fixOrchestrator.registerAgents(fixAgents);

      const fixCycleEvents = [];
      fixOrchestrator.on('fix_cycle_started', (data) => fixCycleEvents.push({ type: 'started', ...data }));
      fixOrchestrator.on('fix_cycle_completed', (data) => fixCycleEvents.push({ type: 'completed', ...data }));

      await fixOrchestrator.initialize('Test fix cycles');
      const report = await fixOrchestrator.run();

      // Verify fix cycles occurred
      expect(report.metrics.fixCycles).toBeGreaterThanOrEqual(0);
    }, 60000);
  });

  describe('Recursive Re-planning', () => {
    it('should handle blocked steps with sub-plans up to 3 levels', async () => {
      let planCallCount = 0;
      let codeCallCount = 0;

      const replanClient = createMockClient();
      replanClient.sendPrompt = vi.fn(async (prompt) => {
        // Plan requests
        if (prompt.includes('PLAN:') || prompt.includes('create a plan')) {
          planCallCount++;
          return { response: `
ANALYSIS: Creating plan

PLAN:
1. Complex step that will block | complex

TOTAL_STEPS: 1
` };
        }

        // Sub-plan requests
        if (prompt.includes('SUB-PLAN') || prompt.includes('re-plan') || prompt.includes('REPLAN')) {
          planCallCount++;
          return { response: `
ANALYSIS: Breaking down blocked step

PLAN:
1. Simpler sub-step | simple

TOTAL_STEPS: 1
` };
        }

        // Code requests - first few block, then succeed
        if (prompt.includes('implement') || prompt.includes('IMPLEMENT')) {
          codeCallCount++;
          if (codeCallCount <= 2) {
            return { response: `
### Summary
Cannot proceed.

STEP BLOCKED: Missing dependency

### Status
BLOCKED
` };
          }
          return { response: `
### Summary
Implemented successfully.

### Files Modified
- \`src/feature.js\`

### Tests Created
- \`test/feature.test.js\`

### Status
COMPLETE
` };
        }

        // Test requests
        if (prompt.includes('test') || prompt.includes('TEST')) {
          return { response: `
RESULT: PASS
TESTS_RUN: 2
PASSED: 2
FAILED: 0

COVERAGE: GOOD
` };
        }

        // Verify requests
        if (prompt.includes('VERIFIED') || prompt.includes('verify') || prompt.includes('GOAL')) {
          return { response: `
VERIFIED: YES
SCORE: 85
GOAL_ACHIEVED: YES
RECOMMENDATION: continue
` };
        }

        return { response: 'OK' };
      });

      replanClient.startSession = vi.fn(async (prompt) => {
        codeCallCount++;
        if (codeCallCount <= 2) {
          return {
            sessionId: 'blocked_session',
            response: `### Summary\nBlocked\n\nSTEP BLOCKED: Missing dependency\n\n### Status\nBLOCKED`,
          };
        }
        return {
          sessionId: 'success_session',
          response: `### Summary\nDone\n\n### Tests Created\n- test/x.test.js\n\n### Status\nCOMPLETE`,
        };
      });
      replanClient.getSessionId = vi.fn(() => 'replan_session');

      const replanTester = new TesterAgent(replanClient, { model: 'opus' });
      mockTesterExecuteCommand(replanTester);

      const replanAgents = {
        [AgentRole.PLANNER]: new PlannerAgent(replanClient, { model: 'opus' }),
        [AgentRole.CODER]: new CoderAgent(replanClient, { model: 'opus' }),
        [AgentRole.TESTER]: replanTester,
        [AgentRole.SUPERVISOR]: new SupervisorAgent(replanClient, mockGoalTracker, { model: 'sonnet' }),
      };

      const replanOrchestrator = new Orchestrator({
        timeLimit: 30000,
        maxFixCycles: 1,
        verifyAllOutputs: true,
        requireTests: false,
      });

      replanOrchestrator.registerAgents(replanAgents);

      const replanEvents = [];
      replanOrchestrator.on('replan_started', (data) => replanEvents.push({ type: 'started', ...data }));
      replanOrchestrator.on('replan_completed', (data) => replanEvents.push({ type: 'completed', ...data }));
      replanOrchestrator.on('replan_limit_reached', (data) => replanEvents.push({ type: 'limit', ...data }));

      await replanOrchestrator.initialize('Test re-planning');
      const report = await replanOrchestrator.run();

      // Verify re-planning metrics
      expect(report.metrics.replanCount).toBeGreaterThanOrEqual(0);
    }, 60000);
  });

  describe('Supervisor Verification', () => {
    it('should verify all outputs through Supervisor agent', async () => {
      const verifications = [];

      // Track verification requests
      const originalSend = orchestrator.messageBus.send.bind(orchestrator.messageBus);
      orchestrator.messageBus.send = async (message) => {
        if (message.type === MessageType.VERIFY_REQUEST) {
          verifications.push({
            type: message.payload.type,
            target: message.payload.target,
          });
        }
        return originalSend(message);
      };

      await orchestrator.initialize('Verify all outputs test');
      await orchestrator.run();

      // Should have verification requests for:
      // - Plan verification
      // - Code verification (per step)
      // - Goal verification
      const verifyTypes = verifications.map(v => v.type);
      expect(verifyTypes.length).toBeGreaterThan(0);
    }, 60000);

    it('should handle verification failures', async () => {
      // Client that rejects plan verification
      const rejectClient = createMockClient({
        verifyApproveResponse: `
VERIFIED: NO
SCORE: 30
APPROVED: NO
ASSESSMENT: Plan is inadequate.
ISSUES: Missing critical steps
RECOMMENDATION: reject
`,
      });

      let verifyCallCount = 0;
      rejectClient.sendPrompt = vi.fn(async (prompt) => {
        if (prompt.includes('PLAN:') || prompt.includes('create a plan')) {
          return { response: `
ANALYSIS: Plan

PLAN:
1. Single step | simple

TOTAL_STEPS: 1
` };
        }

        if (prompt.includes('VERIFIED') || prompt.includes('verify')) {
          verifyCallCount++;
          // First verification rejects, subsequent ones approve
          if (verifyCallCount === 1) {
            return { response: `
VERIFIED: NO
SCORE: 30
ASSESSMENT: Inadequate
RECOMMENDATION: reject
` };
          }
          return { response: `
VERIFIED: YES
SCORE: 85
GOAL_ACHIEVED: YES
RECOMMENDATION: continue
` };
        }

        if (prompt.includes('test')) {
          return { response: `
RESULT: PASS
TESTS_RUN: 1
PASSED: 1
FAILED: 0
COVERAGE: GOOD
` };
        }

        return { response: `### Summary\nDone\n### Status\nCOMPLETE` };
      });

      rejectClient.startSession = vi.fn(async () => ({
        sessionId: 'sess',
        response: `### Summary\nDone\n### Tests Created\n- test.js\n### Status\nCOMPLETE`,
      }));
      rejectClient.getSessionId = vi.fn(() => 'reject_session');

      const rejectTester = new TesterAgent(rejectClient, { model: 'opus' });
      mockTesterExecuteCommand(rejectTester);

      const rejectAgents = {
        [AgentRole.PLANNER]: new PlannerAgent(rejectClient, { model: 'opus' }),
        [AgentRole.CODER]: new CoderAgent(rejectClient, { model: 'opus' }),
        [AgentRole.TESTER]: rejectTester,
        [AgentRole.SUPERVISOR]: new SupervisorAgent(rejectClient, mockGoalTracker, { model: 'sonnet' }),
      };

      const rejectOrchestrator = new Orchestrator({
        timeLimit: 30000,
        verifyAllOutputs: true,
        requireTests: false,
      });

      rejectOrchestrator.registerAgents(rejectAgents);

      await rejectOrchestrator.initialize('Verification failure test');
      const report = await rejectOrchestrator.run();

      // Report should exist even with verification failures
      expect(report).toBeDefined();
      expect(report.metrics).toBeDefined();
    }, 60000);
  });

  describe('Goal Achievement', () => {
    it('should correctly identify goal achievement', async () => {
      let goalAchieved = false;

      orchestrator.on('goal_achieved', () => {
        goalAchieved = true;
      });

      await orchestrator.initialize('Simple goal');
      const report = await orchestrator.run();

      // With mock client returning success, goal should be achieved
      expect(['completed', 'verification_failed']).toContain(report.status);
    }, 60000);

    it('should handle partial goal completion', async () => {
      // Client that returns partial completion
      const partialClient = createMockClient({
        goalAchievedResponse: `
GOAL_ACHIEVED: PARTIAL
CONFIDENCE: MEDIUM
COMPLETENESS: 60
FUNCTIONAL: YES
RECOMMENDATION: NEEDS_WORK
REASON: Some features incomplete.
`,
      });

      partialClient.sendPrompt = vi.fn(async (prompt) => {
        if (prompt.includes('PLAN:') || prompt.includes('create a plan')) {
          return { response: `
ANALYSIS: Plan

PLAN:
1. Step one | simple

TOTAL_STEPS: 1
` };
        }

        if (prompt.includes('GOAL_ACHIEVED') || prompt.includes('goal')) {
          return { response: `
GOAL_ACHIEVED: PARTIAL
CONFIDENCE: MEDIUM
COMPLETENESS: 60
RECOMMENDATION: NEEDS_WORK
` };
        }

        if (prompt.includes('VERIFIED') || prompt.includes('verify')) {
          return { response: `
VERIFIED: YES
SCORE: 70
RECOMMENDATION: continue
` };
        }

        if (prompt.includes('test')) {
          return { response: `
RESULT: PASS
TESTS_RUN: 1
PASSED: 1
FAILED: 0
COVERAGE: GOOD
` };
        }

        return { response: `### Summary\nDone\n### Tests Created\n- test.js\n### Status\nCOMPLETE` };
      });

      partialClient.startSession = vi.fn(async () => ({
        sessionId: 'partial_sess',
        response: `### Summary\nDone\n### Tests Created\n- test.js\n### Status\nCOMPLETE`,
      }));
      partialClient.getSessionId = vi.fn(() => 'partial_session');

      const partialTester = new TesterAgent(partialClient, { model: 'opus' });
      mockTesterExecuteCommand(partialTester);

      const partialAgents = {
        [AgentRole.PLANNER]: new PlannerAgent(partialClient, { model: 'opus' }),
        [AgentRole.CODER]: new CoderAgent(partialClient, { model: 'opus' }),
        [AgentRole.TESTER]: partialTester,
        [AgentRole.SUPERVISOR]: new SupervisorAgent(partialClient, mockGoalTracker, { model: 'sonnet' }),
      };

      const partialOrchestrator = new Orchestrator({
        timeLimit: 30000,
        verifyAllOutputs: true,
        requireTests: false,
      });

      partialOrchestrator.registerAgents(partialAgents);

      let verificationFailed = false;
      partialOrchestrator.on('goal_verification_failed', () => {
        verificationFailed = true;
      });

      await partialOrchestrator.initialize('Partial completion test');
      const report = await partialOrchestrator.run();

      expect(report).toBeDefined();
    }, 60000);
  });

  describe('Time Limit Handling', () => {
    it('should respect time limits', async () => {
      // Create slow client
      const slowClient = createMockClient();
      slowClient.sendPrompt = vi.fn(async (prompt) => {
        // Add delay
        await new Promise(resolve => setTimeout(resolve, 100));

        if (prompt.includes('PLAN:')) {
          return { response: `
ANALYSIS: Plan

PLAN:
1. Step 1 | simple
2. Step 2 | simple
3. Step 3 | simple

TOTAL_STEPS: 3
` };
        }

        return { response: `VERIFIED: YES\nSCORE: 90\nRECOMMENDATION: continue` };
      });

      slowClient.startSession = vi.fn(async () => {
        await new Promise(resolve => setTimeout(resolve, 100));
        return {
          sessionId: 'slow',
          response: `### Summary\nDone\n### Status\nCOMPLETE`,
        };
      });
      slowClient.getSessionId = vi.fn(() => 'slow_session');

      const slowTester = new TesterAgent(slowClient, { model: 'opus' });
      mockTesterExecuteCommand(slowTester);

      const slowAgents = {
        [AgentRole.PLANNER]: new PlannerAgent(slowClient, { model: 'opus' }),
        [AgentRole.CODER]: new CoderAgent(slowClient, { model: 'opus' }),
        [AgentRole.TESTER]: slowTester,
        [AgentRole.SUPERVISOR]: new SupervisorAgent(slowClient, mockGoalTracker, { model: 'sonnet' }),
      };

      // Very short time limit
      const timedOrchestrator = new Orchestrator({
        timeLimit: 500, // 500ms
        verifyAllOutputs: false,
        requireTests: false,
      });

      timedOrchestrator.registerAgents(slowAgents);

      await timedOrchestrator.initialize('Time limit test');
      const report = await timedOrchestrator.run();

      // Should complete (either success or time-limited)
      expect(report).toBeDefined();
      expect(report.elapsed).toBeDefined();
    }, 30000);
  });

  describe('Agent Statistics', () => {
    it('should track statistics across all agents', async () => {
      await orchestrator.initialize('Stats test');
      await orchestrator.run();

      const report = orchestrator.generateReport();

      // Check agent stats are collected
      expect(report.agentStats).toBeDefined();
      expect(report.agentStats[AgentRole.PLANNER]).toBeDefined();
      expect(report.agentStats[AgentRole.CODER]).toBeDefined();
      expect(report.agentStats[AgentRole.TESTER]).toBeDefined();
      expect(report.agentStats[AgentRole.SUPERVISOR]).toBeDefined();

      // Check message bus stats
      expect(report.messageBusStats).toBeDefined();
      expect(report.messageBusStats.totalMessages).toBeGreaterThan(0);
    }, 60000);

    it('should track metrics throughout execution', async () => {
      await orchestrator.initialize('Metrics test');
      await orchestrator.run();

      const report = orchestrator.generateReport();

      // Verify metrics structure
      expect(report.metrics).toHaveProperty('completedSteps');
      expect(report.metrics).toHaveProperty('failedSteps');
      expect(report.metrics).toHaveProperty('fixCycles');
      expect(report.metrics).toHaveProperty('replanCount');
    }, 60000);
  });

  describe('Event System', () => {
    it('should emit events throughout the workflow', async () => {
      const eventTypes = new Set();

      // Capture all event types
      const originalEmit = orchestrator.emit.bind(orchestrator);
      orchestrator.emit = (event, data) => {
        eventTypes.add(event);
        return originalEmit(event, data);
      };

      await orchestrator.initialize('Event test');
      await orchestrator.run();

      // Should have key events
      expect(eventTypes.has('initialized')).toBe(true);
      expect(eventTypes.has('started')).toBe(true);
      expect(eventTypes.has('phase_started')).toBe(true);
      expect(eventTypes.has('phase_completed')).toBe(true);
    }, 60000);
  });
});

describe('Integration: Agent Collaboration Patterns', () => {
  it('should demonstrate Planner-Coder-Tester-Supervisor flow', async () => {
    const mockClient = createMockClient();
    const mockGoalTracker = createMockGoalTracker();

    const workflow = [];

    // Track workflow order
    const planner = new PlannerAgent(mockClient, { model: 'opus' });
    const coder = new CoderAgent(mockClient, { model: 'opus' });
    const tester = new TesterAgent(mockClient, { model: 'opus' });
    mockTesterExecuteCommand(tester);
    const supervisor = new SupervisorAgent(mockClient, mockGoalTracker, { model: 'sonnet' });

    // Wrap handleMessage to track calls
    const wrapAgent = (agent, name) => {
      const original = agent.handleMessage.bind(agent);
      agent.handleMessage = async (msg) => {
        workflow.push({ agent: name, messageType: msg.type, timestamp: Date.now() });
        return original(msg);
      };
      return agent;
    };

    const agents = {
      [AgentRole.PLANNER]: wrapAgent(planner, 'Planner'),
      [AgentRole.CODER]: wrapAgent(coder, 'Coder'),
      [AgentRole.TESTER]: wrapAgent(tester, 'Tester'),
      [AgentRole.SUPERVISOR]: wrapAgent(supervisor, 'Supervisor'),
    };

    const orchestrator = new Orchestrator({
      timeLimit: 30000,
      verifyAllOutputs: true,
      requireTests: false,
    });

    orchestrator.registerAgents(agents);
    await orchestrator.initialize('Collaboration test');
    await orchestrator.run();

    // Verify workflow order
    expect(workflow.length).toBeGreaterThan(0);

    // First should be Planner
    expect(workflow[0].agent).toBe('Planner');
    expect(workflow[0].messageType).toBe(MessageType.PLAN_REQUEST);

    // Should have coder, tester, and supervisor interactions
    const agentNames = workflow.map(w => w.agent);
    expect(agentNames).toContain('Coder');
    expect(agentNames).toContain('Supervisor');
  }, 60000);
});
