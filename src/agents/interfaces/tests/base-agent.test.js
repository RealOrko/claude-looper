/**
 * Tests for Base Agent Module
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BaseAgent } from '../base-agent.js';
import { AgentRole, AgentStatus, MessageType } from '../enums.js';
import { AgentMessage } from '../messages.js';

describe('BaseAgent', () => {
  let agent;
  let mockClient;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T00:00:00Z'));
    mockClient = {
      getSessionId: vi.fn().mockReturnValue('session-123'),
    };
    agent = new BaseAgent(AgentRole.PLANNER, mockClient);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('constructor', () => {
    it('should initialize with role and client', () => {
      expect(agent.role).toBe(AgentRole.PLANNER);
      expect(agent.client).toBe(mockClient);
    });

    it('should initialize with IDLE status', () => {
      expect(agent.status).toBe(AgentStatus.IDLE);
    });

    it('should set lastActivity to current time', () => {
      const before = Date.now();
      const newAgent = new BaseAgent(AgentRole.CODER, mockClient);
      const after = Date.now();

      expect(newAgent.lastActivity).toBeGreaterThanOrEqual(before);
      expect(newAgent.lastActivity).toBeLessThanOrEqual(after);
    });

    it('should initialize empty message handlers', () => {
      expect(agent.messageHandlers).toBeInstanceOf(Map);
      expect(agent.messageHandlers.size).toBe(0);
    });

    it('should initialize empty output history', () => {
      expect(agent.outputHistory).toEqual([]);
    });

    it('should accept config', () => {
      const config = { custom: 'value' };
      const agentWithConfig = new BaseAgent(AgentRole.TESTER, mockClient, config);

      expect(agentWithConfig.config).toEqual(config);
    });
  });

  describe('getId', () => {
    it('should return role and session ID', () => {
      expect(agent.getId()).toBe('planner_session-123');
    });

    it('should handle missing session ID', () => {
      mockClient.getSessionId.mockReturnValue(undefined);
      const noSessionAgent = new BaseAgent(AgentRole.CODER, mockClient);

      expect(noSessionAgent.getId()).toBe('coder_no_session');
    });

    it('should handle null client', () => {
      const noClientAgent = new BaseAgent(AgentRole.TESTER, null);

      expect(noClientAgent.getId()).toBe('tester_no_session');
    });
  });

  describe('onMessage', () => {
    it('should register message handler', () => {
      const handler = vi.fn();
      agent.onMessage(MessageType.PLAN_REQUEST, handler);

      expect(agent.messageHandlers.get(MessageType.PLAN_REQUEST)).toBe(handler);
    });

    it('should allow multiple handlers for different types', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      agent.onMessage(MessageType.PLAN_REQUEST, handler1);
      agent.onMessage(MessageType.REPLAN_REQUEST, handler2);

      expect(agent.messageHandlers.size).toBe(2);
    });

    it('should override handler for same type', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      agent.onMessage(MessageType.PLAN_REQUEST, handler1);
      agent.onMessage(MessageType.PLAN_REQUEST, handler2);

      expect(agent.messageHandlers.get(MessageType.PLAN_REQUEST)).toBe(handler2);
    });
  });

  describe('handleMessage', () => {
    it('should call registered handler', async () => {
      const handler = vi.fn().mockResolvedValue({ success: true });
      agent.onMessage(MessageType.PLAN_REQUEST, handler);

      const message = new AgentMessage(MessageType.PLAN_REQUEST, 'a', 'b');
      await agent.handleMessage(message);

      expect(handler).toHaveBeenCalledWith(message);
    });

    it('should return handler result', async () => {
      const result = { plan: 'steps' };
      const handler = vi.fn().mockResolvedValue(result);
      agent.onMessage(MessageType.PLAN_REQUEST, handler);

      const message = new AgentMessage(MessageType.PLAN_REQUEST, 'a', 'b');
      const response = await agent.handleMessage(message);

      expect(response).toEqual(result);
    });

    it('should throw for unhandled message type', async () => {
      const message = new AgentMessage(MessageType.CODE_REQUEST, 'a', 'b');

      await expect(agent.handleMessage(message))
        .rejects.toThrow('No handler for message type: code_request');
    });

    it('should set status to WORKING during processing', async () => {
      let statusDuringHandler;
      const handler = vi.fn().mockImplementation(() => {
        statusDuringHandler = agent.status;
        return Promise.resolve({});
      });
      agent.onMessage(MessageType.PLAN_REQUEST, handler);

      const message = new AgentMessage(MessageType.PLAN_REQUEST, 'a', 'b');
      await agent.handleMessage(message);

      expect(statusDuringHandler).toBe(AgentStatus.WORKING);
    });

    it('should reset status to IDLE after processing', async () => {
      const handler = vi.fn().mockResolvedValue({});
      agent.onMessage(MessageType.PLAN_REQUEST, handler);

      const message = new AgentMessage(MessageType.PLAN_REQUEST, 'a', 'b');
      await agent.handleMessage(message);

      expect(agent.status).toBe(AgentStatus.IDLE);
    });

    it('should reset status even on handler error', async () => {
      const handler = vi.fn().mockRejectedValue(new Error('Handler failed'));
      agent.onMessage(MessageType.PLAN_REQUEST, handler);

      const message = new AgentMessage(MessageType.PLAN_REQUEST, 'a', 'b');

      await expect(agent.handleMessage(message)).rejects.toThrow();
      expect(agent.status).toBe(AgentStatus.IDLE);
    });

    it('should record output', async () => {
      const handler = vi.fn().mockResolvedValue({ result: 'data' });
      agent.onMessage(MessageType.PLAN_REQUEST, handler);

      const message = new AgentMessage(MessageType.PLAN_REQUEST, 'a', 'b');
      await agent.handleMessage(message);

      expect(agent.outputHistory).toHaveLength(1);
      expect(agent.outputHistory[0].output).toEqual({ result: 'data' });
    });
  });

  describe('recordOutput', () => {
    it('should add to output history', () => {
      const input = new AgentMessage(MessageType.TEST_REQUEST, 'a', 'b');
      const output = { passed: true };

      agent.recordOutput(input, output);

      expect(agent.outputHistory).toHaveLength(1);
      expect(agent.outputHistory[0].input).toBe(input);
      expect(agent.outputHistory[0].output).toBe(output);
    });

    it('should mark as unverified', () => {
      agent.recordOutput({}, {});

      expect(agent.outputHistory[0].verified).toBe(false);
    });

    it('should trim history to max size', () => {
      agent.maxHistorySize = 5;

      for (let i = 0; i < 10; i++) {
        agent.recordOutput({}, { index: i });
      }

      expect(agent.outputHistory).toHaveLength(5);
      expect(agent.outputHistory[0].output.index).toBe(5);
    });
  });

  describe('getUnverifiedOutputs', () => {
    it('should return only unverified outputs', () => {
      agent.recordOutput({}, { id: 1 });
      agent.recordOutput({}, { id: 2 });
      agent.outputHistory[0].verified = true;

      const unverified = agent.getUnverifiedOutputs();

      expect(unverified).toHaveLength(1);
      expect(unverified[0].output.id).toBe(2);
    });

    it('should return empty array when all verified', () => {
      agent.recordOutput({}, {});
      agent.outputHistory[0].verified = true;

      expect(agent.getUnverifiedOutputs()).toHaveLength(0);
    });
  });

  describe('markVerified', () => {
    it('should mark outputs as verified by timestamp', () => {
      agent.recordOutput({}, {});
      const timestamp = agent.outputHistory[0].timestamp;

      agent.markVerified([timestamp]);

      expect(agent.outputHistory[0].verified).toBe(true);
    });

    it('should only mark matching timestamps', () => {
      agent.recordOutput({}, { id: 1 });
      vi.advanceTimersByTime(1); // Ensure different timestamp
      agent.recordOutput({}, { id: 2 });
      const firstTimestamp = agent.outputHistory[0].timestamp;

      agent.markVerified([firstTimestamp]);

      expect(agent.outputHistory[0].verified).toBe(true);
      expect(agent.outputHistory[1].verified).toBe(false);
    });
  });

  describe('execute', () => {
    it('should throw not implemented error', async () => {
      await expect(agent.execute({}))
        .rejects.toThrow('execute() must be implemented by subclass');
    });
  });

  describe('getStats', () => {
    it('should return agent statistics', () => {
      agent.recordOutput({}, {});
      agent.recordOutput({}, {});
      agent.outputHistory[0].verified = true;

      const stats = agent.getStats();

      expect(stats.role).toBe(AgentRole.PLANNER);
      expect(stats.status).toBe(AgentStatus.IDLE);
      expect(stats.outputCount).toBe(2);
      expect(stats.unverifiedCount).toBe(1);
    });
  });
});
