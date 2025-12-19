/**
 * Tests for step-verifier.js
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StepVerifier } from '../step-verifier.js';

describe('StepVerifier', () => {
  let mockClient;
  let verifier;

  beforeEach(() => {
    mockClient = {
      sendPrompt: vi.fn(),
    };
    verifier = new StepVerifier(mockClient);
  });

  describe('constructor', () => {
    it('should use default options', () => {
      const v = new StepVerifier(mockClient);
      expect(v.useStructuredOutput).toBe(true);
      expect(v.readOnlyTools).toBe(true);
      expect(v.maxResponseLength).toBe(5000);
      expect(v.skipForSimpleSteps).toBe(false);
    });

    it('should respect provided options', () => {
      const v = new StepVerifier(mockClient, {
        useStructuredOutput: false,
        readOnlyTools: false,
        maxResponseLength: 3000,
        skipForSimpleSteps: true,
      });
      expect(v.useStructuredOutput).toBe(false);
      expect(v.readOnlyTools).toBe(false);
      expect(v.maxResponseLength).toBe(3000);
      expect(v.skipForSimpleSteps).toBe(true);
    });
  });

  describe('buildStepVerificationPrompt', () => {
    const step = { number: 1, description: 'Write unit tests', complexity: 'medium' };
    const response = 'I wrote the tests successfully';

    it('should build concise prompt when structured output enabled', () => {
      const prompt = verifier.buildStepVerificationPrompt(step, response);

      expect(prompt).toContain('Verify step completion');
      expect(prompt).toContain(step.description);
      expect(prompt).toContain('[medium]');
      expect(prompt).toContain(response);
    });

    it('should build full prompt when structured output disabled', () => {
      verifier.useStructuredOutput = false;
      const prompt = verifier.buildStepVerificationPrompt(step, response);

      expect(prompt).toContain('You are verifying whether a step was actually completed');
      expect(prompt).toContain('STEP TO VERIFY');
      expect(prompt).toContain('Step 1: Write unit tests');
      expect(prompt).toContain('Complexity: medium');
      expect(prompt).toContain('VERIFIED: [YES/NO]');
    });

    it('should truncate long responses', () => {
      verifier.maxResponseLength = 50;
      const longResponse = 'a'.repeat(100);
      const prompt = verifier.buildStepVerificationPrompt(step, longResponse);

      expect(prompt).toContain('a'.repeat(50));
      expect(prompt).not.toContain('a'.repeat(100));
    });
  });

  describe('verifyStepCompletion', () => {
    const step = { number: 1, description: 'Test step', complexity: 'medium' };
    const responseContent = 'I completed the step';

    it('should skip verification for simple steps when configured', async () => {
      verifier.skipForSimpleSteps = true;
      const simpleStep = { ...step, complexity: 'simple' };

      const result = await verifier.verifyStepCompletion(simpleStep, responseContent);

      expect(result.verified).toBe(true);
      expect(result.skipped).toBe(true);
      expect(mockClient.sendPrompt).not.toHaveBeenCalled();
    });

    it('should not skip non-simple steps', async () => {
      verifier.skipForSimpleSteps = true;
      mockClient.sendPrompt.mockResolvedValue({
        structuredOutput: { verified: true, reason: 'Done' },
      });

      await verifier.verifyStepCompletion(step, responseContent);

      expect(mockClient.sendPrompt).toHaveBeenCalled();
    });

    it('should return structured output when available', async () => {
      mockClient.sendPrompt.mockResolvedValue({
        structuredOutput: {
          verified: true,
          reason: 'Step completed with file changes',
        },
      });

      const result = await verifier.verifyStepCompletion(step, responseContent);

      expect(result.verified).toBe(true);
      expect(result.reason).toBe('Step completed with file changes');
    });

    it('should fall back to text parsing', async () => {
      mockClient.sendPrompt.mockResolvedValue({
        response: `VERIFIED: YES
REASON: Tests were written and pass`,
      });

      const result = await verifier.verifyStepCompletion(step, responseContent);

      expect(result.verified).toBe(true);
      expect(result.reason).toBe('Tests were written and pass');
    });

    it('should trust claim on error to avoid blocking', async () => {
      mockClient.sendPrompt.mockRejectedValue(new Error('Timeout'));

      const result = await verifier.verifyStepCompletion(step, responseContent);

      expect(result.verified).toBe(true);
      expect(result.reason).toBe('Verification unavailable - trusting claim');
    });

    it('should pass correct options to client', async () => {
      mockClient.sendPrompt.mockResolvedValue({
        structuredOutput: { verified: true, reason: 'OK' },
      });

      await verifier.verifyStepCompletion(step, responseContent);

      expect(mockClient.sendPrompt).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          newSession: true,
          timeout: 90 * 1000,
          model: 'sonnet',
          noSessionPersistence: true,
          disallowedTools: ['Edit', 'Write', 'Bash', 'NotebookEdit'],
        })
      );
    });

    it('should handle null reason in structured output', async () => {
      mockClient.sendPrompt.mockResolvedValue({
        structuredOutput: { verified: true, reason: null },
      });

      const result = await verifier.verifyStepCompletion(step, responseContent);

      expect(result.reason).toBe('No reason provided');
    });
  });

  describe('buildGoalVerificationPrompt', () => {
    const goal = 'Build a new feature';
    const steps = [
      { number: 1, description: 'Step 1', status: 'completed' },
      { number: 2, description: 'Step 2', status: 'blocked' },
    ];
    const workingDir = '/project';

    it('should build concise prompt when structured output enabled', () => {
      const prompt = verifier.buildGoalVerificationPrompt(goal, steps, workingDir);

      expect(prompt).toContain('FINAL VERIFICATION');
      expect(prompt).toContain(goal);
      expect(prompt).toContain('✓ 1. Step 1');
      expect(prompt).toContain('✗ 2. Step 2');
      expect(prompt).toContain(workingDir);
    });

    it('should build full prompt when structured output disabled', () => {
      verifier.useStructuredOutput = false;
      const prompt = verifier.buildGoalVerificationPrompt(goal, steps, workingDir);

      expect(prompt).toContain('You are performing FINAL VERIFICATION');
      expect(prompt).toContain('ORIGINAL GOAL');
      expect(prompt).toContain('COMPLETED STEPS');
      expect(prompt).toContain('WORKING DIRECTORY');
      expect(prompt).toContain('GOAL_ACHIEVED: [YES/NO]');
    });
  });

  describe('verifyGoalAchieved', () => {
    const goal = 'Complete the task';
    const steps = [{ number: 1, description: 'Step', status: 'completed' }];
    const workingDir = '/project';

    it('should return structured output when available', async () => {
      mockClient.sendPrompt.mockResolvedValue({
        structuredOutput: {
          achieved: true,
          confidence: 'HIGH',
          functional: 'YES',
          recommendation: 'ACCEPT',
          gaps: 'none',
          reason: 'All done',
        },
      });

      const result = await verifier.verifyGoalAchieved(goal, steps, workingDir);

      expect(result.achieved).toBe(true);
      expect(result.confidence).toBe('HIGH');
      expect(result.functional).toBe('YES');
      expect(result.recommendation).toBe('ACCEPT');
      expect(result.gaps).toBeNull();
      expect(result.reason).toBe('All done');
    });

    it('should handle gaps that are not "none"', async () => {
      mockClient.sendPrompt.mockResolvedValue({
        structuredOutput: {
          achieved: false,
          confidence: 'LOW',
          recommendation: 'REJECT',
          gaps: 'Missing error handling',
          reason: 'Incomplete',
        },
      });

      const result = await verifier.verifyGoalAchieved(goal, steps, workingDir);

      expect(result.gaps).toBe('Missing error handling');
    });

    it('should fall back to text parsing', async () => {
      mockClient.sendPrompt.mockResolvedValue({
        response: `GOAL_ACHIEVED: YES
CONFIDENCE: MEDIUM
FUNCTIONAL: UNKNOWN
RECOMMENDATION: NEEDS_TESTING
GAPS: none
REASON: Looks good but needs testing`,
      });

      const result = await verifier.verifyGoalAchieved(goal, steps, workingDir);

      expect(result.achieved).toBe(true);
      expect(result.confidence).toBe('MEDIUM');
      expect(result.recommendation).toBe('NEEDS_TESTING');
    });

    it('should handle timeout errors specially', async () => {
      mockClient.sendPrompt.mockRejectedValue(new Error('Request timed out'));

      const result = await verifier.verifyGoalAchieved(goal, steps, workingDir);

      expect(result.achieved).toBeNull(); // Inconclusive, not false
      expect(result.verificationError).toBe(true);
      expect(result.verificationTimeout).toBe(true);
    });

    it('should handle non-timeout errors', async () => {
      mockClient.sendPrompt.mockRejectedValue(new Error('Network error'));

      const result = await verifier.verifyGoalAchieved(goal, steps, workingDir);

      expect(result.achieved).toBe(false);
      expect(result.verificationError).toBe(true);
      expect(result.verificationTimeout).toBe(false);
    });

    it('should pass correct options to client', async () => {
      mockClient.sendPrompt.mockResolvedValue({
        structuredOutput: {
          achieved: true,
          confidence: 'HIGH',
          recommendation: 'ACCEPT',
          reason: 'Done',
        },
      });

      await verifier.verifyGoalAchieved(goal, steps, workingDir);

      expect(mockClient.sendPrompt).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          newSession: true,
          timeout: 2 * 60 * 1000,
          model: 'sonnet',
          noSessionPersistence: true,
        })
      );
    });
  });

  describe('formatGoalVerificationSummary', () => {
    it('should format achieved goal', () => {
      const result = {
        achieved: true,
        confidence: 'HIGH',
        functional: 'YES',
        recommendation: 'ACCEPT',
        gaps: null,
        reason: 'All done',
      };

      const summary = verifier.formatGoalVerificationSummary(result);

      expect(summary).toContain('✓ ACHIEVED');
      expect(summary).toContain('Confidence: HIGH');
      expect(summary).toContain('Functional: YES');
      expect(summary).toContain('Recommendation: ACCEPT');
      expect(summary).toContain('Reason: All done');
      expect(summary).not.toContain('Gaps:');
    });

    it('should format not achieved goal', () => {
      const result = {
        achieved: false,
        confidence: 'LOW',
        functional: 'NO',
        recommendation: 'REJECT',
        gaps: 'Missing tests',
        reason: 'Incomplete',
      };

      const summary = verifier.formatGoalVerificationSummary(result);

      expect(summary).toContain('✗ NOT ACHIEVED');
      expect(summary).toContain('Gaps: Missing tests');
    });

    it('should format inconclusive result', () => {
      const result = {
        achieved: null,
        confidence: 'LOW',
        functional: 'UNKNOWN',
        recommendation: 'NEEDS_TESTING',
        reason: 'Verification failed',
        error: 'Timeout',
      };

      const summary = verifier.formatGoalVerificationSummary(result);

      expect(summary).toContain('? INCONCLUSIVE');
      expect(summary).toContain('⚠️ Verification error: Timeout');
    });
  });
});
