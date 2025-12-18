/**
 * Tests for orchestrator.js - Main execution loop
 *
 * Note: These tests focus on unit testing the Orchestrator's logic
 * without requiring the full message bus request-response patterns.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Orchestrator } from '../orchestrator.js';
import { AgentRole, MessageType, PlanDepth, ExecutionPlan, PlanStep, AgentMessage } from '../interfaces.js';

// Create mock agent that returns proper responses
function createMockAgent(role) {
  return {
    role,
    status: 'idle',
    handleMessage: vi.fn(async (msg) => {
      // Return a proper response based on message type
      return msg.createResponse(
        msg.type.replace('_request', '_response').replace('_REQUEST', '_RESPONSE'),
        { success: true }
      );
    }),
    getId: () => `${role}-agent`,
    getStats: () => ({ role, status: 'idle' }),
  };
}

describe('Orchestrator', () => {
  let orchestrator;
  let mockPlanner;
  let mockCoder;
  let mockTester;
  let mockSupervisor;

  beforeEach(() => {
    orchestrator = new Orchestrator({
      maxFixCycles: 2,
      maxStepAttempts: 2,
      timeLimit: 60000,
      verifyAllOutputs: false, // Disable verification for simpler tests
    });

    mockPlanner = createMockAgent(AgentRole.PLANNER);
    mockCoder = createMockAgent(AgentRole.CODER);
    mockTester = createMockAgent(AgentRole.TESTER);
    mockSupervisor = createMockAgent(AgentRole.SUPERVISOR);

    orchestrator.registerAgents({
      [AgentRole.PLANNER]: mockPlanner,
      [AgentRole.CODER]: mockCoder,
      [AgentRole.TESTER]: mockTester,
      [AgentRole.SUPERVISOR]: mockSupervisor,
    });
  });

  describe('Initialization', () => {
    it('should initialize with a goal', async () => {
      const state = await orchestrator.initialize('Build a web app');

      expect(state.primaryGoal).toBe('Build a web app');
      expect(state.status).toBe('initializing'); // Initial status before planning
      expect(orchestrator.startTime).toBeDefined();
    });

    it('should accept context during initialization', async () => {
      const state = await orchestrator.initialize('Build app', { codebase: '/path/to/code' });

      expect(state.context.codebase).toBe('/path/to/code');
    });

    it('should emit initialized event', async () => {
      const eventHandler = vi.fn();
      orchestrator.on('initialized', eventHandler);

      await orchestrator.initialize('Test goal');

      expect(eventHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          goal: 'Test goal',
        })
      );
    });
  });

  describe('Configuration', () => {
    it('should use default configuration values', () => {
      const orch = new Orchestrator();
      expect(orch.config.maxFixCycles).toBeDefined();
      expect(orch.config.timeLimit).toBeDefined();
    });

    it('should accept custom configuration', () => {
      const orch = new Orchestrator({
        maxFixCycles: 5,
        timeLimit: 120000,
      });
      expect(orch.config.maxFixCycles).toBe(5);
      expect(orch.config.timeLimit).toBe(120000);
    });
  });

  describe('Agent Registration', () => {
    it('should register agents with message bus', () => {
      expect(orchestrator.agents[AgentRole.PLANNER]).toBe(mockPlanner);
      expect(orchestrator.agents[AgentRole.CODER]).toBe(mockCoder);
      expect(orchestrator.agents[AgentRole.TESTER]).toBe(mockTester);
      expect(orchestrator.agents[AgentRole.SUPERVISOR]).toBe(mockSupervisor);
    });

    it('should register orchestrator itself', () => {
      expect(orchestrator.messageBus.getAgent(AgentRole.ORCHESTRATOR)).toBeDefined();
    });
  });

  describe('Time Limits', () => {
    it('should check time expiration', async () => {
      orchestrator.config.timeLimit = 1000;
      await orchestrator.initialize('Time test');

      expect(orchestrator.isTimeExpired()).toBe(false);

      // Simulate time passing
      orchestrator.startTime = Date.now() - 2000;

      expect(orchestrator.isTimeExpired()).toBe(true);
    });

    it('should return false if not started', () => {
      expect(orchestrator.isTimeExpired()).toBe(false);
    });
  });

  describe('State Management', () => {
    it('should track state through initialization', async () => {
      await orchestrator.initialize('State test');

      expect(orchestrator.state).toBeDefined();
      expect(orchestrator.state.primaryGoal).toBe('State test');
    });

    it('should provide state summary', async () => {
      await orchestrator.initialize('Summary test');

      const summary = orchestrator.getState();
      expect(summary).toBeDefined();
      expect(summary.status).toBe('initializing');
    });
  });

  describe('Stopping', () => {
    it('should stop gracefully', async () => {
      const stoppingHandler = vi.fn();
      orchestrator.on('stopping', stoppingHandler);

      orchestrator.stop();

      expect(orchestrator.shouldStop).toBe(true);
      expect(stoppingHandler).toHaveBeenCalled();
    });
  });

  describe('Recursive Re-planning State', () => {
    it('should limit recursion to 3 levels via state', async () => {
      await orchestrator.initialize('Recursion test');

      // Push plans to reach max depth
      for (let i = 0; i <= 3; i++) {
        const plan = new ExecutionPlan(`Level ${i}`, '');
        plan.depth = i;
        orchestrator.state.pushPlan(plan);
      }

      expect(orchestrator.state.getPlanDepth()).toBe(3); // Stack has 3 (0 pushed + 3 more)
      expect(orchestrator.state.canCreateSubPlan()).toBe(false);
    });

    it('should allow sub-plans within limit', async () => {
      await orchestrator.initialize('Sub-plan test');

      const plan = new ExecutionPlan('Root', '');
      plan.depth = 0;
      orchestrator.state.pushPlan(plan);

      expect(orchestrator.state.canCreateSubPlan()).toBe(true);
    });
  });

  describe('Report Generation', () => {
    it('should generate execution report', async () => {
      await orchestrator.initialize('Report test');
      orchestrator.state.currentPlan = new ExecutionPlan('Goal', '');
      orchestrator.state.currentPlan.addStep('Step 1', 'low');
      orchestrator.state.metrics.completedSteps = 1;
      orchestrator.state.status = 'completed';
      orchestrator.state.endTime = Date.now();

      const report = orchestrator.generateReport();

      expect(report.status).toBe('completed');
      expect(report.goal).toBe('Report test');
      expect(report.plan).toBeDefined();
      expect(report.metrics).toBeDefined();
      expect(report.elapsed).toBeDefined();
    });

    it('should include agent stats in report', async () => {
      await orchestrator.initialize('Agent stats test');
      orchestrator.state.currentPlan = new ExecutionPlan('Goal', '');

      const report = orchestrator.generateReport();

      expect(report.agentStats).toBeDefined();
    });
  });

  describe('Plan Stack Operations', () => {
    it('should handle plan stack push/pop', async () => {
      await orchestrator.initialize('Stack test');

      const rootPlan = new ExecutionPlan('Root', '');
      const subPlan = new ExecutionPlan('Sub', '');
      subPlan.depth = 1;

      orchestrator.state.pushPlan(rootPlan);
      expect(orchestrator.state.currentPlan).toBe(rootPlan);
      expect(orchestrator.state.getPlanDepth()).toBe(0);

      orchestrator.state.pushPlan(subPlan);
      expect(orchestrator.state.currentPlan).toBe(subPlan);
      expect(orchestrator.state.getPlanDepth()).toBe(1);

      orchestrator.state.popPlan();
      expect(orchestrator.state.currentPlan).toBe(rootPlan);
    });
  });

  describe('Test Requirement Helpers', () => {
    it('should build test requirement prompt', async () => {
      await orchestrator.initialize('Test prompt');

      const step = new PlanStep(1, 'Implement feature', 'medium');
      const prompt = orchestrator.buildTestRequirementPrompt(step);

      expect(prompt).toContain('TESTS REQUIRED');
      expect(prompt).toContain('Implement feature');
    });

    it('should check for required tests', () => {
      const withTests = { tests: [{ path: 'test.js' }] };
      const withoutTests = { tests: [] };
      const noOutput = null;

      expect(orchestrator.hasRequiredTests(withTests)).toBe(true);
      expect(orchestrator.hasRequiredTests(withoutTests)).toBe(false);
      expect(orchestrator.hasRequiredTests(noOutput)).toBe(false);
    });

    it('should get test coverage summary', () => {
      const step = new PlanStep(1, 'Step', 'low');
      step.codeOutput = {
        tests: [
          { path: 'test/unit.test.js', testType: 'unit' },
          { path: 'test/integration.test.js', testType: 'integration' },
        ],
      };

      const coverage = orchestrator.getTestCoverage(step);

      expect(coverage.hasTests).toBe(true);
      expect(coverage.count).toBe(2);
      expect(coverage.paths).toContain('test/unit.test.js');
    });
  });

  describe('Event Emission', () => {
    it('should emit events during initialization', async () => {
      const initHandler = vi.fn();
      orchestrator.on('initialized', initHandler);

      await orchestrator.initialize('Event test');

      expect(initHandler).toHaveBeenCalled();
    });

    it('should emit events during stopping', () => {
      const stopHandler = vi.fn();
      orchestrator.on('stopping', stopHandler);

      orchestrator.stop();

      expect(stopHandler).toHaveBeenCalled();
    });
  });

  describe('Message Bus Integration', () => {
    it('should forward message bus events', () => {
      const messageHandler = vi.fn();
      orchestrator.on('message', messageHandler);

      orchestrator.messageBus.emit('message_sent', { id: 'test', type: 'TEST' });

      expect(messageHandler).toHaveBeenCalledWith(
        expect.objectContaining({ direction: 'sent' })
      );
    });
  });
});
