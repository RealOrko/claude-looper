/**
 * Tests for evidence-parser.js
 */

import { describe, it, expect } from 'vitest';
import {
  parseEvidence,
  isLikelyFalsePositive,
  isReadOnlyTask,
  evaluateEvidence,
  buildChallengePrompt,
} from '../evidence-parser.js';

describe('parseEvidence', () => {
  it('should return empty evidence for null response', () => {
    const evidence = parseEvidence(null);

    expect(evidence.files).toEqual([]);
    expect(evidence.testCommands).toEqual([]);
    expect(evidence.buildCommands).toEqual([]);
    expect(evidence.codeSnippets).toEqual([]);
    expect(evidence.subGoalConfirmations).toBe(0);
  });

  describe('file extraction', () => {
    it('should extract files in backticks', () => {
      const evidence = parseEvidence('I created `src/app.js` and `tests/app.test.js`');

      expect(evidence.files).toContain('src/app.js');
      expect(evidence.files).toContain('tests/app.test.js');
    });

    it('should extract relative paths', () => {
      const evidence = parseEvidence('Modified ./src/utils.js');

      expect(evidence.files).toContain('./src/utils.js');
    });

    it('should extract src/ paths', () => {
      const evidence = parseEvidence('Updated src/components/Button.tsx');

      expect(evidence.files).toContain('src/components/Button.tsx');
    });

    it('should extract files after "created" keyword', () => {
      const evidence = parseEvidence('Created file.js and modified other.js');

      expect(evidence.files).toContain('file.js');
    });

    it('should deduplicate files', () => {
      const evidence = parseEvidence('`app.js` and also `app.js` again');

      expect(evidence.files.filter(f => f === 'app.js')).toHaveLength(1);
    });

    it('should filter out false positives', () => {
      const evidence = parseEvidence('See https://example.com/file.js');

      expect(evidence.files).not.toContain('https://example.com/file.js');
    });
  });

  describe('command extraction', () => {
    it('should extract npm test commands', () => {
      const evidence = parseEvidence('Run `npm test` to verify');

      expect(evidence.testCommands).toContain('npm test');
    });

    it('should extract pytest commands', () => {
      const evidence = parseEvidence('Execute `pytest tests/` to run tests');

      expect(evidence.testCommands).toContain('pytest tests/');
    });

    it('should extract go test commands', () => {
      const evidence = parseEvidence('Verify with `go test ./...`');

      expect(evidence.testCommands).toContain('go test ./...');
    });

    it('should extract build commands', () => {
      const evidence = parseEvidence('Build with `npm run build`');

      expect(evidence.buildCommands).toContain('npm run build');
    });

    it('should extract make commands', () => {
      const evidence = parseEvidence('Run `make` to compile');

      expect(evidence.buildCommands).toContain('make');
    });
  });

  describe('sub-goal confirmations', () => {
    it('should count checked boxes', () => {
      const evidence = parseEvidence(`
        - [x] First goal
        - [ ] Second goal (not done)
        - [x] Third goal
      `);

      expect(evidence.subGoalConfirmations).toBe(2);
    });
  });

  describe('code snippets', () => {
    it('should extract code blocks', () => {
      const evidence = parseEvidence(`
Here is the implementation:
\`\`\`javascript
function hello() {
  console.log('Hello World');
}
\`\`\`
      `);

      expect(evidence.codeSnippets).toHaveLength(1);
      expect(evidence.codeSnippets[0]).toContain('function hello');
    });

    it('should skip short code blocks', () => {
      const evidence = parseEvidence(`
\`\`\`
short
\`\`\`
      `);

      expect(evidence.codeSnippets).toHaveLength(0);
    });

    it('should truncate long snippets', () => {
      const longCode = 'x'.repeat(1000);
      const evidence = parseEvidence(`
\`\`\`
${longCode}
\`\`\`
      `);

      expect(evidence.codeSnippets[0].length).toBeLessThanOrEqual(500);
    });
  });
});

describe('isLikelyFalsePositive', () => {
  it('should detect URLs', () => {
    expect(isLikelyFalsePositive('https://example.com/file.js')).toBe(true);
    expect(isLikelyFalsePositive('http://example.com/file.js')).toBe(true);
  });

  it('should detect mailto links', () => {
    expect(isLikelyFalsePositive('mailto:user@example.com')).toBe(true);
  });

  it('should detect version numbers', () => {
    expect(isLikelyFalsePositive('1.0.0')).toBe(true);
    expect(isLikelyFalsePositive('2.1.0-beta')).toBe(true);
  });

  it('should detect placeholder text', () => {
    expect(isLikelyFalsePositive('example.js')).toBe(true);
    expect(isLikelyFalsePositive('placeholder.txt')).toBe(true);
  });

  it('should accept valid file paths', () => {
    expect(isLikelyFalsePositive('src/app.js')).toBe(false);
    expect(isLikelyFalsePositive('utils.ts')).toBe(false);
  });
});

