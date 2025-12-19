/**
 * Tests for plan-reviewer.js
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PlanReviewer } from '../plan-reviewer.js';

describe('PlanReviewer', () => {
  let mockClient;
  let reviewer;

  beforeEach(() => {
    mockClient = {
      sendPrompt: vi.fn(),
    };
    reviewer = new PlanReviewer(mockClient);
  });

  describe('constructor', () => {
    it('should use structured output by default', () => {
      const r = new PlanReviewer(mockClient);
      expect(r.useStructuredOutput).toBe(true);
    });

    it('should use read-only tools by default', () => {
      const r = new PlanReviewer(mockClient);
      expect(r.readOnlyTools).toBe(true);
    });

    it('should respect useStructuredOutput option', () => {
      const r = new PlanReviewer(mockClient, { useStructuredOutput: false });
      expect(r.useStructuredOutput).toBe(false);
    });

    it('should respect readOnlyTools option', () => {
      const r = new PlanReviewer(mockClient, { readOnlyTools: false });
      expect(r.readOnlyTools).toBe(false);
    });
  });

  describe('buildReviewPrompt', () => {
    const plan = {
      analysis: 'Test analysis',
      steps: [
        { number: 1, description: 'First step', complexity: 'simple' },
        { number: 2, description: 'Second step', complexity: 'complex' },
      ],
    };
    const goal = 'Build a feature';

    it('should build concise prompt when structured output enabled', () => {
      const prompt = reviewer.buildReviewPrompt(plan, goal);

      expect(prompt).toContain('Review this execution plan');
      expect(prompt).toContain(goal);
      expect(prompt).toContain('1. First step [simple]');
      expect(prompt).toContain('2. Second step [complex]');
      expect(prompt).toContain('Addresses goal?');
    });

    it('should build full prompt when structured output disabled', () => {
      reviewer.useStructuredOutput = false;
      const prompt = reviewer.buildReviewPrompt(plan, goal);

      expect(prompt).toContain('You are reviewing an execution plan');
      expect(prompt).toContain('ORIGINAL GOAL');
      expect(prompt).toContain(goal);
      expect(prompt).toContain('PROPOSED PLAN');
      expect(prompt).toContain('Test analysis');
      expect(prompt).toContain('Respond in EXACTLY this format');
    });
  });

  describe('reviewPlan', () => {
    const plan = {
      steps: [
        { number: 1, description: 'Step 1', complexity: 'simple' },
      ],
    };
    const goal = 'Test goal';

    it('should return structured output when available', async () => {
      mockClient.sendPrompt.mockResolvedValue({
        structuredOutput: {
          approved: true,
          issues: ['Minor issue'],
          missingSteps: [],
          suggestions: ['Consider tests'],
        },
      });

      const result = await reviewer.reviewPlan(plan, goal);

      expect(result.approved).toBe(true);
      expect(result.issues).toEqual(['Minor issue']);
      expect(result.missingSteps).toEqual([]);
      expect(result.suggestions).toEqual(['Consider tests']);
    });

    it('should fall back to text parsing when no structured output', async () => {
      mockClient.sendPrompt.mockResolvedValue({
        response: `APPROVED: YES
ISSUES: none
MISSING_STEPS: none
SUGGESTIONS: Add caching`,
      });

      const result = await reviewer.reviewPlan(plan, goal);

      expect(result.approved).toBe(true);
      expect(result.issues).toEqual([]);
      expect(result.suggestions).toEqual(['Add caching']);
    });

    it('should approve on error to avoid blocking', async () => {
      mockClient.sendPrompt.mockRejectedValue(new Error('Network error'));

      const result = await reviewer.reviewPlan(plan, goal);

      expect(result.approved).toBe(true);
      expect(result.error).toBe('Network error');
    });

    it('should pass correct options to client', async () => {
      mockClient.sendPrompt.mockResolvedValue({
        structuredOutput: { approved: true, issues: [], missingSteps: [], suggestions: [] },
      });

      await reviewer.reviewPlan(plan, goal);

      expect(mockClient.sendPrompt).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          newSession: true,
          timeout: 2 * 60 * 1000,
          model: 'sonnet',
          noSessionPersistence: true,
          disallowedTools: ['Edit', 'Write', 'Bash', 'NotebookEdit'],
        })
      );
    });

    it('should not restrict tools when readOnlyTools disabled', async () => {
      reviewer.readOnlyTools = false;
      mockClient.sendPrompt.mockResolvedValue({
        structuredOutput: { approved: true, issues: [], missingSteps: [], suggestions: [] },
      });

      await reviewer.reviewPlan(plan, goal);

      const callOptions = mockClient.sendPrompt.mock.calls[0][1];
      expect(callOptions.disallowedTools).toBeUndefined();
    });

    it('should handle null arrays in structured output', async () => {
      mockClient.sendPrompt.mockResolvedValue({
        structuredOutput: {
          approved: true,
          issues: null,
          missingSteps: null,
          suggestions: null,
        },
      });

      const result = await reviewer.reviewPlan(plan, goal);

      expect(result.issues).toEqual([]);
      expect(result.missingSteps).toEqual([]);
      expect(result.suggestions).toEqual([]);
    });
  });

  describe('formatReviewSummary', () => {
    it('should format approved review', () => {
      const review = {
        approved: true,
        issues: [],
        missingSteps: [],
        suggestions: [],
      };

      const summary = reviewer.formatReviewSummary(review);

      expect(summary).toContain('✓ APPROVED');
    });

    it('should format rejected review', () => {
      const review = {
        approved: false,
        issues: ['Missing tests'],
        missingSteps: ['Add unit tests'],
        suggestions: ['Consider integration tests'],
      };

      const summary = reviewer.formatReviewSummary(review);

      expect(summary).toContain('✗ NOT APPROVED');
      expect(summary).toContain('Issues:');
      expect(summary).toContain('- Missing tests');
      expect(summary).toContain('Missing Steps:');
      expect(summary).toContain('- Add unit tests');
      expect(summary).toContain('Suggestions:');
      expect(summary).toContain('- Consider integration tests');
    });

    it('should include error message when present', () => {
      const review = {
        approved: true,
        issues: [],
        missingSteps: [],
        suggestions: [],
        error: 'Timeout occurred',
      };

      const summary = reviewer.formatReviewSummary(review);

      expect(summary).toContain('⚠️ Review had error: Timeout occurred');
    });

    it('should not include empty sections', () => {
      const review = {
        approved: true,
        issues: [],
        missingSteps: [],
        suggestions: ['Just one suggestion'],
      };

      const summary = reviewer.formatReviewSummary(review);

      expect(summary).not.toContain('Issues:');
      expect(summary).not.toContain('Missing Steps:');
      expect(summary).toContain('Suggestions:');
    });
  });
});
