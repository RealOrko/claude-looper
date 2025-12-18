/**
 * Tests for planner-agent.js - Planning and recursive re-planning
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PlannerAgent } from '../planner-agent.js';
import { MessageType, AgentRole, PlanDepth, AgentMessage, ExecutionPlan } from '../interfaces.js';

// Mock Claude client
function createMockClient() {
  return {
    sendPrompt: vi.fn(),
    startSession: vi.fn(),
  };
}

describe('PlannerAgent', () => {
  let planner;
  let mockClient;

  beforeEach(() => {
    mockClient = createMockClient();
    planner = new PlannerAgent(mockClient, {
      model: 'opus',
      workingDirectory: '/test/project',
    });
  });

  describe('Initialization', () => {
    it('should initialize with correct role', () => {
      expect(planner.role).toBe(AgentRole.PLANNER);
    });

    it('should use configured model', () => {
      expect(planner.model).toBe('opus');
    });

    it('should have message handlers registered', () => {
      expect(planner.messageHandlers.size).toBeGreaterThan(0);
    });

    it('should initialize plan history', () => {
      expect(planner.planHistory).toEqual([]);
    });
  });

  describe('Plan Creation', () => {
    it('should create a plan from goal', async () => {
      mockClient.sendPrompt.mockResolvedValue({
        response: `
ANALYSIS:
This is a test analysis of the goal.

PLAN:
1. First step to implement | simple
2. Second step with more complexity | medium
3. Final complex step | complex

DEPENDENCIES:
Step 2 depends on Step 1

RISKS:
- Might need external dependencies

TOTAL_STEPS: 3
`,
      });

      const plan = await planner.createPlan('Build a test application');

      expect(plan).toBeDefined();
      expect(plan.goal).toBe('Build a test application');
      expect(plan.steps.length).toBeGreaterThan(0);
    });

    it('should have plan history array', () => {
      expect(planner.planHistory).toBeDefined();
      expect(Array.isArray(planner.planHistory)).toBe(true);
    });
  });

  describe('Recursive Re-planning', () => {
    it('should create sub-plan for blocked step', async () => {
      const blockedStep = {
        id: 'step_1',
        number: 1,
        description: 'Implement complex feature',
        complexity: 'high',
      };

      mockClient.sendPrompt.mockResolvedValue({
        response: `
ANALYSIS: Breaking down the blocked step

PLAN:
1. First sub-task | simple
2. Second sub-task | simple
3. Third sub-task | medium

TOTAL_STEPS: 3
`,
      });

      const subPlan = await planner.createSubPlan(blockedStep, 'too complex', PlanDepth.LEVEL_1);

      expect(subPlan).toBeDefined();
      expect(subPlan.depth).toBe(PlanDepth.LEVEL_1);
      expect(subPlan.parentStepId).toBe('step_1');
    });
  });

  describe('Message Handling', () => {
    it('should handle PLAN_REQUEST message', async () => {
      mockClient.sendPrompt.mockResolvedValue({
        response: `
ANALYSIS: Planning response

PLAN:
1. Test step | simple

TOTAL_STEPS: 1
`,
      });

      const request = new AgentMessage(
        MessageType.PLAN_REQUEST,
        AgentRole.ORCHESTRATOR,
        AgentRole.PLANNER,
        { goal: 'Test goal', context: {} }
      );

      const response = await planner.handleMessage(request);

      expect(response.type).toBe(MessageType.PLAN_RESPONSE);
      expect(response.payload.plan).toBeDefined();
    });

    it('should handle REPLAN_REQUEST message', async () => {
      mockClient.sendPrompt.mockResolvedValue({
        response: `
ANALYSIS: Re-planning

PLAN:
1. Alternative approach | simple

TOTAL_STEPS: 1
`,
      });

      const request = new AgentMessage(
        MessageType.REPLAN_REQUEST,
        AgentRole.ORCHESTRATOR,
        AgentRole.PLANNER,
        {
          blockedStep: { id: 'step_1', description: 'Blocked' },
          reason: 'dependency issue',
          depth: 0,
        }
      );

      const response = await planner.handleMessage(request);

      // Response type depends on implementation - could be PLAN_RESPONSE or SUBPLAN_RESPONSE
      expect(response.payload.plan).toBeDefined();
      expect(response.payload.plan.depth).toBe(1);
    });

    it('should reject REPLAN_REQUEST at max depth', async () => {
      const request = new AgentMessage(
        MessageType.REPLAN_REQUEST,
        AgentRole.ORCHESTRATOR,
        AgentRole.PLANNER,
        {
          blockedStep: { id: 'step_1', description: 'Blocked' },
          reason: 'issue',
          depth: PlanDepth.LEVEL_3, // Already at max
        }
      );

      const response = await planner.handleMessage(request);

      expect(response.payload.success).toBe(false);
      expect(response.payload.error).toContain('depth');
    });
  });

  describe('Prompt Building', () => {
    it('should build comprehensive planning prompt', () => {
      const prompt = planner.buildPlanningPrompt('Build a REST API', {
        additionalContext: 'Node.js project',
      });

      expect(prompt).toContain('Build a REST API');
      expect(prompt).toContain('Node.js project');
      expect(prompt).toContain('PLAN:');
      expect(prompt).toContain('simple');
      expect(prompt).toContain('medium');
      expect(prompt).toContain('complex');
    });

    it('should build sub-plan prompt with parent context', () => {
      const blockedStep = {
        id: 'step_2',
        number: 2,
        description: 'Implement authentication',
        complexity: 'high',
      };

      const prompt = planner.buildSubPlanPrompt(blockedStep, 'missing JWT library', 2);

      expect(prompt).toContain('Implement authentication');
      expect(prompt).toContain('missing JWT library');
      // Depth 2 means we're creating a level 2 sub-plan
      expect(prompt).toContain('SUB-SUB-PLAN');
    });
  });

  describe('Statistics', () => {
    it('should track planning statistics', () => {
      const stats = planner.getStats();

      expect(stats.role).toBe(AgentRole.PLANNER);
    });
  });
});
