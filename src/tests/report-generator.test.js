import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ReportGenerator } from '../report-generator.js';

describe('ReportGenerator', () => {
  let generator;
  let mockRunner;

  beforeEach(() => {
    mockRunner = {
      abortReason: null,
      finalSummary: { summary: 'Test completed' },
      verificationFailures: 0,
      iterationCount: 10,
      phaseManager: {
        getTimeStatus: vi.fn().mockReturnValue({
          elapsed: 30000,
          isExpired: false,
          percentTimeUsed: 50,
        }),
        getStatusReport: vi.fn().mockReturnValue({
          phases: [],
          checkpoints: [],
        }),
        formatDuration: vi.fn().mockReturnValue('5m'),
        timeLimit: 300000,
      },
      goalTracker: {
        isComplete: vi.fn().mockReturnValue(false),
        getProgressSummary: vi.fn().mockReturnValue({ overallProgress: 50 }),
        primaryGoal: 'Build application',
        subGoals: ['Setup', 'Build', 'Test'],
        completedMilestones: ['Setup complete'],
      },
      planner: {
        getProgress: vi.fn().mockReturnValue({
          completed: 3,
          failed: 1,
          percentComplete: 60,
          current: 4,
          total: 5,
        }),
        isComplete: vi.fn().mockReturnValue(false),
        plan: {
          analysis: 'Plan analysis',
          steps: [{ number: 1 }, { number: 2 }],
          totalSteps: 5,
        },
      },
      supervisor: {
        getStats: vi.fn().mockReturnValue({ totalDecisions: 5 }),
      },
      verifier: {
        getStats: vi.fn().mockReturnValue({ passed: 3, failed: 1 }),
      },
      config: {
        get: vi.fn().mockReturnValue({ enabled: true }),
      },
      contextManager: {
        getCacheStats: vi.fn().mockReturnValue({ hits: 10, misses: 5 }),
        getTokenStats: vi.fn().mockReturnValue({ total: 5000 }),
      },
      client: {
        getSessionId: vi.fn().mockReturnValue('session-123'),
        getHistory: vi.fn().mockReturnValue([1, 2, 3, 4, 5]),
        getMetrics: vi.fn().mockReturnValue({ calls: 10 }),
      },
      supervisorClient: {
        getMetrics: vi.fn().mockReturnValue({ calls: 5 }),
      },
      plannerClient: {
        getMetrics: vi.fn().mockReturnValue({ calls: 2 }),
      },
      metrics: {
        getSummary: vi.fn().mockReturnValue({ total: 100 }),
        getTrends: vi.fn().mockReturnValue([]),
      },
    };
    generator = new ReportGenerator(mockRunner);
  });

  describe('constructor', () => {
    it('should store runner reference', () => {
      expect(generator.runner).toBe(mockRunner);
    });
  });

  describe('generate', () => {
    it('should generate complete report structure', () => {
      const report = generator.generate();

      expect(report).toHaveProperty('status');
      expect(report).toHaveProperty('abortReason');
      expect(report).toHaveProperty('summary');
      expect(report).toHaveProperty('goal');
      expect(report).toHaveProperty('plan');
      expect(report).toHaveProperty('time');
      expect(report).toHaveProperty('session');
      expect(report).toHaveProperty('supervision');
      expect(report).toHaveProperty('verification');
      expect(report).toHaveProperty('finalVerification');
      expect(report).toHaveProperty('phases');
      expect(report).toHaveProperty('checkpoints');
      expect(report).toHaveProperty('cacheStats');
      expect(report).toHaveProperty('tokenStats');
      expect(report).toHaveProperty('clientMetrics');
      expect(report).toHaveProperty('performanceMetrics');
      expect(report).toHaveProperty('performanceTrends');
    });

    it('should include final verification when provided', () => {
      const finalVerification = {
        goalVerification: { achieved: true, confidence: 0.9 },
        overallPassed: true,
      };

      const report = generator.generate(finalVerification);

      expect(report.finalVerification).not.toBeNull();
      expect(report.finalVerification.goalAchieved).toBe(true);
    });

    it('should set finalVerification to null when not provided', () => {
      const report = generator.generate();

      expect(report.finalVerification).toBeNull();
    });
  });

  describe('determineStatus', () => {
    it('should return aborted when abort reason exists', () => {
      mockRunner.abortReason = 'User cancelled';

      const status = generator.determineStatus(null, {});

      expect(status).toBe('aborted');
    });

    it('should return completed when planner is complete and verification passed', () => {
      mockRunner.planner.isComplete.mockReturnValue(true);

      const status = generator.determineStatus({ overallPassed: true }, {});

      expect(status).toBe('completed');
    });

    it('should return verification_failed when planner complete but verification failed', () => {
      mockRunner.planner.isComplete.mockReturnValue(true);

      const status = generator.determineStatus({ overallPassed: false }, {});

      expect(status).toBe('verification_failed');
    });

    it('should return completed when goal tracker is complete', () => {
      mockRunner.planner.isComplete.mockReturnValue(false);
      mockRunner.goalTracker.isComplete.mockReturnValue(true);

      const status = generator.determineStatus(null, {});

      expect(status).toBe('completed');
    });

    it('should return time_expired when time is expired', () => {
      mockRunner.planner.isComplete.mockReturnValue(false);
      mockRunner.goalTracker.isComplete.mockReturnValue(false);

      const status = generator.determineStatus(null, { isExpired: true });

      expect(status).toBe('time_expired');
    });

    it('should return stopped as default', () => {
      mockRunner.planner.isComplete.mockReturnValue(false);
      mockRunner.goalTracker.isComplete.mockReturnValue(false);

      const status = generator.determineStatus(null, { isExpired: false });

      expect(status).toBe('stopped');
    });
  });

  describe('buildGoalSection', () => {
    it('should build goal section with all fields', () => {
      const planProgress = { percentComplete: 75 };
      const progressSummary = { overallProgress: 60 };

      const result = generator.buildGoalSection(planProgress, progressSummary);

      expect(result).toEqual({
        primary: 'Build application',
        subGoals: ['Setup', 'Build', 'Test'],
        progress: 75,
        milestones: ['Setup complete'],
      });
    });

    it('should use progressSummary when planProgress is null', () => {
      const progressSummary = { overallProgress: 40 };

      const result = generator.buildGoalSection(null, progressSummary);

      expect(result.progress).toBe(40);
    });

    it('should use progressSummary when planProgress has no percentComplete', () => {
      const progressSummary = { overallProgress: 30 };

      const result = generator.buildGoalSection({}, progressSummary);

      expect(result.progress).toBe(30);
    });
  });

  describe('buildPlanSection', () => {
    it('should return null when planner has no plan', () => {
      mockRunner.planner = null;

      const result = generator.buildPlanSection({});

      expect(result).toBeNull();
    });

    it('should return null when plan is undefined', () => {
      mockRunner.planner.plan = undefined;

      const result = generator.buildPlanSection({});

      expect(result).toBeNull();
    });

    it('should build plan section with all fields', () => {
      const planProgress = { completed: 4, failed: 1 };

      const result = generator.buildPlanSection(planProgress);

      expect(result).toEqual({
        analysis: 'Plan analysis',
        steps: [{ number: 1 }, { number: 2 }],
        totalSteps: 5,
        completed: 4,
        failed: 1,
      });
    });

    it('should default to 0 for missing progress values', () => {
      const result = generator.buildPlanSection({});

      expect(result.completed).toBe(0);
      expect(result.failed).toBe(0);
    });
  });

  describe('buildTimeSection', () => {
    it('should build time section correctly', () => {
      const timeStatus = { elapsed: 60000, percentTimeUsed: 75 };

      const result = generator.buildTimeSection(timeStatus);

      expect(result).toEqual({
        elapsed: 60000,
        limit: '5m',
        percentUsed: 75,
      });
    });
  });

  describe('buildSessionSection', () => {
    it('should build session section correctly', () => {
      const result = generator.buildSessionSection();

      expect(result).toEqual({
        id: 'session-123',
        iterations: 10,
        messageCount: 5,
      });
    });
  });

  describe('buildVerificationSection', () => {
    it('should build verification section when enabled', () => {
      mockRunner.finalSummary = { verified: true };
      mockRunner.verificationFailures = 2;

      const result = generator.buildVerificationSection();

      expect(result).toEqual({
        enabled: true,
        failures: 2,
        stats: { passed: 3, failed: 1 },
        finalStatus: 'verified',
      });
    });

    it('should show unverified when not verified', () => {
      mockRunner.finalSummary = { verified: false };

      const result = generator.buildVerificationSection();

      expect(result.finalStatus).toBe('unverified');
    });

    it('should handle disabled verification', () => {
      mockRunner.config.get.mockReturnValue({ enabled: false });

      const result = generator.buildVerificationSection();

      expect(result.enabled).toBe(false);
    });

    it('should handle null verifier', () => {
      mockRunner.verifier = null;

      const result = generator.buildVerificationSection();

      expect(result.stats).toBeNull();
    });
  });

  describe('buildFinalVerificationSection', () => {
    it('should return null when no final verification', () => {
      const result = generator.buildFinalVerificationSection(null);

      expect(result).toBeNull();
    });

    it('should build final verification section with all fields', () => {
      const finalVerification = {
        goalVerification: {
          achieved: true,
          confidence: 0.95,
          functional: true,
          recommendation: 'Deploy',
          gaps: 'None',
        },
        overallPassed: true,
      };

      const result = generator.buildFinalVerificationSection(finalVerification);

      expect(result).toEqual({
        goalAchieved: true,
        confidence: 0.95,
        functional: true,
        recommendation: 'Deploy',
        gaps: 'None',
        overallPassed: true,
      });
    });

    it('should handle missing goalVerification fields', () => {
      const finalVerification = {
        goalVerification: {},
        overallPassed: false,
      };

      const result = generator.buildFinalVerificationSection(finalVerification);

      expect(result.goalAchieved).toBeUndefined();
      expect(result.overallPassed).toBe(false);
    });
  });

  describe('getClientMetrics', () => {
    it('should get metrics from all clients', () => {
      const result = generator.getClientMetrics();

      expect(result).toEqual({
        worker: { calls: 10 },
        supervisor: { calls: 5 },
        planner: { calls: 2 },
      });
    });

    it('should handle null supervisor client', () => {
      mockRunner.supervisorClient = null;

      const result = generator.getClientMetrics();

      expect(result.supervisor).toBeNull();
    });

    it('should handle null planner client', () => {
      mockRunner.plannerClient = null;

      const result = generator.getClientMetrics();

      expect(result.planner).toBeNull();
    });
  });
});
