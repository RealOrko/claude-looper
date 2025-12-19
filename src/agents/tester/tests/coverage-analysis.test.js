import { describe, it, expect } from 'vitest';
import {
  TestCoverageAnalysis,
  TestExecutionResult,
  EDGE_CASE_PATTERNS,
  identifyRelevantEdgeCases,
} from '../coverage-analysis.js';

describe('coverage-analysis', () => {
  describe('TestCoverageAnalysis', () => {
    it('should initialize with correct defaults', () => {
      const analysis = new TestCoverageAnalysis('step_1');
      expect(analysis.stepId).toBe('step_1');
      expect(analysis.overallCoverage).toBe('none');
      expect(analysis.coveragePercent).toBe(0);
      expect(analysis.testedFiles).toHaveLength(0);
      expect(analysis.untestedFiles).toHaveLength(0);
    });

    describe('analyze', () => {
      it('should detect tested files', () => {
        const analysis = new TestCoverageAnalysis('step_1');
        const codeOutput = {
          files: [{ path: 'src/utils.js' }, { path: 'src/main.js' }],
          tests: [{ path: 'test/utils.test.js' }],
        };

        analysis.analyze(codeOutput, null);

        expect(analysis.testedFiles).toContain('src/utils.js');
        expect(analysis.untestedFiles).toContain('src/main.js');
      });

      it('should calculate coverage percentage', () => {
        const analysis = new TestCoverageAnalysis('step_1');
        const codeOutput = {
          files: [
            { path: 'src/a.js' },
            { path: 'src/b.js' },
            { path: 'src/c.js' },
            { path: 'src/d.js' },
          ],
          tests: [{ path: 'test/a.test.js' }, { path: 'test/b.test.js' }, { path: 'test/c.test.js' }],
        };

        analysis.analyze(codeOutput, null);

        expect(analysis.coveragePercent).toBe(75);
        expect(analysis.overallCoverage).toBe('good');
      });

      it('should determine excellent coverage', () => {
        const analysis = new TestCoverageAnalysis('step_1');
        const codeOutput = {
          files: [{ path: 'src/a.js' }],
          tests: [{ path: 'test/a.test.js' }],
        };

        analysis.analyze(codeOutput, null);

        expect(analysis.coveragePercent).toBe(100);
        expect(analysis.overallCoverage).toBe('excellent');
      });

      it('should determine poor coverage', () => {
        const analysis = new TestCoverageAnalysis('step_1');
        const codeOutput = {
          files: [
            { path: 'src/a.js' },
            { path: 'src/b.js' },
            { path: 'src/c.js' },
            { path: 'src/d.js' },
            { path: 'src/e.js' },
          ],
          tests: [{ path: 'test/a.test.js' }],
        };

        analysis.analyze(codeOutput, null);

        expect(analysis.coveragePercent).toBe(20);
        expect(analysis.overallCoverage).toBe('poor');
      });

      it('should assess test quality based on issues', () => {
        const analysis = new TestCoverageAnalysis('step_1');
        const codeOutput = {
          files: [{ path: 'src/a.js' }],
          tests: [{ path: 'test/a.test.js' }],
        };

        analysis.analyze(codeOutput, { issues: [] });
        expect(analysis.testQuality).toBe('good');

        const analysis2 = new TestCoverageAnalysis('step_2');
        analysis2.analyze(codeOutput, { issues: [1, 2] });
        expect(analysis2.testQuality).toBe('acceptable');

        const analysis3 = new TestCoverageAnalysis('step_3');
        analysis3.analyze(codeOutput, { issues: [1, 2, 3, 4] });
        expect(analysis3.testQuality).toBe('poor');
      });

      it('should handle empty files', () => {
        const analysis = new TestCoverageAnalysis('step_1');
        analysis.analyze({ files: [], tests: [] }, null);

        expect(analysis.overallCoverage).toBe('none');
        expect(analysis.coveragePercent).toBe(0);
      });
    });

    describe('edge cases', () => {
      it('should add missing edge case', () => {
        const analysis = new TestCoverageAnalysis('step_1');
        analysis.addMissingEdgeCase('null handling', 'high');

        expect(analysis.edgeCasesMissing).toHaveLength(1);
        expect(analysis.edgeCasesMissing[0].description).toBe('null handling');
        expect(analysis.edgeCasesMissing[0].severity).toBe('high');
      });

      it('should add covered edge case', () => {
        const analysis = new TestCoverageAnalysis('step_1');
        analysis.addCoveredEdgeCase('empty array handling');

        expect(analysis.edgeCasesCovered).toHaveLength(1);
        expect(analysis.edgeCasesCovered[0].description).toBe('empty array handling');
      });
    });

    describe('getSummary', () => {
      it('should return complete summary', () => {
        const analysis = new TestCoverageAnalysis('step_1');
        analysis.overallCoverage = 'good';
        analysis.coveragePercent = 75;
        analysis.testQuality = 'acceptable';
        analysis.testedFiles = ['a.js', 'b.js'];
        analysis.untestedFiles = ['c.js'];
        analysis.addCoveredEdgeCase('null');
        analysis.addMissingEdgeCase('empty');

        const summary = analysis.getSummary();

        expect(summary.overall).toBe('good');
        expect(summary.percent).toBe(75);
        expect(summary.quality).toBe('acceptable');
        expect(summary.testedFiles).toBe(2);
        expect(summary.untestedFiles).toBe(1);
        expect(summary.edgeCasesCovered).toBe(1);
        expect(summary.edgeCasesMissing).toBe(1);
      });
    });
  });

  describe('TestExecutionResult', () => {
    it('should initialize with correct defaults', () => {
      const result = new TestExecutionResult('npm test');
      expect(result.command).toBe('npm test');
      expect(result.exitCode).toBeNull();
      expect(result.stdout).toBe('');
      expect(result.stderr).toBe('');
      expect(result.duration).toBe(0);
      expect(result.passed).toBe(false);
      expect(result.timedOut).toBe(false);
    });

    it('should add failure details', () => {
      const result = new TestExecutionResult('npm test');
      result.addFailureDetail('test_1', 'Expected true to be false', 'stack trace');

      expect(result.failureDetails).toHaveLength(1);
      expect(result.failureDetails[0].testName).toBe('test_1');
      expect(result.failureDetails[0].message).toBe('Expected true to be false');
      expect(result.failureDetails[0].stack).toBe('stack trace');
    });
  });

  describe('EDGE_CASE_PATTERNS', () => {
    it('should have expected patterns', () => {
      expect(EDGE_CASE_PATTERNS.length).toBeGreaterThan(0);

      const nullPattern = EDGE_CASE_PATTERNS.find(p => p.name === 'null_undefined');
      expect(nullPattern).toBeDefined();
      expect(nullPattern.keywords).toContain('null');

      const asyncPattern = EDGE_CASE_PATTERNS.find(p => p.name === 'async_errors');
      expect(asyncPattern).toBeDefined();
      expect(asyncPattern.keywords).toContain('async');
    });
  });

  describe('identifyRelevantEdgeCases', () => {
    it('should identify null/undefined patterns', () => {
      const code = 'if (value === null) { return undefined; }';
      const patterns = identifyRelevantEdgeCases(code);

      const nullPattern = patterns.find(p => p.name === 'null_undefined');
      expect(nullPattern).toBeDefined();
    });

    it('should identify async patterns', () => {
      const code = 'async function fetch() { await getData(); }';
      const patterns = identifyRelevantEdgeCases(code);

      const asyncPattern = patterns.find(p => p.name === 'async_errors');
      expect(asyncPattern).toBeDefined();
    });

    it('should identify empty value patterns', () => {
      const code = 'if (arr.length === 0) { return []; }';
      const patterns = identifyRelevantEdgeCases(code);

      const emptyPattern = patterns.find(p => p.name === 'empty_values');
      expect(emptyPattern).toBeDefined();
    });

    it('should identify boundary patterns', () => {
      const code = 'if (value >= max || value <= min) { }';
      const patterns = identifyRelevantEdgeCases(code);

      const boundaryPattern = patterns.find(p => p.name === 'boundary_values');
      expect(boundaryPattern).toBeDefined();
    });

    it('should return empty for code without patterns', () => {
      const code = 'const x = 42;';
      const patterns = identifyRelevantEdgeCases(code);

      expect(patterns.length).toBe(0);
    });
  });
});
