/**
 * Tests for Messages Module
 */

import { describe, it, expect } from 'vitest';
import { AgentMessage } from '../messages.js';
import { MessageType, AgentRole } from '../enums.js';

describe('AgentMessage', () => {
  describe('constructor', () => {
    it('should create message with required fields', () => {
      const msg = new AgentMessage(
        MessageType.PLAN_REQUEST,
        AgentRole.ORCHESTRATOR,
        AgentRole.PLANNER
      );

      expect(msg.type).toBe(MessageType.PLAN_REQUEST);
      expect(msg.from).toBe(AgentRole.ORCHESTRATOR);
      expect(msg.to).toBe(AgentRole.PLANNER);
    });

    it('should generate unique ID', () => {
      const msg1 = new AgentMessage(MessageType.PLAN_REQUEST, 'a', 'b');
      const msg2 = new AgentMessage(MessageType.PLAN_REQUEST, 'a', 'b');

      expect(msg1.id).toBeDefined();
      expect(msg2.id).toBeDefined();
      expect(msg1.id).not.toBe(msg2.id);
    });

    it('should include timestamp', () => {
      const before = Date.now();
      const msg = new AgentMessage(MessageType.PLAN_REQUEST, 'a', 'b');
      const after = Date.now();

      expect(msg.timestamp).toBeGreaterThanOrEqual(before);
      expect(msg.timestamp).toBeLessThanOrEqual(after);
    });

    it('should default to empty payload', () => {
      const msg = new AgentMessage(MessageType.PLAN_REQUEST, 'a', 'b');

      expect(msg.payload).toEqual({});
    });

    it('should accept custom payload', () => {
      const payload = { goal: 'Build feature', context: { key: 'value' } };
      const msg = new AgentMessage(MessageType.PLAN_REQUEST, 'a', 'b', payload);

      expect(msg.payload).toEqual(payload);
    });

    it('should initialize correlationId as null', () => {
      const msg = new AgentMessage(MessageType.PLAN_REQUEST, 'a', 'b');

      expect(msg.correlationId).toBeNull();
    });
  });

  describe('createResponse', () => {
    it('should create response with swapped from/to', () => {
      const original = new AgentMessage(
        MessageType.PLAN_REQUEST,
        AgentRole.ORCHESTRATOR,
        AgentRole.PLANNER
      );

      const response = original.createResponse(
        MessageType.PLAN_RESPONSE,
        { success: true }
      );

      expect(response.from).toBe(AgentRole.PLANNER);
      expect(response.to).toBe(AgentRole.ORCHESTRATOR);
    });

    it('should set correlationId to original message ID', () => {
      const original = new AgentMessage(
        MessageType.PLAN_REQUEST,
        'sender',
        'receiver'
      );

      const response = original.createResponse(
        MessageType.PLAN_RESPONSE,
        {}
      );

      expect(response.correlationId).toBe(original.id);
    });

    it('should have correct response type', () => {
      const original = new AgentMessage(
        MessageType.VERIFY_REQUEST,
        'sender',
        'receiver'
      );

      const response = original.createResponse(
        MessageType.VERIFY_RESPONSE,
        {}
      );

      expect(response.type).toBe(MessageType.VERIFY_RESPONSE);
    });

    it('should include response payload', () => {
      const original = new AgentMessage(MessageType.CODE_REQUEST, 'a', 'b');

      const payload = { files: ['file1.js'], success: true };
      const response = original.createResponse(MessageType.CODE_RESPONSE, payload);

      expect(response.payload).toEqual(payload);
    });

    it('should generate unique ID for response', () => {
      const original = new AgentMessage(MessageType.TEST_REQUEST, 'a', 'b');

      const response = original.createResponse(MessageType.TEST_RESPONSE, {});

      expect(response.id).toBeDefined();
      expect(response.id).not.toBe(original.id);
    });
  });
});
