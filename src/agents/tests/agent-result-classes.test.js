/**
 * Tests for agent-result-classes.js
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  CodeOutput,
  TestExecutionResult,
  TestCoverageAnalysis,
} from '../agent-result-classes.js';

describe('CodeOutput', () => {
  let output;

  beforeEach(() => {
    output = new CodeOutput('step_1');
  });

  describe('constructor', () => {
    it('should initialize with correct defaults', () => {
      expect(output.stepId).toBe('step_1');
      expect(output.files).toEqual([]);
      expect(output.commands).toEqual([]);
      expect(output.tests).toEqual([]);
      expect(output.blocked).toBe(false);
      expect(output.requiresSubPlan).toBe(false);
    });
  });

  describe('addFile', () => {
    it('should add files with detected language', () => {
      output.addFile('src/app.js', 'created', 'console.log("hi")');
      expect(output.files).toHaveLength(1);
      expect(output.files[0].language).toBe('javascript');
    });

    it('should truncate long content', () => {
      const longContent = 'x'.repeat(10000);
      output.addFile('big.js', 'created', longContent);
      expect(output.files[0].content.length).toBe(5000);
    });

    it('should detect various languages', () => {
      output.addFile('main.py', 'created', '');
      output.addFile('server.ts', 'modified', '');
      output.addFile('index.go', 'created', '');
      output.addFile('lib.rs', 'created', '');

      expect(output.files[0].language).toBe('python');
      expect(output.files[1].language).toBe('typescript');
      expect(output.files[2].language).toBe('go');
      expect(output.files[3].language).toBe('rust');
    });

    it('should default to text for unknown extensions', () => {
      output.addFile('config.toml', 'created', '');
      expect(output.files[0].language).toBe('text');
    });
  });

  describe('addCommand', () => {
    it('should track commands', () => {
      output.addCommand('npm test', 'All tests pass', 0);
      expect(output.commands).toHaveLength(1);
      expect(output.commands[0].exitCode).toBe(0);
    });

    it('should truncate long output', () => {
      const longOutput = 'x'.repeat(5000);
      output.addCommand('cmd', longOutput, 0);
      expect(output.commands[0].output.length).toBe(2000);
    });
  });

  describe('addTest', () => {
    it('should add test files', () => {
      output.addTest('src/test.js', 'unit', 'test code');
      expect(output.tests).toHaveLength(1);
      expect(output.tests[0].testType).toBe('unit');
    });
  });

  describe('setBlocked', () => {
    it('should set blocked state', () => {
      output.setBlocked('Cannot find dependency');
      expect(output.blocked).toBe(true);
      expect(output.blockReason).toBe('Cannot find dependency');
    });
  });

  describe('requestSubPlan', () => {
    it('should request sub-plan and block', () => {
      output.requestSubPlan('Step too complex');
      expect(output.requiresSubPlan).toBe(true);
      expect(output.subPlanReason).toBe('Step too complex');
      expect(output.blocked).toBe(true);
    });
  });

  describe('updateTestCoverage', () => {
    it('should calculate coverage as none when no tests', () => {
      output.addFile('src/app.js', 'created', '');
      output.updateTestCoverage();
      expect(output.testCoverage.coverageEstimate).toBe('none');
    });

    it('should calculate good coverage when tests >= source files', () => {
      output.addFile('src/app.js', 'created', '');
      output.addTest('src/app.test.js', 'unit', '');
      output.updateTestCoverage();
      expect(output.testCoverage.coverageEstimate).toBe('good');
    });

    it('should calculate partial coverage for 50%+ files', () => {
      output.addFile('src/app.js', 'created', '');
      output.addFile('src/util.js', 'created', '');
      output.addFile('src/lib.js', 'created', '');
      output.addTest('src/app.test.js', 'unit', '');
      output.addTest('src/util.test.js', 'unit', '');
      output.updateTestCoverage();
      expect(output.testCoverage.coverageEstimate).toBe('partial');
    });
  });

  describe('assessQuality', () => {
    it('should deduct for missing tests', () => {
      output.addFile('src/app.js', 'created', '');
      output.summary = 'Added application file';
      output.updateTestCoverage();
      const quality = output.assessQuality();
      expect(quality.issues).toContain('No tests provided');
    });

    it('should deduct for missing files', () => {
      const quality = output.assessQuality();
      expect(quality.issues).toContain('No files modified');
    });

    it('should add strength for comprehensive implementation', () => {
      output.addFile('src/app.js', 'created', '');
      output.addTest('src/app.test.js', 'unit', '');
      output.summary = 'Implemented the full feature with proper error handling and tests';
      output.updateTestCoverage();
      const quality = output.assessQuality();
      expect(quality.strengths.some(s => s.includes('Comprehensive'))).toBe(true);
    });
  });

  describe('meetsMinimumQuality', () => {
    it('should return false when blocked', () => {
      output.setBlocked('Error');
      expect(output.meetsMinimumQuality()).toBe(false);
    });

    it('should return false when no files', () => {
      expect(output.meetsMinimumQuality()).toBe(false);
    });

    it('should return false when requireTests and no tests', () => {
      output.addFile('app.js', 'created', '');
      expect(output.meetsMinimumQuality(true)).toBe(false);
    });

    it('should return true when tests not required', () => {
      output.addFile('app.js', 'created', '');
      output.summary = 'Added application';
      expect(output.meetsMinimumQuality(false)).toBe(true);
    });
  });

  describe('getArtifacts', () => {
    it('should return summary of artifacts', () => {
      output.addFile('src/new.js', 'created', '');
      output.addFile('src/old.js', 'modified', '');
      output.addTest('test.js', 'unit', '');
      output.addCommand('npm test', '', 0);
      output.updateTestCoverage();
      output.assessQuality();

      const artifacts = output.getArtifacts();
      expect(artifacts.filesCreated).toContain('src/new.js');
      expect(artifacts.filesModified).toContain('src/old.js');
      expect(artifacts.testsCreated).toContain('test.js');
      expect(artifacts.commandsRun).toBe(1);
    });
  });
});

describe('TestExecutionResult', () => {
  let result;

  beforeEach(() => {
    result = new TestExecutionResult('npm test');
  });

  describe('constructor', () => {
    it('should initialize with command', () => {
      expect(result.command).toBe('npm test');
      expect(result.exitCode).toBeNull();
      expect(result.passed).toBe(false);
      expect(result.timedOut).toBe(false);
    });
  });

  describe('addFailureDetail', () => {
    it('should add failure details', () => {
      result.addFailureDetail('test_login', 'Expected 200 but got 401', 'stack trace');
      expect(result.failureDetails).toHaveLength(1);
      expect(result.failureDetails[0].testName).toBe('test_login');
      expect(result.failureDetails[0].message).toBe('Expected 200 but got 401');
    });

    it('should add multiple failures', () => {
      result.addFailureDetail('test1', 'Error 1');
      result.addFailureDetail('test2', 'Error 2');
      expect(result.failureDetails).toHaveLength(2);
    });
  });
});

describe('TestCoverageAnalysis', () => {
  let analysis;

  beforeEach(() => {
    analysis = new TestCoverageAnalysis('step_1');
  });

  describe('constructor', () => {
    it('should initialize with defaults', () => {
      expect(analysis.stepId).toBe('step_1');
      expect(analysis.overallCoverage).toBe('none');
      expect(analysis.coveragePercent).toBe(0);
      expect(analysis.testQuality).toBe('unknown');
    });
  });

  describe('analyze', () => {
    it('should calculate excellent coverage', () => {
      const codeOutput = {
        files: [{ path: 'src/app.js' }],
        tests: [{ path: 'src/app.test.js' }],
      };
      analysis.analyze(codeOutput, { issues: [] });
      expect(analysis.overallCoverage).toBe('excellent');
      expect(analysis.coveragePercent).toBe(100);
    });

    it('should calculate none when no files', () => {
      analysis.analyze({ files: [], tests: [] }, null);
      expect(analysis.overallCoverage).toBe('none');
    });

    it('should assess test quality based on issues', () => {
      const codeOutput = {
        files: [{ path: 'src/app.js' }],
        tests: [{ path: 'src/app.test.js' }],
      };
      analysis.analyze(codeOutput, { issues: [] });
      expect(analysis.testQuality).toBe('good');
    });

    it('should mark quality as poor with many issues', () => {
      const codeOutput = {
        files: [{ path: 'src/app.js' }],
        tests: [{ path: 'src/app.test.js' }],
      };
      analysis.analyze(codeOutput, {
        issues: [1, 2, 3, 4, 5], // More than 2 issues
      });
      expect(analysis.testQuality).toBe('poor');
    });
  });

  describe('addMissingEdgeCase', () => {
    it('should track missing edge cases', () => {
      analysis.addMissingEdgeCase('null input handling', 'high');
      expect(analysis.edgeCasesMissing).toHaveLength(1);
      expect(analysis.edgeCasesMissing[0].description).toBe('null input handling');
    });
  });

  describe('addCoveredEdgeCase', () => {
    it('should track covered edge cases', () => {
      analysis.addCoveredEdgeCase('empty array handling');
      expect(analysis.edgeCasesCovered).toHaveLength(1);
    });
  });

  describe('getSummary', () => {
    it('should return summary object', () => {
      analysis.addMissingEdgeCase('test');
      analysis.addCoveredEdgeCase('test2');

      const summary = analysis.getSummary();
      expect(summary.overall).toBe('none');
      expect(summary.edgeCasesMissing).toBe(1);
      expect(summary.edgeCasesCovered).toBe(1);
    });
  });
});
