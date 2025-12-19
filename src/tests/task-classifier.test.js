import { describe, it, expect, beforeEach } from 'vitest';
import { TaskClassifier, TaskType } from '../task-classifier.js';

describe('TaskClassifier', () => {
  let classifier;

  beforeEach(() => {
    classifier = new TaskClassifier();
  });

  describe('TaskType enum', () => {
    it('should export all task types', () => {
      expect(TaskType.CODE_GENERATION).toBe('code_generation');
      expect(TaskType.CODE_MODIFICATION).toBe('code_modification');
      expect(TaskType.BUG_FIX).toBe('bug_fix');
      expect(TaskType.REFACTORING).toBe('refactoring');
      expect(TaskType.TESTING).toBe('testing');
      expect(TaskType.DOCUMENTATION).toBe('documentation');
      expect(TaskType.RESEARCH).toBe('research');
      expect(TaskType.CONFIGURATION).toBe('configuration');
      expect(TaskType.DEPLOYMENT).toBe('deployment');
      expect(TaskType.UNKNOWN).toBe('unknown');
    });
  });

  describe('classify', () => {
    it('should classify testing tasks', () => {
      expect(classifier.classify('Write unit tests for the API')).toBe(TaskType.TESTING);
      expect(classifier.classify('Add test coverage')).toBe(TaskType.TESTING);
      expect(classifier.classify('Verify the output')).toBe(TaskType.TESTING);
    });

    it('should classify bug fix tasks', () => {
      expect(classifier.classify('Fix the login bug')).toBe(TaskType.BUG_FIX);
      expect(classifier.classify('Resolve the issue with payments')).toBe(TaskType.BUG_FIX);
      expect(classifier.classify('Patch the security error')).toBe(TaskType.BUG_FIX);
    });

    it('should classify refactoring tasks', () => {
      expect(classifier.classify('Refactor the authentication module')).toBe(TaskType.REFACTORING);
      expect(classifier.classify('Restructure the codebase')).toBe(TaskType.REFACTORING);
      expect(classifier.classify('Clean up the legacy code')).toBe(TaskType.REFACTORING);
    });

    it('should classify code generation tasks', () => {
      expect(classifier.classify('Create a new API endpoint')).toBe(TaskType.CODE_GENERATION);
      expect(classifier.classify('Implement user authentication')).toBe(TaskType.CODE_GENERATION);
      expect(classifier.classify('Build a dashboard component')).toBe(TaskType.CODE_GENERATION);
    });

    it('should classify code modification tasks', () => {
      expect(classifier.classify('Update the user profile page')).toBe(TaskType.CODE_MODIFICATION);
      expect(classifier.classify('Modify the search algorithm')).toBe(TaskType.CODE_MODIFICATION);
      expect(classifier.classify('Enhance the caching system')).toBe(TaskType.CODE_MODIFICATION);
    });

    it('should classify documentation tasks', () => {
      expect(classifier.classify('Document the API endpoints')).toBe(TaskType.DOCUMENTATION);
      expect(classifier.classify('Write README documentation')).toBe(TaskType.DOCUMENTATION);
      expect(classifier.classify('Explain how this works')).toBe(TaskType.DOCUMENTATION);
    });

    it('should classify research tasks', () => {
      expect(classifier.classify('Research the best practices')).toBe(TaskType.RESEARCH);
      expect(classifier.classify('Analyze the performance metrics')).toBe(TaskType.RESEARCH);
      expect(classifier.classify('Investigate the memory leak')).toBe(TaskType.RESEARCH);
    });

    it('should classify configuration tasks', () => {
      expect(classifier.classify('Configure the database connection')).toBe(TaskType.CONFIGURATION);
      expect(classifier.classify('Environment setup needed')).toBe(TaskType.CONFIGURATION);
      expect(classifier.classify('Config settings for production')).toBe(TaskType.CONFIGURATION);
    });

    it('should classify deployment tasks', () => {
      expect(classifier.classify('Deploy to production')).toBe(TaskType.DEPLOYMENT);
      expect(classifier.classify('Release version 2.0')).toBe(TaskType.DEPLOYMENT);
      expect(classifier.classify('Publish the package')).toBe(TaskType.DEPLOYMENT);
    });

    it('should return UNKNOWN for unrecognized tasks', () => {
      expect(classifier.classify('Do something random')).toBe(TaskType.UNKNOWN);
      expect(classifier.classify('xyz abc')).toBe(TaskType.UNKNOWN);
    });

    it('should be case insensitive', () => {
      expect(classifier.classify('FIX THE BUG')).toBe(TaskType.BUG_FIX);
      expect(classifier.classify('Write Tests')).toBe(TaskType.TESTING);
      expect(classifier.classify('REFACTOR code')).toBe(TaskType.REFACTORING);
    });
  });

  describe('getPatterns', () => {
    it('should return a copy of patterns', () => {
      const patterns = classifier.getPatterns();
      expect(patterns).toBeDefined();
      expect(patterns[TaskType.TESTING]).toBeDefined();
      expect(patterns[TaskType.BUG_FIX]).toBeDefined();
    });
  });
});
