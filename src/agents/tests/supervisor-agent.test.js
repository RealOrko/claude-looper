/**
 * Tests for supervisor-agent.js - Output verification and escalation
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SupervisorAgent, EscalationLevel } from '../supervisor-agent.js';
import { MessageType, AgentRole, AgentMessage, VerificationType, ExecutionPlan, PlanStep } from '../interfaces.js';

// Mock Claude client
function createMockClient() {
  return {
    sendPrompt: vi.fn(),
  };
}

// Mock goal tracker
function createMockGoalTracker() {
  return {
    getGoal: vi.fn().mockReturnValue('Test goal'),
    getProgress: vi.fn().mockReturnValue(50),
  };
}

describe('EscalationLevel', () => {
  it('should have correct escalation levels', () => {
    expect(EscalationLevel.NONE).toBe('none');
    expect(EscalationLevel.REMIND).toBe('remind');
    expect(EscalationLevel.CORRECT).toBe('correct');
    expect(EscalationLevel.REFOCUS).toBe('refocus');
    expect(EscalationLevel.CRITICAL).toBe('critical');
    expect(EscalationLevel.ABORT).toBe('abort');
  });
});

describe('SupervisorAgent', () => {
  let supervisor;
  let mockClient;
  let mockGoalTracker;

  beforeEach(() => {
    mockClient = createMockClient();
    mockGoalTracker = createMockGoalTracker();
    supervisor = new SupervisorAgent(mockClient, mockGoalTracker, {
      model: 'sonnet',
    });
  });

  describe('Initialization', () => {
    it('should initialize with correct role', () => {
      expect(supervisor.role).toBe(AgentRole.SUPERVISOR);
    });

    it('should use configured model', () => {
      expect(supervisor.model).toBe('sonnet');
    });

    it('should have message handlers registered', () => {
      expect(supervisor.messageHandlers.size).toBeGreaterThan(0);
    });

    it('should initialize tracking state', () => {
      expect(supervisor.consecutiveIssues).toBe(0);
      expect(supervisor.verificationHistory).toEqual([]);
    });
  });

  describe('Plan Verification', () => {
    it('should verify valid plans', async () => {
      mockClient.sendPrompt.mockResolvedValue({
        response: `
SCORE: 90
APPROVED: YES
ISSUES: none
MISSING: none
RECOMMENDATION: APPROVE
REASON: Plan is well-structured and addresses the goal.
`,
      });

      const plan = new ExecutionPlan('Build a REST API', 'Analysis');
      plan.addStep('Setup project', 'low');
      plan.addStep('Implement endpoints', 'medium');

      const result = await supervisor.verifyPlan(plan, { goal: 'Build a REST API' });

      expect(result.verified).toBe(true);
      expect(result.score).toBeGreaterThanOrEqual(80);
    });

    it('should reject inadequate plans', async () => {
      mockClient.sendPrompt.mockResolvedValue({
        response: `
SCORE: 40
APPROVED: NO
ISSUES: Missing database setup step, No error handling
MISSING: database configuration
RECOMMENDATION: REJECT
REASON: Plan is too vague and missing key steps.
`,
      });

      const plan = new ExecutionPlan('Build API', '');
      plan.addStep('Do everything', 'high');

      const result = await supervisor.verifyPlan(plan, { goal: 'Build API' });

      expect(result.verified).toBe(false);
    });
  });

  describe('Code Verification', () => {
    it('should verify correct code output', async () => {
      mockClient.sendPrompt.mockResolvedValue({
        response: `
VERIFIED: YES
SCORE: 85
ASSESSMENT: Code correctly implements the required functionality.
ISSUES: None
RECOMMENDATION: continue
`,
      });

      const codeOutput = {
        files: [{ path: 'src/app.js', content: 'function app() {}' }],
        tests: [{ path: 'test/app.test.js' }],
        summary: 'Implemented app function',
      };

      const result = await supervisor.verifyCode(codeOutput, {
        step: { description: 'Implement app function' },
      });

      expect(result.verified).toBe(true);
    });

    it('should fail code with issues', async () => {
      mockClient.sendPrompt.mockResolvedValue({
        response: `
VERIFIED: NO
SCORE: 30
ASSESSMENT: Code has security vulnerabilities.
ISSUES:
- SQL injection risk in query builder
- Missing input sanitization
RECOMMENDATION: fix
`,
      });

      const codeOutput = {
        files: [{ path: 'src/db.js', content: 'query = "SELECT * FROM " + input' }],
      };

      const result = await supervisor.verifyCode(codeOutput, {});

      expect(result.verified).toBe(false);
    });
  });

  describe('Test Results Verification', () => {
    it('should verify passing tests', async () => {
      mockClient.sendPrompt.mockResolvedValue({
        response: `
VERIFIED: YES
SCORE: 95
ASSESSMENT: Tests are comprehensive and passing.
ISSUES: None
RECOMMENDATION: continue
`,
      });

      const testResult = {
        passed: true,
        issues: [],
        coverage: 'GOOD',
      };

      const result = await supervisor.verifyTestResults(testResult, {});

      expect(result.verified).toBe(true);
    });
  });

  describe('Goal Verification', () => {
    it('should verify goal achievement', async () => {
      mockClient.sendPrompt.mockResolvedValue({
        response: `
GOAL_ACHIEVED: YES
CONFIDENCE: HIGH
COMPLETENESS: 95
FUNCTIONAL: YES
RECOMMENDATION: ACCEPT
REASON: All requirements have been met.
`,
      });

      const target = {
        goal: 'Build a TODO app',
        plan: new ExecutionPlan('Build TODO', ''),
        metrics: { completedSteps: 5, totalSteps: 5 },
      };

      const result = await supervisor.verifyGoalAchievement(target, {});

      expect(result.verified).toBe(true);
    });

    it('should identify incomplete goals', async () => {
      mockClient.sendPrompt.mockResolvedValue({
        response: `
GOAL_ACHIEVED: PARTIAL
CONFIDENCE: MEDIUM
COMPLETENESS: 60
FUNCTIONAL: YES
RECOMMENDATION: NEEDS_WORK
REASON: Goal partially achieved but missing key features.
`,
      });

      const target = {
        goal: 'Build a TODO app with user accounts',
        plan: new ExecutionPlan('Build TODO', ''),
        metrics: { completedSteps: 3, totalSteps: 5 },
      };

      const result = await supervisor.verifyGoalAchievement(target, {});

      expect(result.verified).toBe(false);
    });
  });

  describe('Escalation Tracking', () => {
    it('should have escalation thresholds configured', () => {
      expect(supervisor.thresholds).toBeDefined();
      expect(supervisor.thresholds.warn).toBeDefined();
      expect(supervisor.thresholds.intervene).toBeDefined();
      expect(supervisor.thresholds.critical).toBeDefined();
      expect(supervisor.thresholds.abort).toBeDefined();
    });

    it('should initialize with zero consecutive issues', () => {
      expect(supervisor.consecutiveIssues).toBe(0);
    });

    it('should have verification history array', () => {
      expect(supervisor.verificationHistory).toBeDefined();
      expect(Array.isArray(supervisor.verificationHistory)).toBe(true);
    });
  });

  describe('Message Handling', () => {
    it('should handle VERIFY_REQUEST for plans', async () => {
      mockClient.sendPrompt.mockResolvedValue({
        response: `VERIFIED: YES\nSCORE: 90\nASSESSMENT: Good\nRECOMMENDATION: continue`,
      });

      const plan = new ExecutionPlan('Goal', '');
      plan.addStep('Step 1', 'low');

      const request = new AgentMessage(
        MessageType.VERIFY_REQUEST,
        AgentRole.ORCHESTRATOR,
        AgentRole.SUPERVISOR,
        {
          type: VerificationType.PLAN,
          target: plan,
          context: {},
        }
      );

      const response = await supervisor.handleMessage(request);

      expect(response.type).toBe(MessageType.VERIFY_RESPONSE);
      expect(response.payload).toBeDefined();
    });

    it('should handle VERIFY_REQUEST for code', async () => {
      mockClient.sendPrompt.mockResolvedValue({
        response: `VERIFIED: YES\nSCORE: 85\nASSESSMENT: Good code\nRECOMMENDATION: continue`,
      });

      const request = new AgentMessage(
        MessageType.VERIFY_REQUEST,
        AgentRole.ORCHESTRATOR,
        AgentRole.SUPERVISOR,
        {
          type: VerificationType.CODE,
          target: { files: [{ path: 'app.js' }] },
          context: {},
        }
      );

      const response = await supervisor.handleMessage(request);

      expect(response.type).toBe(MessageType.VERIFY_RESPONSE);
    });

    it('should handle VERIFY_REQUEST for goals', async () => {
      mockClient.sendPrompt.mockResolvedValue({
        response: `VERIFIED: YES\nSCORE: 95\nGOAL_ACHIEVED: YES\nRECOMMENDATION: continue`,
      });

      const request = new AgentMessage(
        MessageType.VERIFY_REQUEST,
        AgentRole.ORCHESTRATOR,
        AgentRole.SUPERVISOR,
        {
          type: VerificationType.GOAL,
          target: { goal: 'Build app', plan: new ExecutionPlan('G', ''), metrics: {} },
          context: {},
        }
      );

      const response = await supervisor.handleMessage(request);

      expect(response.type).toBe(MessageType.VERIFY_RESPONSE);
    });
  });

  describe('Statistics', () => {
    it('should track verification statistics', async () => {
      mockClient.sendPrompt.mockResolvedValue({
        response: `VERIFIED: YES\nSCORE: 90\nRECOMMENDATION: continue`,
      });

      await supervisor.verifyCode({ files: [] }, {});
      await supervisor.verifyPlan(new ExecutionPlan('G', ''), {});

      const stats = supervisor.getStats();

      expect(stats.role).toBe(AgentRole.SUPERVISOR);
    });
  });
});
