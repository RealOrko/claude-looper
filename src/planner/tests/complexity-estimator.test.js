/**
 * Tests for complexity-estimator.js
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ComplexityEstimator } from '../complexity-estimator.js';

describe('ComplexityEstimator', () => {
  let estimator;

  beforeEach(() => {
    estimator = new ComplexityEstimator();
  });

  describe('estimateComplexity', () => {
    it('should identify simple patterns', () => {
      expect(estimator.estimateComplexity('Read the config file')).toBe('simple');
      expect(estimator.estimateComplexity('Check if file exists')).toBe('simple');
      expect(estimator.estimateComplexity('List all users')).toBe('simple');
      expect(estimator.estimateComplexity('Add comment to function')).toBe('simple');
      expect(estimator.estimateComplexity('Update version number')).toBe('simple');
    });

    it('should identify complex patterns', () => {
      expect(estimator.estimateComplexity('Refactor the authentication module')).toBe('complex');
      expect(estimator.estimateComplexity('Implement from scratch a new parser')).toBe('complex');
      expect(estimator.estimateComplexity('Integrate with external API')).toBe('complex');
      expect(estimator.estimateComplexity('Optimize performance of queries')).toBe('complex');
      expect(estimator.estimateComplexity('Add comprehensive test coverage')).toBe('complex');
      expect(estimator.estimateComplexity('Update multiple files across codebase')).toBe('complex');
      expect(estimator.estimateComplexity('Implement security authentication')).toBe('complex');
      expect(estimator.estimateComplexity('Migrate database schema')).toBe('complex');
    });

    it('should default to medium for unknown patterns', () => {
      expect(estimator.estimateComplexity('Do something with the data')).toBe('medium');
      expect(estimator.estimateComplexity('Process the input')).toBe('medium');
    });
  });

  describe('refineComplexity', () => {
    it('should return estimated complexity when insufficient history', () => {
      expect(estimator.refineComplexity('medium', 'Test step')).toBe('medium');
    });

    it('should refine based on similar past steps', () => {
      // Add enough history
      for (let i = 0; i < 5; i++) {
        estimator.recordStepCompletion(
          { description: 'Update the configuration settings', complexity: 'medium' },
          15 * 60 * 1000 // 15 minutes - complex
        );
      }

      // Similar step should now be refined to complex
      const refined = estimator.refineComplexity('medium', 'Update the settings configuration');
      expect(refined).toBe('complex');
    });

    it('should refine to simple for fast steps', () => {
      for (let i = 0; i < 5; i++) {
        estimator.recordStepCompletion(
          { description: 'Check the file status', complexity: 'medium' },
          1 * 60 * 1000 // 1 minute - simple
        );
      }

      const refined = estimator.refineComplexity('medium', 'Check file status report');
      expect(refined).toBe('simple');
    });

    it('should return estimated if no similar steps found', () => {
      for (let i = 0; i < 5; i++) {
        estimator.recordStepCompletion(
          { description: 'Completely different task', complexity: 'simple' },
          1000
        );
      }

      const refined = estimator.refineComplexity('complex', 'Update configuration');
      expect(refined).toBe('complex');
    });
  });

  describe('recordStepCompletion', () => {
    it('should record step completion', () => {
      estimator.recordStepCompletion(
        { description: 'Test step', complexity: 'simple' },
        5000
      );

      expect(estimator.complexityHistory).toHaveLength(1);
      expect(estimator.complexityHistory[0].description).toBe('Test step');
      expect(estimator.complexityHistory[0].duration).toBe(5000);
    });

    it('should limit history to 50 entries', () => {
      for (let i = 0; i < 60; i++) {
        estimator.recordStepCompletion({ description: `Step ${i}`, complexity: 'simple' }, 1000);
      }

      expect(estimator.complexityHistory).toHaveLength(50);
      expect(estimator.complexityHistory[0].description).toBe('Step 10');
    });
  });

  describe('shouldDecomposeStep', () => {
    it('should always decompose complex pending steps', () => {
      const step = { complexity: 'complex', status: 'pending' };
      expect(estimator.shouldDecomposeStep(step, 0)).toBe(true);
    });

    it('should not decompose non-pending complex steps without time', () => {
      const step = { complexity: 'complex', status: 'in_progress' };
      expect(estimator.shouldDecomposeStep(step, 0)).toBe(false);
    });

    it('should decompose simple steps after 5 minutes in progress', () => {
      const step = { complexity: 'simple', status: 'in_progress' };
      expect(estimator.shouldDecomposeStep(step, 4 * 60 * 1000)).toBe(false);
      expect(estimator.shouldDecomposeStep(step, 6 * 60 * 1000)).toBe(true);
    });

    it('should decompose medium steps after 10 minutes in progress', () => {
      const step = { complexity: 'medium', status: 'in_progress' };
      expect(estimator.shouldDecomposeStep(step, 9 * 60 * 1000)).toBe(false);
      expect(estimator.shouldDecomposeStep(step, 11 * 60 * 1000)).toBe(true);
    });

    it('should decompose complex steps after 15 minutes in progress', () => {
      const step = { complexity: 'complex', status: 'in_progress' };
      expect(estimator.shouldDecomposeStep(step, 14 * 60 * 1000)).toBe(false);
      expect(estimator.shouldDecomposeStep(step, 16 * 60 * 1000)).toBe(true);
    });

    it('should use medium threshold for unknown complexity', () => {
      const step = { complexity: 'unknown', status: 'in_progress' };
      expect(estimator.shouldDecomposeStep(step, 11 * 60 * 1000)).toBe(true);
    });
  });

  describe('getThresholds', () => {
    it('should return correct thresholds', () => {
      const thresholds = estimator.getThresholds();
      expect(thresholds.simple).toBe(5 * 60 * 1000);
      expect(thresholds.medium).toBe(10 * 60 * 1000);
      expect(thresholds.complex).toBe(15 * 60 * 1000);
    });
  });
});
