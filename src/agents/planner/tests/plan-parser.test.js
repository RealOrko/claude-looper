/**
 * Tests for Plan Parser Module
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  parsePlanResponse,
  parseStepLine,
  validatePlan,
  extractAnalysis,
  extractRisks,
  extractTotalSteps,
} from '../plan-parser.js';

// Mock the interfaces module
vi.mock('../../interfaces.js', () => ({
  ExecutionPlan: class {
    constructor(goal) {
      this.id = `plan-${Date.now()}`;
      this.goal = goal;
      this.steps = [];
      this.analysis = '';
    }
  },
  PlanStep: class {
    constructor(number, description, complexity) {
      this.id = `step-${number}`;
      this.number = number;
      this.description = description;
      this.complexity = complexity;
      this.status = 'pending';
    }
  },
}));

describe('parsePlanResponse', () => {
  it('should parse a well-formatted plan response', () => {
    const response = `
ANALYSIS:
This is a comprehensive analysis of the goal.

PLAN:
1. Create the initial project structure | simple
2. Implement the core functionality | medium
3. Add unit tests for new features | medium

DEPENDENCIES:
None

RISKS:
None identified

TOTAL_STEPS: 3
`;

    const plan = parsePlanResponse(response, 'Test goal');

    expect(plan.goal).toBe('Test goal');
    expect(plan.steps).toHaveLength(3);
    expect(plan.analysis).toContain('comprehensive analysis');
  });

  it('should parse steps with complexity indicators', () => {
    const response = `
PLAN:
1. Setup configuration | simple
2. Build feature | complex
3. Test everything | medium

TOTAL_STEPS: 3
`;

    const plan = parsePlanResponse(response, 'Test');

    expect(plan.steps[0].complexity).toBe('simple');
    expect(plan.steps[1].complexity).toBe('complex');
    expect(plan.steps[2].complexity).toBe('medium');
  });

  it('should default to medium complexity when not specified', () => {
    const response = `
PLAN:
1. First step without complexity
2. Second step without complexity

TOTAL_STEPS: 2
`;

    const plan = parsePlanResponse(response, 'Test');

    expect(plan.steps[0].complexity).toBe('medium');
    expect(plan.steps[1].complexity).toBe('medium');
  });

  it('should extract analysis section', () => {
    const response = `
ANALYSIS:
This is the first line.
This is the second line.

PLAN:
1. Step one | simple
2. Step two | simple
`;

    const plan = parsePlanResponse(response, 'Test');

    expect(plan.analysis).toContain('first line');
    expect(plan.analysis).toContain('second line');
  });

  it('should handle inline analysis after ANALYSIS:', () => {
    const response = `
ANALYSIS: This is inline analysis.

PLAN:
1. Step one | simple
2. Step two | simple
`;

    const plan = parsePlanResponse(response, 'Test');

    expect(plan.analysis).toContain('inline analysis');
  });

  it('should stop analysis at ALTERNATIVE_APPROACH', () => {
    const response = `
ANALYSIS:
Initial analysis.

ALTERNATIVE_APPROACH:
New strategy here.

PLAN:
1. Step one | simple
2. Step two | simple
`;

    const plan = parsePlanResponse(response, 'Test');

    expect(plan.analysis).toContain('Initial analysis');
    expect(plan.analysis).not.toContain('New strategy');
  });

  it('should use fallback for responses without PLAN: header', () => {
    const response = `
Here is my plan:
1. First step description
2. Second step description
3. Third step description
`;

    const plan = parsePlanResponse(response, 'Test');

    expect(plan.steps.length).toBeGreaterThan(0);
  });

  it('should stop parsing steps at DEPENDENCIES section', () => {
    const response = `
PLAN:
1. Step one | simple
2. Step two | simple

DEPENDENCIES:
Step 2 depends on Step 1
Some other dependency info

TOTAL_STEPS: 2
`;

    const plan = parsePlanResponse(response, 'Test');

    expect(plan.steps).toHaveLength(2);
  });

  it('should stop parsing steps at RISKS section', () => {
    const response = `
PLAN:
1. Step one | simple
2. Step two | simple

RISKS:
Some risk info

TOTAL_STEPS: 2
`;

    const plan = parsePlanResponse(response, 'Test');

    expect(plan.steps).toHaveLength(2);
  });

  it('should handle empty response gracefully', () => {
    const plan = parsePlanResponse('', 'Test');

    expect(plan.steps.length).toBeGreaterThan(0); // Should have fallback step
    expect(plan.goal).toBe('Test');
  });
});

describe('parseStepLine', () => {
  it('should parse step with complexity', () => {
    const step = parseStepLine('1. Create the project | simple', 1);

    expect(step).not.toBeNull();
    expect(step.number).toBe(1);
    expect(step.description).toBe('Create the project');
    expect(step.complexity).toBe('simple');
  });

  it('should parse step without complexity', () => {
    const step = parseStepLine('3. Implement the feature', 3);

    expect(step).not.toBeNull();
    expect(step.number).toBe(3);
    expect(step.description).toBe('Implement the feature');
    expect(step.complexity).toBe('medium');
  });

  it('should return null for empty line', () => {
    expect(parseStepLine('', 1)).toBeNull();
  });

  it('should return null for comment lines', () => {
    expect(parseStepLine('# This is a comment', 1)).toBeNull();
  });

  it('should return null for list items without numbers', () => {
    expect(parseStepLine('- This is a list item', 1)).toBeNull();
  });

  it('should return null for short descriptions', () => {
    expect(parseStepLine('1. Hi', 1)).toBeNull();
  });

  it('should handle case-insensitive complexity', () => {
    const step1 = parseStepLine('1. Create the component | SIMPLE', 1);
    const step2 = parseStepLine('2. Build the feature | Complex', 2);
    const step3 = parseStepLine('3. Test everything | MeDiUm', 3);

    expect(step1.complexity).toBe('simple');
    expect(step2.complexity).toBe('complex');
    expect(step3.complexity).toBe('medium');
  });

  it('should strip trailing pipe content from description', () => {
    const step = parseStepLine('1. Create the feature | simple | extra stuff', 1);

    expect(step.description).toBe('Create the feature');
  });
});

describe('validatePlan', () => {
  it('should add fallback step when no steps exist', () => {
    const plan = {
      goal: 'Test goal',
      steps: [],
      analysis: '',
    };

    validatePlan(plan);

    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0].description).toBe('Execute the goal directly');
    expect(plan.steps[0].complexity).toBe('complex');
  });

  it('should limit steps to maximum', () => {
    const plan = {
      goal: 'Test',
      steps: Array.from({ length: 20 }, (_, i) => ({
        number: i + 1,
        description: `Step ${i + 1} description here`,
        complexity: 'simple',
      })),
      analysis: '',
    };

    validatePlan(plan);

    expect(plan.steps).toHaveLength(15);
  });

  it('should renumber steps sequentially', () => {
    const plan = {
      goal: 'Test',
      steps: [
        { number: 5, description: 'First step', complexity: 'simple' },
        { number: 10, description: 'Second step', complexity: 'medium' },
        { number: 2, description: 'Third step', complexity: 'complex' },
      ],
      analysis: '',
    };

    validatePlan(plan);

    expect(plan.steps[0].number).toBe(1);
    expect(plan.steps[1].number).toBe(2);
    expect(plan.steps[2].number).toBe(3);
  });

  it('should add default analysis when missing', () => {
    const plan = {
      goal: 'Build the feature',
      steps: [{ number: 1, description: 'Step one', complexity: 'simple' }],
      analysis: '',
    };

    validatePlan(plan);

    expect(plan.analysis).toContain('Build the feature');
  });

  it('should keep existing analysis', () => {
    const plan = {
      goal: 'Test',
      steps: [{ number: 1, description: 'Step one', complexity: 'simple' }],
      analysis: 'Existing analysis',
    };

    validatePlan(plan);

    expect(plan.analysis).toBe('Existing analysis');
  });
});

describe('extractAnalysis', () => {
  it('should extract analysis from response', () => {
    const response = `
ANALYSIS:
This is line one.
This is line two.

PLAN:
1. Step one
`;

    const analysis = extractAnalysis(response);

    expect(analysis).toContain('line one');
    expect(analysis).toContain('line two');
  });

  it('should stop at PLAN section', () => {
    const response = `
ANALYSIS:
Before plan.

PLAN:
After plan.
`;

    const analysis = extractAnalysis(response);

    expect(analysis).toContain('Before plan');
    expect(analysis).not.toContain('After plan');
  });

  it('should stop at ALTERNATIVE_APPROACH section', () => {
    const response = `
ANALYSIS:
Before alternative.

ALTERNATIVE_APPROACH:
After alternative.
`;

    const analysis = extractAnalysis(response);

    expect(analysis).toContain('Before alternative');
    expect(analysis).not.toContain('After alternative');
  });

  it('should return empty string when no analysis', () => {
    const response = `
PLAN:
1. Step one
`;

    const analysis = extractAnalysis(response);

    expect(analysis).toBe('');
  });

  it('should filter out markdown headers', () => {
    const response = `
ANALYSIS:
## Header
Content after header.
`;

    const analysis = extractAnalysis(response);

    expect(analysis).not.toContain('## Header');
    expect(analysis).toContain('Content after header');
  });
});

describe('extractRisks', () => {
  it('should extract risks from response', () => {
    const response = `
RISKS:
- First risk
- Second risk

TOTAL_STEPS: 3
`;

    const risks = extractRisks(response);

    expect(risks).toHaveLength(2);
    expect(risks[0]).toBe('First risk');
    expect(risks[1]).toBe('Second risk');
  });

  it('should return empty array when none', () => {
    const response = `
RISKS:
None

TOTAL_STEPS: 3
`;

    const risks = extractRisks(response);

    expect(risks).toEqual([]);
  });

  it('should return empty array when no risks section', () => {
    const response = `
PLAN:
1. Step one

TOTAL_STEPS: 1
`;

    const risks = extractRisks(response);

    expect(risks).toEqual([]);
  });

  it('should handle bullet points with asterisks', () => {
    const response = `
RISKS:
* Risk one
* Risk two

TOTAL_STEPS: 2
`;

    const risks = extractRisks(response);

    expect(risks).toHaveLength(2);
    expect(risks[0]).toBe('Risk one');
    expect(risks[1]).toBe('Risk two');
  });
});

describe('extractTotalSteps', () => {
  it('should extract total steps count', () => {
    const response = `
PLAN:
1. Step one

TOTAL_STEPS: 5
`;

    const total = extractTotalSteps(response);

    expect(total).toBe(5);
  });

  it('should return null when not found', () => {
    const response = `
PLAN:
1. Step one
2. Step two
`;

    const total = extractTotalSteps(response);

    expect(total).toBeNull();
  });

  it('should handle different formatting', () => {
    expect(extractTotalSteps('TOTAL_STEPS:3')).toBe(3);
    expect(extractTotalSteps('TOTAL_STEPS: 10')).toBe(10);
    expect(extractTotalSteps('total_steps: 7')).toBe(7);
  });
});
