/**
 * Tests for supervisor-agent.js - Output verification and escalation
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  SupervisorAgent,
  EscalationLevel,
  QualityGateType,
  QualityThresholds,
  QualityGateResult,
  ProgressMonitor,
} from '../supervisor-agent.js';
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

// ===== NEW ENHANCEMENT TESTS =====

describe('QualityGateType', () => {
  it('should have correct gate types', () => {
    expect(QualityGateType.PLAN_APPROVAL).toBe('plan_approval');
    expect(QualityGateType.CODE_APPROVAL).toBe('code_approval');
    expect(QualityGateType.STEP_COMPLETION).toBe('step_completion');
    expect(QualityGateType.GOAL_ACHIEVEMENT).toBe('goal_achievement');
  });
});

describe('QualityThresholds', () => {
  it('should have correct threshold values', () => {
    expect(QualityThresholds[QualityGateType.PLAN_APPROVAL]).toBe(70);
    expect(QualityThresholds[QualityGateType.CODE_APPROVAL]).toBe(60);
    expect(QualityThresholds[QualityGateType.STEP_COMPLETION]).toBe(70);
    expect(QualityThresholds[QualityGateType.GOAL_ACHIEVEMENT]).toBe(80);
  });
});

describe('QualityGateResult', () => {
  let gate;

  beforeEach(() => {
    gate = new QualityGateResult(QualityGateType.PLAN_APPROVAL, 'plan_123');
  });

  describe('Initialization', () => {
    it('should create with unique ID', () => {
      expect(gate.id).toMatch(/^gate_\d+_[a-z0-9]+$/);
    });

    it('should have correct initial values', () => {
      expect(gate.gateType).toBe(QualityGateType.PLAN_APPROVAL);
      expect(gate.targetId).toBe('plan_123');
      expect(gate.threshold).toBe(70);
      expect(gate.score).toBe(0);
      expect(gate.passed).toBe(false);
      expect(gate.decision).toBe('pending');
    });
  });

  describe('Evaluation', () => {
    it('should pass when score meets threshold', () => {
      gate.evaluate(75, [], []);

      expect(gate.passed).toBe(true);
      expect(gate.decision).toBe('approved');
      expect(gate.score).toBe(75);
    });

    it('should fail when score below threshold', () => {
      gate.evaluate(65, ['issue1'], []);

      expect(gate.passed).toBe(false);
      expect(gate.decision).toBe('needs_revision');
      expect(gate.issues).toContain('issue1');
    });

    it('should reject when score far below threshold', () => {
      gate.evaluate(45, [], []);

      expect(gate.passed).toBe(false);
      expect(gate.decision).toBe('rejected');
    });

    it('should use custom threshold', () => {
      const customGate = new QualityGateResult(QualityGateType.GOAL_ACHIEVEMENT, 'goal');
      customGate.evaluate(75); // Below 80 threshold for goal achievement

      expect(customGate.passed).toBe(false);
    });
  });

  describe('Summary', () => {
    it('should generate accurate summary', () => {
      gate.evaluate(85, ['minor issue'], []);
      gate.reason = 'Plan looks good';

      const summary = gate.getSummary();

      expect(summary.gateType).toBe(QualityGateType.PLAN_APPROVAL);
      expect(summary.passed).toBe(true);
      expect(summary.score).toBe(85);
      expect(summary.threshold).toBe(70);
      expect(summary.decision).toBe('approved');
      expect(summary.issueCount).toBe(1);
    });
  });
});

describe('ProgressMonitor', () => {
  let monitor;

  beforeEach(() => {
    monitor = new ProgressMonitor({ stallThreshold: 5 * 60 * 1000 }); // 5 minutes
  });

  describe('Initialization', () => {
    it('should initialize with correct defaults', () => {
      expect(monitor.checkpoints).toEqual([]);
      expect(monitor.stallThreshold).toBe(5 * 60 * 1000);
      expect(monitor.progressScores).toEqual([]);
      expect(monitor.stallCount).toBe(0);
    });
  });

  describe('Checkpoint Recording', () => {
    it('should record checkpoints', () => {
      const checkpoint = monitor.recordCheckpoint('executing', {
        completedSteps: 2,
        failedSteps: 0,
      });

      expect(monitor.checkpoints).toHaveLength(1);
      expect(checkpoint.phase).toBe('executing');
      expect(checkpoint.progressScore).toBeGreaterThan(0);
    });

    it('should limit checkpoint history', () => {
      for (let i = 0; i < 110; i++) {
        monitor.recordCheckpoint('phase', { completedSteps: i });
      }

      expect(monitor.checkpoints.length).toBe(100);
    });

    it('should update progress time on positive progress', () => {
      const before = monitor.lastProgressTime;
      monitor.recordCheckpoint('phase', { completedSteps: 1 });

      expect(monitor.lastProgressTime).toBeGreaterThanOrEqual(before);
    });

    it('should increment stall count on zero progress', () => {
      monitor.recordCheckpoint('phase', {});
      expect(monitor.stallCount).toBe(1);

      monitor.recordCheckpoint('phase', {});
      expect(monitor.stallCount).toBe(2);
    });
  });

  describe('Progress Score Calculation', () => {
    it('should calculate positive score for completed steps', () => {
      const score = monitor.calculateProgressScore({ completedSteps: 3 });
      expect(score).toBe(30); // 3 * 10
    });

    it('should subtract for failed steps', () => {
      const score = monitor.calculateProgressScore({
        completedSteps: 2,
        failedSteps: 1,
      });
      expect(score).toBe(15); // (2 * 10) - (1 * 5)
    });

    it('should add for fix cycles', () => {
      const score = monitor.calculateProgressScore({
        fixCycles: 2,
        verificationsPassed: 1,
      });
      expect(score).toBe(7); // (2 * 2) + (1 * 3)
    });

    it('should return 0 for null metrics', () => {
      expect(monitor.calculateProgressScore(null)).toBe(0);
    });
  });

  describe('Stall Detection', () => {
    it('should detect stall after threshold', () => {
      // Fresh monitor is not stalled
      expect(monitor.isStalled()).toBe(false);

      // Simulate time passing without progress
      monitor.lastProgressTime = Date.now() - 6 * 60 * 1000; // 6 minutes ago

      expect(monitor.isStalled()).toBe(true);
    });

    it('should return stall duration', () => {
      const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
      monitor.lastProgressTime = fiveMinutesAgo;

      const duration = monitor.getStallDuration();
      expect(duration).toBeGreaterThanOrEqual(5 * 60 * 1000);
    });
  });

  describe('Progress Trend', () => {
    it('should return unknown with insufficient data', () => {
      expect(monitor.getProgressTrend()).toBe('unknown');

      monitor.recordCheckpoint('p', { completedSteps: 1 });
      monitor.recordCheckpoint('p', { completedSteps: 1 });
      expect(monitor.getProgressTrend()).toBe('unknown');
    });

    it('should detect improving trend', () => {
      // Older, lower scores
      for (let i = 0; i < 5; i++) {
        monitor.progressScores.push(5);
      }
      // Recent, higher scores
      for (let i = 0; i < 5; i++) {
        monitor.progressScores.push(15);
      }

      expect(monitor.getProgressTrend()).toBe('improving');
    });

    it('should detect declining trend', () => {
      // Older, higher scores
      for (let i = 0; i < 5; i++) {
        monitor.progressScores.push(15);
      }
      // Recent, lower scores
      for (let i = 0; i < 5; i++) {
        monitor.progressScores.push(5);
      }

      expect(monitor.getProgressTrend()).toBe('declining');
    });

    it('should detect stable trend', () => {
      for (let i = 0; i < 10; i++) {
        monitor.progressScores.push(10);
      }

      expect(monitor.getProgressTrend()).toBe('stable');
    });
  });

  describe('Summary', () => {
    it('should provide complete summary', () => {
      monitor.recordCheckpoint('planning', { completedSteps: 1 });
      monitor.recordCheckpoint('executing', { completedSteps: 2 });

      const summary = monitor.getSummary();

      expect(summary.checkpointCount).toBe(2);
      expect(summary.isStalled).toBe(false);
      expect(summary.stallDuration).toBeLessThan(1000);
      expect(summary.stallCount).toBe(0);
      expect(summary.trend).toBe('unknown'); // Not enough data
      expect(summary.recentPhases).toContain('executing');
      expect(summary.averageProgressScore).toBeGreaterThan(0);
    });
  });
});

describe('SupervisorAgent Enhanced Features', () => {
  let supervisor;
  let mockClient;
  let mockGoalTracker;

  beforeEach(() => {
    mockClient = { sendPrompt: vi.fn() };
    mockGoalTracker = {
      getGoal: vi.fn().mockReturnValue('Test goal'),
      primaryGoal: 'Test goal',
    };
    supervisor = new SupervisorAgent(mockClient, mockGoalTracker, {
      model: 'sonnet',
      progressMonitor: { stallThreshold: 5 * 60 * 1000 },
    });
  });

  describe('Quality Gate Integration', () => {
    it('should evaluate quality gate on plan verification', async () => {
      mockClient.sendPrompt.mockResolvedValue({
        response: `SCORE: 85\nAPPROVED: YES\nRECOMMENDATION: APPROVE\nREASON: Good plan`,
      });

      const plan = new ExecutionPlan('Build feature', '');
      plan.addStep('Step 1', 'low');

      const request = new AgentMessage(
        MessageType.VERIFY_REQUEST,
        AgentRole.ORCHESTRATOR,
        AgentRole.SUPERVISOR,
        {
          type: VerificationType.PLAN_PRE,
          target: plan,
          context: {},
        }
      );

      const response = await supervisor.handleMessage(request);

      expect(response.payload.qualityGate).toBeDefined();
      expect(response.payload.qualityGate.passed).toBe(true);
      expect(response.payload.qualityGate.gateType).toBe(QualityGateType.PLAN_APPROVAL);
    });

    it('should fail quality gate for low scores', async () => {
      // Score of 40 with threshold 70: far below threshold, should be rejected
      mockClient.sendPrompt.mockResolvedValue({
        response: `SCORE: 40\nAPPROVED: NO\nRECOMMENDATION: REJECT\nREASON: Incomplete plan`,
      });

      const plan = new ExecutionPlan('Bad plan', '');

      const request = new AgentMessage(
        MessageType.VERIFY_REQUEST,
        AgentRole.ORCHESTRATOR,
        AgentRole.SUPERVISOR,
        {
          type: VerificationType.PLAN_PRE,
          target: plan,
          context: {},
        }
      );

      const response = await supervisor.handleMessage(request);

      expect(response.payload.qualityGate.passed).toBe(false);
      // Score 40 is more than 20 below threshold 70, so should be rejected
      expect(response.payload.qualityGate.decision).toBe('rejected');
    });

    it('should track quality gate history', async () => {
      mockClient.sendPrompt.mockResolvedValue({
        response: `SCORE: 75\nVERIFIED: YES\nRECOMMENDATION: continue`,
      });

      // Must use handleMessage to track quality gate history, not direct verifyCode
      const request = new AgentMessage(
        MessageType.VERIFY_REQUEST,
        AgentRole.ORCHESTRATOR,
        AgentRole.SUPERVISOR,
        {
          type: VerificationType.CODE,
          target: { files: [] },
          context: {},
        }
      );

      await supervisor.handleMessage(request);

      expect(supervisor.qualityGateHistory).toHaveLength(1);
      expect(supervisor.qualityGateHistory[0].gateType).toBe(QualityGateType.CODE_APPROVAL);
    });
  });

  describe('Pre-Execution Plan Verification', () => {
    it('should parse plan pre-verification response', async () => {
      mockClient.sendPrompt.mockResolvedValue({
        response: `
SCORE: 75
APPROVED: YES
COMPLETENESS: COMPLETE
ISSUES:
- Consider adding error handling
MISSING_STEPS:
none
RISKS:
- Dependency on external API
RECOMMENDATION: APPROVE
REASON: Plan is solid with minor suggestions.`,
      });

      const plan = new ExecutionPlan('Goal', '');
      plan.addStep('Step 1', 'low');
      const result = await supervisor.verifyPlanPreExecution(plan, {});

      expect(result.verified).toBe(true);
      expect(result.score).toBe(75);
      expect(result.completeness).toBe('COMPLETE');
      expect(result.issues.length).toBeGreaterThan(0);
      expect(result.risks.length).toBeGreaterThan(0);
    });

    it('should identify missing steps', async () => {
      mockClient.sendPrompt.mockResolvedValue({
        response: `
SCORE: 55
APPROVED: NO
COMPLETENESS: PARTIAL
ISSUES:
- Steps are too vague
MISSING_STEPS:
- Add database migration step
- Add rollback plan
RISKS:
none
RECOMMENDATION: REVISE
REASON: Missing critical steps.`,
      });

      const plan = new ExecutionPlan('Goal', '');
      const result = await supervisor.verifyPlanPreExecution(plan, {});

      expect(result.verified).toBe(false);
      expect(result.missingSteps.length).toBe(2);
      expect(result.missingSteps).toContain('Add database migration step');
    });
  });

  describe('Progress Verification', () => {
    it('should verify progress during execution', async () => {
      mockClient.sendPrompt.mockResolvedValue({
        response: `
SCORE: 70
ON_TRACK: YES
PACE: GOOD
ACTION_NEEDED: NONE
CONCERNS: none
RECOMMENDATION: Keep up the good work`,
      });

      const result = await supervisor.verifyProgress({
        currentStep: { description: 'Step 1' },
        metrics: { completedSteps: 2 },
        elapsed: 5 * 60 * 1000,
        remaining: 55 * 60 * 1000,
      }, {});

      expect(result.verified).toBe(true);
      expect(result.onTrack).toBe('YES');
      expect(result.pace).toBe('GOOD');
      expect(result.actionNeeded).toBe('NONE');
    });

    it('should detect stall conditions', async () => {
      // Make monitor stalled
      supervisor.progressMonitor.lastProgressTime = Date.now() - 10 * 60 * 1000;

      mockClient.sendPrompt.mockResolvedValue({
        response: `
SCORE: 30
ON_TRACK: NO
PACE: STALLED
ACTION_NEEDED: INTERVENTION
CONCERNS: No progress for 10 minutes
RECOMMENDATION: Investigate blocking issue`,
      });

      const result = await supervisor.verifyProgress({}, {});

      expect(result.isStalled).toBe(true);
      expect(result.pace).toBe('STALLED');
      expect(result.actionNeeded).toBe('INTERVENTION');
      expect(result.recommendation).toBe('refocus');
    });

    it('should recommend abort when appropriate', async () => {
      mockClient.sendPrompt.mockResolvedValue({
        response: `
SCORE: 10
ON_TRACK: NO
PACE: STALLED
ACTION_NEEDED: ABORT
CONCERNS: Cannot complete goal
RECOMMENDATION: Terminate session`,
      });

      const result = await supervisor.verifyProgress({}, {});

      expect(result.actionNeeded).toBe('ABORT');
      expect(result.recommendation).toBe('abort');
    });
  });

  describe('Progress Monitor Integration', () => {
    it('should record checkpoints during verification', async () => {
      mockClient.sendPrompt.mockResolvedValue({
        response: `VERIFIED: YES\nSCORE: 80\nRECOMMENDATION: continue`,
      });

      const request = new AgentMessage(
        MessageType.VERIFY_REQUEST,
        AgentRole.ORCHESTRATOR,
        AgentRole.SUPERVISOR,
        {
          type: VerificationType.CODE,
          target: { files: [] },
          context: {
            phase: 'executing',
            metrics: { completedSteps: 3, failedSteps: 0 },
          },
        }
      );

      await supervisor.handleMessage(request);

      expect(supervisor.progressMonitor.checkpoints.length).toBe(1);
    });

    it('should include progress status in responses', async () => {
      mockClient.sendPrompt.mockResolvedValue({
        response: `VERIFIED: YES\nSCORE: 80\nRECOMMENDATION: continue`,
      });

      const request = new AgentMessage(
        MessageType.VERIFY_REQUEST,
        AgentRole.ORCHESTRATOR,
        AgentRole.SUPERVISOR,
        {
          type: VerificationType.CODE,
          target: { files: [] },
          context: {},
        }
      );

      const response = await supervisor.handleMessage(request);

      expect(response.payload.progressStatus).toBeDefined();
      expect(response.payload.progressStatus.isStalled).toBeDefined();
      expect(response.payload.progressStatus.trend).toBeDefined();
    });
  });

  describe('Enhanced Statistics', () => {
    it('should provide enhanced stats with quality gates', async () => {
      mockClient.sendPrompt.mockResolvedValue({
        response: `VERIFIED: YES\nSCORE: 80\nRECOMMENDATION: continue`,
      });

      // Use handleMessage to properly track quality gates
      const codeRequest = new AgentMessage(
        MessageType.VERIFY_REQUEST,
        AgentRole.ORCHESTRATOR,
        AgentRole.SUPERVISOR,
        { type: VerificationType.CODE, target: { files: [] }, context: {} }
      );
      const planRequest = new AgentMessage(
        MessageType.VERIFY_REQUEST,
        AgentRole.ORCHESTRATOR,
        AgentRole.SUPERVISOR,
        { type: VerificationType.PLAN, target: new ExecutionPlan('G', ''), context: {} }
      );

      await supervisor.handleMessage(codeRequest);
      await supervisor.handleMessage(planRequest);

      const stats = supervisor.getEnhancedStats();

      expect(stats.qualityGates).toBeDefined();
      expect(stats.qualityGates.total).toBeGreaterThan(0);
      expect(stats.qualityGates.byType).toBeDefined();
      expect(stats.progress).toBeDefined();
      expect(stats.progress.isStalled).toBe(false);
    });

    it('should track quality gate pass rate', async () => {
      mockClient.sendPrompt.mockResolvedValue({
        response: `VERIFIED: YES\nSCORE: 85\nRECOMMENDATION: continue`,
      });

      const request1 = new AgentMessage(
        MessageType.VERIFY_REQUEST,
        AgentRole.ORCHESTRATOR,
        AgentRole.SUPERVISOR,
        { type: VerificationType.CODE, target: { files: [] }, context: {} }
      );
      await supervisor.handleMessage(request1);

      mockClient.sendPrompt.mockResolvedValue({
        response: `VERIFIED: NO\nSCORE: 40\nRECOMMENDATION: fix`,
      });

      const request2 = new AgentMessage(
        MessageType.VERIFY_REQUEST,
        AgentRole.ORCHESTRATOR,
        AgentRole.SUPERVISOR,
        { type: VerificationType.CODE, target: { files: [] }, context: {} }
      );
      await supervisor.handleMessage(request2);

      const stats = supervisor.getEnhancedStats();

      expect(stats.qualityGates.total).toBe(2);
      expect(stats.qualityGates.passed).toBe(1);
      expect(stats.qualityGates.passRate).toBe(50);
    });
  });

  describe('Quality Gate Summary', () => {
    it('should get summary for specific gate type', async () => {
      mockClient.sendPrompt.mockResolvedValue({
        response: `VERIFIED: YES\nSCORE: 80\nRECOMMENDATION: continue`,
      });

      const request1 = new AgentMessage(
        MessageType.VERIFY_REQUEST,
        AgentRole.ORCHESTRATOR,
        AgentRole.SUPERVISOR,
        { type: VerificationType.CODE, target: { files: [] }, context: {} }
      );
      const request2 = new AgentMessage(
        MessageType.VERIFY_REQUEST,
        AgentRole.ORCHESTRATOR,
        AgentRole.SUPERVISOR,
        { type: VerificationType.CODE, target: { files: [] }, context: {} }
      );

      await supervisor.handleMessage(request1);
      await supervisor.handleMessage(request2);

      const summary = supervisor.getQualityGateSummary(QualityGateType.CODE_APPROVAL);

      expect(summary).toBeDefined();
      expect(summary.gateType).toBe(QualityGateType.CODE_APPROVAL);
      expect(summary.total).toBe(2);
      expect(summary.passed).toBe(2);
    });

    it('should return null for missing gate type', () => {
      const summary = supervisor.getQualityGateSummary(QualityGateType.GOAL_ACHIEVEMENT);
      expect(summary).toBeNull();
    });
  });

  describe('Would Pass Gate Check', () => {
    it('should check if score would pass gate', () => {
      expect(supervisor.wouldPassGate(QualityGateType.PLAN_APPROVAL, 75)).toBe(true);
      expect(supervisor.wouldPassGate(QualityGateType.PLAN_APPROVAL, 65)).toBe(false);
      expect(supervisor.wouldPassGate(QualityGateType.GOAL_ACHIEVEMENT, 80)).toBe(true);
      expect(supervisor.wouldPassGate(QualityGateType.GOAL_ACHIEVEMENT, 75)).toBe(false);
    });
  });

  describe('Reset for New Goal', () => {
    it('should reset all state for new goal', async () => {
      mockClient.sendPrompt.mockResolvedValue({
        response: `VERIFIED: YES\nSCORE: 80\nRECOMMENDATION: continue`,
      });

      await supervisor.verifyCode({ files: [] }, {});
      supervisor.consecutiveIssues = 3;
      supervisor.totalCorrections = 5;

      supervisor.resetForNewGoal();

      expect(supervisor.verificationHistory).toHaveLength(0);
      expect(supervisor.assessmentHistory).toHaveLength(0);
      expect(supervisor.qualityGateHistory).toHaveLength(0);
      expect(supervisor.consecutiveIssues).toBe(0);
      expect(supervisor.totalCorrections).toBe(0);
      expect(supervisor.progressMonitor.checkpoints).toHaveLength(0);
    });
  });

  describe('Custom Quality Thresholds', () => {
    it('should accept custom thresholds in config', () => {
      const customSupervisor = new SupervisorAgent(mockClient, mockGoalTracker, {
        qualityThresholds: {
          [QualityGateType.PLAN_APPROVAL]: 85,
          [QualityGateType.CODE_APPROVAL]: 75,
        },
      });

      expect(customSupervisor.qualityThresholds[QualityGateType.PLAN_APPROVAL]).toBe(85);
      expect(customSupervisor.qualityThresholds[QualityGateType.CODE_APPROVAL]).toBe(75);
    });
  });
});
