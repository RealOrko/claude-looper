/**
 * Tests for message-bus.js - Inter-agent communication
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MessageBus, Messages } from '../message-bus.js';
import { MessageType, AgentRole, AgentMessage } from '../interfaces.js';

describe('MessageBus', () => {
  let messageBus;

  beforeEach(() => {
    messageBus = new MessageBus();
  });

  describe('Agent Registration', () => {
    it('should register agents', () => {
      const mockAgent = {
        handleMessage: vi.fn(),
        getId: () => 'test-agent',
      };

      messageBus.registerAgent('test', mockAgent);

      expect(messageBus.agents.get('test')).toBe(mockAgent);
    });

    it('should unregister agents', () => {
      const mockAgent = {
        handleMessage: vi.fn(),
        getId: () => 'test-agent',
      };

      messageBus.registerAgent('test', mockAgent);
      messageBus.unregisterAgent('test');

      expect(messageBus.agents.has('test')).toBe(false);
    });
  });

  describe('Message Sending', () => {
    it('should send messages to registered agents', async () => {
      const mockAgent = {
        handleMessage: vi.fn().mockResolvedValue({ result: 'ok' }),
        getId: () => 'planner',
      };

      messageBus.registerAgent(AgentRole.PLANNER, mockAgent);

      const message = new AgentMessage(
        MessageType.PLAN_REQUEST,
        AgentRole.ORCHESTRATOR,
        AgentRole.PLANNER,
        { goal: 'test' }
      );

      await messageBus.send(message);

      expect(mockAgent.handleMessage).toHaveBeenCalledWith(message);
    });

    it('should throw error for unregistered recipient', async () => {
      const message = new AgentMessage(
        MessageType.PLAN_REQUEST,
        AgentRole.ORCHESTRATOR,
        'nonexistent',
        {}
      );

      await expect(messageBus.send(message)).rejects.toThrow('Target agent not found');
    });

    it('should track message history', async () => {
      const mockAgent = {
        handleMessage: vi.fn().mockResolvedValue({}),
        getId: () => 'tester',
      };

      messageBus.registerAgent(AgentRole.TESTER, mockAgent);

      const message = new AgentMessage(
        MessageType.TEST_REQUEST,
        AgentRole.ORCHESTRATOR,
        AgentRole.TESTER,
        {}
      );

      await messageBus.send(message);

      expect(messageBus.messageHistory.length).toBe(1);
      expect(messageBus.messageHistory[0].type).toBe(MessageType.TEST_REQUEST);
    });
  });

  describe('Request-Response Pattern', () => {
    it('should timeout if no response', async () => {
      const slowAgent = {
        handleMessage: vi.fn(() => new Promise(() => {})), // Never resolves
        getId: () => 'slow',
      };

      messageBus.registerAgent('slow', slowAgent);

      const message = new AgentMessage(
        MessageType.CODE_REQUEST,
        AgentRole.ORCHESTRATOR,
        'slow',
        {}
      );

      await expect(messageBus.request(message, 100)).rejects.toThrow(/timed out/);
    }, 5000);

    it('should return response from send() when agent handles message', async () => {
      const mockAgent = {
        handleMessage: vi.fn(async (msg) => {
          const response = msg.createResponse(MessageType.PLAN_RESPONSE, { plan: {} });
          return response;
        }),
        getId: () => 'planner',
      };

      messageBus.registerAgent(AgentRole.PLANNER, mockAgent);

      const request = new AgentMessage(
        MessageType.PLAN_REQUEST,
        AgentRole.ORCHESTRATOR,
        AgentRole.PLANNER,
        { goal: 'test' }
      );

      // send() returns the result from handleMessage
      const result = await messageBus.send(request);
      expect(result.type).toBe(MessageType.PLAN_RESPONSE);
    });
  });

  describe('Message History', () => {
    it('should filter history by type', async () => {
      const agent1 = {
        handleMessage: vi.fn().mockResolvedValue({}),
        getId: () => 'a1',
      };
      const agent2 = {
        handleMessage: vi.fn().mockResolvedValue({}),
        getId: () => 'a2',
      };
      const orchestratorAgent = {
        handleMessage: vi.fn().mockResolvedValue({}),
        getId: () => 'orch',
      };

      messageBus.registerAgent(AgentRole.PLANNER, agent1);
      messageBus.registerAgent(AgentRole.CODER, agent2);
      messageBus.registerAgent(AgentRole.ORCHESTRATOR, orchestratorAgent);

      await messageBus.send(new AgentMessage(MessageType.PLAN_REQUEST, AgentRole.ORCHESTRATOR, AgentRole.PLANNER, {}));
      await messageBus.send(new AgentMessage(MessageType.CODE_REQUEST, AgentRole.ORCHESTRATOR, AgentRole.CODER, {}));

      const planMessages = messageBus.getHistory({ type: MessageType.PLAN_REQUEST });
      expect(planMessages.length).toBe(1);
    });

    it('should filter history by agent', async () => {
      const agent = {
        handleMessage: vi.fn().mockResolvedValue({}),
        getId: () => 'test',
      };

      messageBus.registerAgent('agent1', agent);
      messageBus.registerAgent('agent2', agent);

      await messageBus.send(new AgentMessage('TYPE_A', 'sender', 'agent1', {}));
      await messageBus.send(new AgentMessage('TYPE_B', 'sender', 'agent2', {}));
      await messageBus.send(new AgentMessage('TYPE_C', 'sender', 'agent1', {}));

      const agent1Messages = messageBus.getHistory({ to: 'agent1' });
      expect(agent1Messages.length).toBe(2);
    });
  });

  describe('Statistics', () => {
    it('should track message statistics', async () => {
      const agent = {
        handleMessage: vi.fn().mockResolvedValue({}),
        getId: () => 'stats-agent',
      };

      messageBus.registerAgent('test', agent);

      await messageBus.send(new AgentMessage('A', 'x', 'test', {}));
      await messageBus.send(new AgentMessage('B', 'x', 'test', {}));
      await messageBus.send(new AgentMessage('A', 'x', 'test', {}));

      const stats = messageBus.getStats();

      expect(stats.totalMessages).toBe(3);
      expect(stats.messagesByType.A).toBe(2);
      expect(stats.messagesByType.B).toBe(1);
    });
  });

  describe('Subscriptions', () => {
    it('should allow subscribing to message types', () => {
      const handler = vi.fn();
      const unsubscribe = messageBus.subscribe(MessageType.ESCALATION, handler);

      messageBus.notify(MessageType.ESCALATION, { level: 'critical' });

      expect(handler).toHaveBeenCalledWith({ level: 'critical' });

      unsubscribe();
      messageBus.notify(MessageType.ESCALATION, { level: 'low' });

      expect(handler).toHaveBeenCalledTimes(1);
    });
  });
});

describe('Messages Factory', () => {
  it('should create plan request', () => {
    const msg = Messages.planRequest(AgentRole.ORCHESTRATOR, 'Build app', { context: 'test' });

    expect(msg.type).toBe(MessageType.PLAN_REQUEST);
    expect(msg.to).toBe(AgentRole.PLANNER);
    expect(msg.payload.goal).toBe('Build app');
    expect(msg.payload.context.context).toBe('test');
  });

  it('should create code request', () => {
    const step = { id: 'step_1', description: 'Implement feature' };
    const msg = Messages.codeRequest(AgentRole.ORCHESTRATOR, step, { iteration: 1 });

    expect(msg.type).toBe(MessageType.CODE_REQUEST);
    expect(msg.to).toBe(AgentRole.CODER);
    expect(msg.payload.step).toBe(step);
    expect(msg.payload.context.iteration).toBe(1);
  });

  it('should create test request', () => {
    const step = { id: 'step_1' };
    const codeOutput = { files: [] };
    const msg = Messages.testRequest(AgentRole.ORCHESTRATOR, step, codeOutput);

    expect(msg.type).toBe(MessageType.TEST_REQUEST);
    expect(msg.to).toBe(AgentRole.TESTER);
    expect(msg.payload.step).toBe(step);
    expect(msg.payload.codeOutput).toBe(codeOutput);
  });

  it('should create verify request', () => {
    const msg = Messages.verifyRequest(
      AgentRole.ORCHESTRATOR,
      'plan',
      { plan: {} },
      { state: {} }
    );

    expect(msg.type).toBe(MessageType.VERIFY_REQUEST);
    expect(msg.to).toBe(AgentRole.SUPERVISOR);
    expect(msg.payload.type).toBe('plan');
    expect(msg.payload.target).toBeDefined();
  });

  it('should create replan request', () => {
    const step = { id: 'step_1', description: 'Blocked step' };
    const msg = Messages.replanRequest(AgentRole.ORCHESTRATOR, step, 'dependency missing', 1);

    expect(msg.type).toBe(MessageType.REPLAN_REQUEST);
    expect(msg.to).toBe(AgentRole.PLANNER);
    expect(msg.payload.blockedStep).toBe(step);
    expect(msg.payload.reason).toBe('dependency missing');
    expect(msg.payload.depth).toBe(1);
  });

  it('should create code fix request', () => {
    const step = { id: 'step_1' };
    const fixPlan = { issues: [{ severity: 'major', description: 'bug' }] };
    const msg = Messages.codeFixRequest(AgentRole.ORCHESTRATOR, step, fixPlan);

    expect(msg.type).toBe(MessageType.CODE_FIX_REQUEST);
    expect(msg.to).toBe(AgentRole.CODER);
    expect(msg.payload.step).toBe(step);
    expect(msg.payload.fixPlan).toBe(fixPlan);
  });

  it('should create escalation message', () => {
    const msg = Messages.escalation(
      'critical',
      'Multiple failures detected',
      'Request human intervention'
    );

    expect(msg.type).toBe(MessageType.ESCALATION);
    expect(msg.to).toBe(AgentRole.ORCHESTRATOR);
    expect(msg.payload.level).toBe('critical');
    expect(msg.payload.reason).toBe('Multiple failures detected');
    expect(msg.payload.recommendation).toBe('Request human intervention');
  });
});