describe('isReadOnlyTask', () => {
  it('should detect read-only indicators', () => {
    expect(isReadOnlyTask({ raw: 'No files were created during this analysis' })).toBe(true);
    expect(isReadOnlyTask({ raw: 'This was a read-only task' })).toBe(true);
    expect(isReadOnlyTask({ raw: 'I only ran commands to analyze' })).toBe(true);
  });

  it('should not flag normal responses', () => {
    expect(isReadOnlyTask({ raw: 'I created the new file' })).toBe(false);
    expect(isReadOnlyTask({ raw: 'Implementation complete' })).toBe(false);
  });

  it('should handle missing raw field', () => {
    expect(isReadOnlyTask({})).toBe(false);
    expect(isReadOnlyTask({ raw: null })).toBe(false);
  });
});

describe('evaluateEvidence', () => {
  it('should pass for read-only tasks with code snippets', () => {
    const evidence = {
      files: [],
      codeSnippets: ['console.log("output")'],
      testCommands: [],
      buildCommands: [],
      subGoalConfirmations: 0,
      raw: 'no files were created',
    };

    expect(evaluateEvidence(evidence)).toBe(true);
  });

  it('should pass for read-only tasks with confirmations', () => {
    const evidence = {
      files: [],
      codeSnippets: [],
      testCommands: [],
      buildCommands: [],
      subGoalConfirmations: 2,
      raw: 'analysis task only',
    };

    expect(evaluateEvidence(evidence)).toBe(true);
  });

  it('should fail for file tasks without files', () => {
    const evidence = {
      files: [],
      codeSnippets: [],
      testCommands: [],
      buildCommands: [],
      subGoalConfirmations: 0,
      raw: 'I implemented the feature',
    };

    expect(evaluateEvidence(evidence)).toBe(false);
  });

  it('should fail for files without verification method', () => {
    const evidence = {
      files: ['app.js'],
      codeSnippets: [],
      testCommands: [],
      buildCommands: [],
      subGoalConfirmations: 0,
      raw: '',
    };

    expect(evaluateEvidence(evidence)).toBe(false);
  });

  it('should pass for files with code snippets', () => {
    const evidence = {
      files: ['app.js'],
      codeSnippets: ['function main() {}'],
      testCommands: [],
      buildCommands: [],
      subGoalConfirmations: 0,
      raw: '',
    };

    expect(evaluateEvidence(evidence)).toBe(true);
  });

  it('should pass for files with test commands', () => {
    const evidence = {
      files: ['app.js'],
      codeSnippets: [],
      testCommands: ['npm test'],
      buildCommands: [],
      subGoalConfirmations: 0,
      raw: '',
    };

    expect(evaluateEvidence(evidence)).toBe(true);
  });

  it('should pass for files with build commands', () => {
    const evidence = {
      files: ['app.js'],
      codeSnippets: [],
      testCommands: [],
      buildCommands: ['npm run build'],
      subGoalConfirmations: 0,
      raw: '',
    };

    expect(evaluateEvidence(evidence)).toBe(true);
  });
});

describe('buildChallengePrompt', () => {
  it('should include goal and claim', () => {
    const prompt = buildChallengePrompt('I finished everything', 'Build a website');

    expect(prompt).toContain('Build a website');
    expect(prompt).toContain('I finished everything');
  });

  it('should truncate long claims', () => {
    const longClaim = 'x'.repeat(1000);
    const prompt = buildChallengePrompt(longClaim, 'Goal');

    // The prompt includes the truncated claim (first 800 chars)
    // Verify the claim is truncated at 800 chars
    const claimSection = prompt.match(/\*\*Your Completion Claim:\*\*\n([^\n]*)/);
    expect(claimSection).toBeTruthy();
    expect(claimSection[1].length).toBe(800);
  });

  it('should include sub-goals as checklist', () => {
    const subGoals = [
      { description: 'First sub-goal' },
      { description: 'Second sub-goal' },
    ];
    const prompt = buildChallengePrompt('Done', 'Goal', subGoals);

    expect(prompt).toContain('- [ ] First sub-goal');
    expect(prompt).toContain('- [ ] Second sub-goal');
  });

  it('should use default when no sub-goals', () => {
    const prompt = buildChallengePrompt('Done', 'Goal', []);

    expect(prompt).toContain('Primary goal completed');
  });

  it('should include verification requirements', () => {
    const prompt = buildChallengePrompt('Done', 'Goal');

    expect(prompt).toContain('FILES CREATED OR MODIFIED');
    expect(prompt).toContain('KEY IMPLEMENTATION');
    expect(prompt).toContain('VERIFICATION METHOD');
    expect(prompt).toContain('SUB-GOAL CHECKLIST');
  });
});
