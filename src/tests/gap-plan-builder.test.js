import { describe, it, expect } from 'vitest';
import {
  buildVerificationDetails,
  buildGapContext,
  extractGaps,
  buildSubPlanPrompt,
} from '../gap-plan-builder.js';

describe('gap-plan-builder', () => {
  describe('buildVerificationDetails', () => {
    it('should return empty string when cycleVerification is null', () => {
      expect(buildVerificationDetails(null)).toBe('');
    });

    it('should return empty string when cycleVerification is undefined', () => {
      expect(buildVerificationDetails(undefined)).toBe('');
    });

    it('should include all verification fields when present', () => {
      const cycleVerification = {
        goalVerification: {
          achieved: true,
          confidence: 0.95,
          functional: true,
          gaps: 'missing tests',
          recommendation: 'add unit tests',
        },
      };

      const result = buildVerificationDetails(cycleVerification);

      expect(result).toContain('Goal achieved: true');
      expect(result).toContain('Confidence: 0.95');
      expect(result).toContain('Functional: true');
      expect(result).toContain('Verification gaps: missing tests');
      expect(result).toContain('Recommendation: add unit tests');
    });

    it('should show unknown for missing fields', () => {
      const cycleVerification = { goalVerification: {} };

      const result = buildVerificationDetails(cycleVerification);

      expect(result).toContain('Goal achieved: unknown');
      expect(result).toContain('Confidence: unknown');
      expect(result).toContain('Functional: unknown');
      expect(result).toContain('Verification gaps: none specified');
      expect(result).toContain('Recommendation: none');
    });

    it('should handle missing goalVerification', () => {
      const cycleVerification = {};

      const result = buildVerificationDetails(cycleVerification);

      expect(result).toContain('unknown');
    });
  });

  describe('buildGapContext', () => {
    it('should build context with all parameters', () => {
      const result = buildGapContext(
        2,
        { completed: 5, total: 10 },
        [{ description: 'Setup database' }],
        'Database connection failed',
        '\n- Goal achieved: false'
      );

      expect(result).toContain('PREVIOUS ATTEMPT (Cycle 2)');
      expect(result).toContain('Completed: 5/10 steps');
      expect(result).toContain('Failed steps: Setup database');
      expect(result).toContain('CRITICAL GAPS TO ADDRESS');
      expect(result).toContain('Database connection failed');
      expect(result).toContain('Goal achieved: false');
    });

    it('should show none for empty failed steps', () => {
      const result = buildGapContext(1, { completed: 3, total: 3 }, [], 'unknown error', '');

      expect(result).toContain('Failed steps: none');
    });

    it('should join multiple failed step descriptions', () => {
      const failedSteps = [
        { description: 'Step A' },
        { description: 'Step B' },
        { description: 'Step C' },
      ];

      const result = buildGapContext(1, { completed: 2, total: 5 }, failedSteps, 'gaps', '');

      expect(result).toContain('Failed steps: Step A, Step B, Step C');
    });

    it('should include task instructions', () => {
      const result = buildGapContext(1, { completed: 1, total: 2 }, [], 'test gap', '');

      expect(result).toContain('YOUR TASK: The goal was NOT achieved');
      expect(result).toContain("Focus on what's missing or broken");
    });
  });

  describe('extractGaps', () => {
    it('should return verification gaps when present', () => {
      const cycleVerification = {
        goalVerification: {
          gaps: 'Unit tests missing for auth module',
        },
      };

      const result = extractGaps(cycleVerification, []);

      expect(result).toBe('Unit tests missing for auth module');
    });

    it('should return failed step descriptions when no verification gaps', () => {
      const failedSteps = [
        { description: 'Implement login' },
        { description: 'Add validation' },
      ];

      const result = extractGaps({}, failedSteps);

      expect(result).toBe('Implement login, Add validation');
    });

    it('should return default message when no gaps or failed steps', () => {
      const result = extractGaps({}, []);

      expect(result).toBe('verification failed');
    });

    it('should return default message when cycleVerification is null', () => {
      const result = extractGaps(null, []);

      expect(result).toBe('verification failed');
    });

    it('should prioritize verification gaps over failed steps', () => {
      const cycleVerification = {
        goalVerification: {
          gaps: 'API endpoint broken',
        },
      };
      const failedSteps = [{ description: 'Ignored step' }];

      const result = extractGaps(cycleVerification, failedSteps);

      expect(result).toBe('API endpoint broken');
    });

    it('should handle empty goalVerification object', () => {
      const cycleVerification = { goalVerification: {} };
      const failedSteps = [{ description: 'Failed test' }];

      const result = extractGaps(cycleVerification, failedSteps);

      expect(result).toBe('Failed test');
    });
  });

  describe('buildSubPlanPrompt', () => {
    it('should build prompt with all sub-plan steps', () => {
      const pendingSubPlan = {
        step: { number: 3 },
        reason: 'File not found',
      };
      const subPlan = {
        totalSteps: 3,
        steps: [
          { number: 1, description: 'Create directory' },
          { number: 2, description: 'Initialize file' },
          { number: 3, description: 'Write content' },
        ],
      };

      const result = buildSubPlanPrompt(pendingSubPlan, subPlan);

      expect(result).toContain('## Alternative Approach Required');
      expect(result).toContain('File not found');
      expect(result).toContain('3 sub-steps');
      expect(result).toContain('1. Create directory');
      expect(result).toContain('2. Initialize file');
      expect(result).toContain('3. Write content');
      expect(result).toContain("Let's start with sub-step 1: Create directory");
    });

    it('should handle single step sub-plan', () => {
      const pendingSubPlan = {
        step: { number: 1 },
        reason: 'Timeout',
      };
      const subPlan = {
        totalSteps: 1,
        steps: [{ number: 1, description: 'Retry operation' }],
      };

      const result = buildSubPlanPrompt(pendingSubPlan, subPlan);

      expect(result).toContain('1 sub-steps');
      expect(result).toContain('Retry operation');
    });

    it('should include blocking reason in prompt', () => {
      const pendingSubPlan = {
        step: { number: 5 },
        reason: 'Network connection failed due to firewall',
      };
      const subPlan = {
        totalSteps: 2,
        steps: [
          { number: 1, description: 'Check network' },
          { number: 2, description: 'Retry' },
        ],
      };

      const result = buildSubPlanPrompt(pendingSubPlan, subPlan);

      expect(result).toContain('Network connection failed due to firewall');
    });

    it('should handle empty steps array gracefully', () => {
      const pendingSubPlan = {
        step: { number: 1 },
        reason: 'Error',
      };
      const subPlan = {
        totalSteps: 0,
        steps: [],
      };

      const result = buildSubPlanPrompt(pendingSubPlan, subPlan);

      expect(result).toContain('0 sub-steps');
      expect(result).toContain('sub-step 1: undefined');
    });

    it('should format step list correctly', () => {
      const pendingSubPlan = {
        step: { number: 2 },
        reason: 'Blocked',
      };
      const subPlan = {
        totalSteps: 2,
        steps: [
          { number: 1, description: 'First step' },
          { number: 2, description: 'Second step' },
        ],
      };

      const result = buildSubPlanPrompt(pendingSubPlan, subPlan);

      const lines = result.split('\n');
      expect(lines.some(l => l === '1. First step')).toBe(true);
      expect(lines.some(l => l === '2. Second step')).toBe(true);
    });
  });
});
