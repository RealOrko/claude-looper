/**
 * Tests for Prompt Builder Module
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  buildPlanningPrompt,
  buildSubPlanPrompt,
  buildAdaptiveSubPlanPrompt,
  formatPlanForDisplay,
  getDepthLabel,
} from '../prompt-builder.js';

describe('buildPlanningPrompt', () => {
  it('should include the goal in the prompt', () => {
    const prompt = buildPlanningPrompt('Build a REST API');

    expect(prompt).toContain('Build a REST API');
    expect(prompt).toContain('## GOAL');
  });

  it('should include additional context when provided', () => {
    const prompt = buildPlanningPrompt('Build feature', {
      additionalContext: 'Use TypeScript and Jest',
    });

    expect(prompt).toContain('## ADDITIONAL CONTEXT');
    expect(prompt).toContain('Use TypeScript and Jest');
  });

  it('should not include context section when not provided', () => {
    const prompt = buildPlanningPrompt('Build feature');

    expect(prompt).not.toContain('## ADDITIONAL CONTEXT');
  });

  it('should include working directory', () => {
    const prompt = buildPlanningPrompt('Build feature', {
      workingDirectory: '/project/src',
    });

    expect(prompt).toContain('/project/src');
  });

  it('should include planning guidelines', () => {
    const prompt = buildPlanningPrompt('Build feature');

    expect(prompt).toContain('Analyze First');
    expect(prompt).toContain('Create Actionable Steps');
    expect(prompt).toContain('Estimate Complexity');
  });

  it('should include complexity definitions', () => {
    const prompt = buildPlanningPrompt('Build feature');

    expect(prompt).toContain('simple');
    expect(prompt).toContain('medium');
    expect(prompt).toContain('complex');
  });

  it('should include output format instructions', () => {
    const prompt = buildPlanningPrompt('Build feature');

    expect(prompt).toContain('ANALYSIS:');
    expect(prompt).toContain('PLAN:');
    expect(prompt).toContain('DEPENDENCIES:');
    expect(prompt).toContain('RISKS:');
    expect(prompt).toContain('TOTAL_STEPS:');
  });

  it('should include step count constraints', () => {
    const prompt = buildPlanningPrompt('Build feature');

    expect(prompt).toContain('2-15 steps');
  });
});

describe('buildSubPlanPrompt', () => {
  const blockedStep = {
    description: 'Implement authentication',
    complexity: 'complex',
  };

  it('should include blocked step information', () => {
    const prompt = buildSubPlanPrompt(blockedStep, 'OAuth provider unavailable', 1);

    expect(prompt).toContain('Implement authentication');
    expect(prompt).toContain('complex');
  });

  it('should include block reason', () => {
    const prompt = buildSubPlanPrompt(blockedStep, 'OAuth provider unavailable', 1);

    expect(prompt).toContain('OAuth provider unavailable');
    expect(prompt).toContain('## BLOCK REASON');
  });

  it('should show correct depth label for level 1', () => {
    const prompt = buildSubPlanPrompt(blockedStep, 'Reason', 1);

    expect(prompt).toContain('SUB-PLAN');
    expect(prompt).toContain('Level 1 of max 3');
  });

  it('should show correct depth label for level 2', () => {
    const prompt = buildSubPlanPrompt(blockedStep, 'Reason', 2);

    expect(prompt).toContain('SUB-SUB-PLAN');
    expect(prompt).toContain('Level 2 of max 3');
  });

  it('should show correct depth label for level 3', () => {
    const prompt = buildSubPlanPrompt(blockedStep, 'Reason', 3);

    expect(prompt).toContain('LEVEL-3 RECOVERY PLAN');
  });

  it('should include depth warning for deep levels', () => {
    const prompt = buildSubPlanPrompt(blockedStep, 'Reason', 2);

    expect(prompt).toContain('⚠️ WARNING');
    expect(prompt).toContain('minimal and focused');
  });

  it('should not include depth warning for level 1', () => {
    const prompt = buildSubPlanPrompt(blockedStep, 'Reason', 1);

    expect(prompt).not.toContain('⚠️ WARNING');
  });

  it('should include alternative approach guidance', () => {
    const prompt = buildSubPlanPrompt(blockedStep, 'Reason', 1);

    expect(prompt).toContain('Work around the blocker');
    expect(prompt).toContain('alternative methods');
  });

  it('should include output format', () => {
    const prompt = buildSubPlanPrompt(blockedStep, 'Reason', 1);

    expect(prompt).toContain('ANALYSIS:');
    expect(prompt).toContain('ALTERNATIVE_APPROACH:');
    expect(prompt).toContain('PLAN:');
    expect(prompt).toContain('TOTAL_STEPS:');
  });
});

describe('buildAdaptiveSubPlanPrompt', () => {
  const blockedStep = {
    description: 'Connect to database',
    complexity: 'medium',
  };

  it('should include blocked step info', () => {
    const prompt = buildAdaptiveSubPlanPrompt(blockedStep, 'Connection timeout', 1, []);

    expect(prompt).toContain('Connect to database');
    expect(prompt).toContain('medium');
  });

  it('should include previous attempts section when provided', () => {
    const previousAttempts = [
      { approach: 'Direct connection', failureReason: 'Firewall blocked' },
      { approach: 'SSH tunnel', failureReason: 'Key authentication failed' },
    ];

    const prompt = buildAdaptiveSubPlanPrompt(blockedStep, 'Reason', 1, previousAttempts);

    expect(prompt).toContain('PREVIOUS ATTEMPTS');
    expect(prompt).toContain('DO NOT REPEAT THESE');
    expect(prompt).toContain('Direct connection');
    expect(prompt).toContain('Firewall blocked');
    expect(prompt).toContain('SSH tunnel');
    expect(prompt).toContain('Key authentication failed');
  });

  it('should not include previous attempts section when empty', () => {
    const prompt = buildAdaptiveSubPlanPrompt(blockedStep, 'Reason', 1, []);

    expect(prompt).not.toContain('PREVIOUS ATTEMPTS');
  });

  it('should include successful patterns when provided', () => {
    const executionContext = {
      successfulApproaches: [
        { description: 'Used environment variables for config' },
        { description: 'Implemented retry logic' },
      ],
    };

    const prompt = buildAdaptiveSubPlanPrompt(blockedStep, 'Reason', 1, [], executionContext);

    expect(prompt).toContain('SUCCESSFUL PATTERNS');
    expect(prompt).toContain('Used environment variables');
    expect(prompt).toContain('Implemented retry logic');
  });

  it('should limit successful patterns to last 3', () => {
    const executionContext = {
      successfulApproaches: [
        { description: 'Pattern 1' },
        { description: 'Pattern 2' },
        { description: 'Pattern 3' },
        { description: 'Pattern 4' },
        { description: 'Pattern 5' },
      ],
    };

    const prompt = buildAdaptiveSubPlanPrompt(blockedStep, 'Reason', 1, [], executionContext);

    expect(prompt).toContain('Pattern 3');
    expect(prompt).toContain('Pattern 4');
    expect(prompt).toContain('Pattern 5');
    expect(prompt).not.toContain('Pattern 1');
    expect(prompt).not.toContain('Pattern 2');
  });

  it('should encourage creative thinking', () => {
    const prompt = buildAdaptiveSubPlanPrompt(blockedStep, 'Reason', 1, []);

    expect(prompt).toContain('DIFFERENT approach');
    expect(prompt).toContain('completely different method');
    expect(prompt).toContain('simpler version');
  });

  it('should adjust max steps based on depth', () => {
    const promptLevel1 = buildAdaptiveSubPlanPrompt(blockedStep, 'Reason', 1, []);
    const promptLevel2 = buildAdaptiveSubPlanPrompt(blockedStep, 'Reason', 2, []);

    expect(promptLevel1).toContain('2-4 steps');
    expect(promptLevel2).toContain('2-3 steps');
  });
});

describe('getDepthLabel', () => {
  it('should return SUB-PLAN for depth 1', () => {
    expect(getDepthLabel(1)).toBe('SUB-PLAN');
  });

  it('should return SUB-SUB-PLAN for depth 2', () => {
    expect(getDepthLabel(2)).toBe('SUB-SUB-PLAN');
  });

  it('should return LEVEL-3 RECOVERY PLAN for depth 3', () => {
    expect(getDepthLabel(3)).toBe('LEVEL-3 RECOVERY PLAN');
  });

  it('should return LEVEL-3 RECOVERY PLAN for depth > 3', () => {
    expect(getDepthLabel(4)).toBe('LEVEL-3 RECOVERY PLAN');
    expect(getDepthLabel(10)).toBe('LEVEL-3 RECOVERY PLAN');
  });
});

describe('formatPlanForDisplay', () => {
  it('should format main plan correctly', () => {
    const plan = {
      depth: 0,
      goal: 'Build the feature',
      analysis: 'This is the analysis.',
      steps: [
        { number: 1, description: 'Step one', complexity: 'simple', status: 'completed' },
        { number: 2, description: 'Step two', complexity: 'medium', status: 'in_progress' },
        { number: 3, description: 'Step three', complexity: 'complex', status: 'pending' },
      ],
    };

    const formatted = formatPlanForDisplay(plan);

    expect(formatted).toContain('MAIN PLAN');
    expect(formatted).toContain('Build the feature');
    expect(formatted).toContain('This is the analysis');
    expect(formatted).toContain('✓ 1. Step one [simple]');
    expect(formatted).toContain('→ 2. Step two [medium]');
    expect(formatted).toContain('3. Step three [complex]');
  });

  it('should format sub-plan correctly', () => {
    const plan = {
      depth: 1,
      goal: 'Alternative approach',
      analysis: 'Sub-plan analysis.',
      steps: [
        { number: 1, description: 'Sub-step', complexity: 'simple', status: 'pending' },
      ],
    };

    const formatted = formatPlanForDisplay(plan);

    expect(formatted).toContain('SUB-PLAN');
  });

  it('should format sub-sub-plan correctly', () => {
    const plan = {
      depth: 2,
      goal: 'Deep alternative',
      analysis: 'Analysis.',
      steps: [],
    };

    const formatted = formatPlanForDisplay(plan);

    expect(formatted).toContain('SUB-SUB-PLAN');
  });

  it('should format level 3 plan correctly', () => {
    const plan = {
      depth: 3,
      goal: 'Recovery plan',
      analysis: 'Analysis.',
      steps: [],
    };

    const formatted = formatPlanForDisplay(plan);

    expect(formatted).toContain('LEVEL-3 PLAN');
  });

  it('should show failed status with X icon', () => {
    const plan = {
      depth: 0,
      goal: 'Test',
      analysis: 'Analysis.',
      steps: [
        { number: 1, description: 'Failed step', complexity: 'simple', status: 'failed' },
      ],
    };

    const formatted = formatPlanForDisplay(plan);

    expect(formatted).toContain('✗ 1. Failed step');
  });

  it('should include decorative header', () => {
    const plan = {
      depth: 0,
      goal: 'Test',
      analysis: 'Analysis.',
      steps: [],
    };

    const formatted = formatPlanForDisplay(plan);

    expect(formatted).toContain('═══');
  });
});
