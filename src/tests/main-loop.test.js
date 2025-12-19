import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MainLoop } from '../main-loop.js';

describe('MainLoop', () => {
  let loop;
  let mockRunner;

  beforeEach(() => {
    mockRunner = {
      shouldStop: false,
      consecutiveAbortErrors: 5,
      phaseManager: {
        isTimeExpired: vi.fn().mockReturnValue(false),
      },
      planner: {
        isComplete: vi.fn().mockReturnValue(false),
      },
      iterationHandler: {
        executeIteration: vi.fn().mockResolvedValue(undefined),
      },
      verificationHandler: {
        verifyGoalAchievement: vi.fn().mockResolvedValue(null),
      },
      planManager: {
        createGapPlan: vi.fn().mockResolvedValue(undefined),
      },
      client: {
        continueConversation: vi.fn().mockResolvedValue({}),
      },
      contextManager: {
        trackTokenUsage: vi.fn(),
      },
      onProgress: vi.fn(),
    };
    loop = new MainLoop(mockRunner);
  });

  describe('constructor', () => {
    it('should store runner reference', () => {
      expect(loop.runner).toBe(mockRunner);
    });
  });

  describe('execute', () => {
    it('should reset consecutiveAbortErrors on each outer loop iteration', async () => {
      // Need to enter the while loop and execute at least one iteration
      let iterationCount = 0;
      mockRunner.iterationHandler.executeIteration.mockImplementation(async () => {
        iterationCount++;
        if (iterationCount >= 1) {
          mockRunner.planner.isComplete.mockReturnValue(true);
        }
      });
      mockRunner.verificationHandler.verifyGoalAchievement.mockResolvedValue({ overallPassed: true });

      await loop.execute();

      expect(mockRunner.consecutiveAbortErrors).toBe(0);
    });

    it('should stop when shouldStop is true', async () => {
      mockRunner.shouldStop = true;

      await loop.execute();

      expect(mockRunner.iterationHandler.executeIteration).not.toHaveBeenCalled();
    });

    it('should stop when time is expired', async () => {
      mockRunner.phaseManager.isTimeExpired.mockReturnValue(true);

      await loop.execute();

      expect(mockRunner.iterationHandler.executeIteration).not.toHaveBeenCalled();
    });

    it('should execute iterations until plan complete', async () => {
      let iterationCount = 0;
      mockRunner.iterationHandler.executeIteration.mockImplementation(async () => {
        iterationCount++;
        if (iterationCount >= 3) {
          mockRunner.planner.isComplete.mockReturnValue(true);
        }
      });
      mockRunner.verificationHandler.verifyGoalAchievement.mockResolvedValue({ overallPassed: true });

      await loop.execute();

      expect(iterationCount).toBe(3);
    });

    it('should break inner loop when shouldStop becomes true', async () => {
      let iterationCount = 0;
      mockRunner.iterationHandler.executeIteration.mockImplementation(async () => {
        iterationCount++;
        if (iterationCount >= 2) {
          mockRunner.shouldStop = true;
        }
      });

      await loop.execute();

      expect(iterationCount).toBe(2);
    });

    it('should break inner loop when time expires', async () => {
      let iterationCount = 0;
      mockRunner.iterationHandler.executeIteration.mockImplementation(async () => {
        iterationCount++;
        if (iterationCount >= 2) {
          mockRunner.phaseManager.isTimeExpired.mockReturnValue(true);
        }
      });

      await loop.execute();

      expect(iterationCount).toBe(2);
    });

    it('should verify goal achievement after plan completes', async () => {
      mockRunner.planner.isComplete.mockReturnValue(true);
      mockRunner.verificationHandler.verifyGoalAchievement.mockResolvedValue({ overallPassed: true });

      await loop.execute();

      expect(mockRunner.verificationHandler.verifyGoalAchievement).toHaveBeenCalledWith(1);
    });

    it('should break when verification passes', async () => {
      mockRunner.planner.isComplete.mockReturnValue(true);
      mockRunner.verificationHandler.verifyGoalAchievement.mockResolvedValue({ overallPassed: true });

      const result = await loop.execute();

      expect(result.overallPassed).toBe(true);
      expect(mockRunner.planManager.createGapPlan).not.toHaveBeenCalled();
    });

    it('should create gap plan when verification fails', async () => {
      let verifyCount = 0;
      mockRunner.planner.isComplete.mockReturnValue(true);
      mockRunner.verificationHandler.verifyGoalAchievement.mockImplementation(async () => {
        verifyCount++;
        if (verifyCount >= 2) {
          return { overallPassed: true };
        }
        return { overallPassed: false };
      });
      mockRunner.planManager.createGapPlan.mockImplementation(async () => {
        mockRunner.planner.isComplete.mockReturnValue(true);
      });

      await loop.execute();

      expect(mockRunner.planManager.createGapPlan).toHaveBeenCalledWith(1, { overallPassed: false });
    });

    it('should increment goal achievement cycles', async () => {
      let cycles = [];
      mockRunner.planner.isComplete.mockReturnValue(true);
      mockRunner.verificationHandler.verifyGoalAchievement.mockImplementation(async (cycle) => {
        cycles.push(cycle);
        if (cycle >= 3) {
          return { overallPassed: true };
        }
        return { overallPassed: false };
      });
      mockRunner.planManager.createGapPlan.mockResolvedValue(undefined);

      await loop.execute();

      expect(cycles).toEqual([1, 2, 3]);
    });

    it('should stop after max 10 goal achievement cycles', async () => {
      mockRunner.planner.isComplete.mockReturnValue(true);
      mockRunner.verificationHandler.verifyGoalAchievement.mockResolvedValue({ overallPassed: false });
      mockRunner.planManager.createGapPlan.mockResolvedValue(undefined);

      await loop.execute();

      expect(mockRunner.onProgress).toHaveBeenCalledWith({
        type: 'max_retry_cycles_reached',
        cycles: 11,
        message: 'Max goal achievement cycles reached',
      });
    });

    it('should not create gap plan when time expired', async () => {
      let firstCall = true;
      mockRunner.planner.isComplete.mockReturnValue(true);
      mockRunner.verificationHandler.verifyGoalAchievement.mockImplementation(async () => {
        if (firstCall) {
          firstCall = false;
          mockRunner.phaseManager.isTimeExpired.mockReturnValue(true);
          return { overallPassed: false };
        }
        return { overallPassed: true };
      });

      await loop.execute();

      expect(mockRunner.planManager.createGapPlan).not.toHaveBeenCalled();
    });

    it('should not create gap plan when shouldStop is true', async () => {
      let firstCall = true;
      mockRunner.planner.isComplete.mockReturnValue(true);
      mockRunner.verificationHandler.verifyGoalAchievement.mockImplementation(async () => {
        if (firstCall) {
          firstCall = false;
          mockRunner.shouldStop = true;
          return { overallPassed: false };
        }
        return { overallPassed: true };
      });

      await loop.execute();

      expect(mockRunner.planManager.createGapPlan).not.toHaveBeenCalled();
    });

    it('should return final verification result', async () => {
      mockRunner.planner.isComplete.mockReturnValue(true);
      const verificationResult = { overallPassed: true, goalVerification: { achieved: true } };
      mockRunner.verificationHandler.verifyGoalAchievement.mockResolvedValue(verificationResult);

      const result = await loop.execute();

      expect(result).toEqual(verificationResult);
    });

    it('should return null when no verification performed', async () => {
      mockRunner.shouldStop = true;

      const result = await loop.execute();

      expect(result).toBeNull();
    });
  });

  describe('handleTimeExpiration', () => {
    it('should request summary when time expired and not stopped', async () => {
      mockRunner.phaseManager.isTimeExpired.mockReturnValue(true);
      mockRunner.shouldStop = false;

      await loop.handleTimeExpiration();

      expect(mockRunner.client.continueConversation).toHaveBeenCalledWith(
        'TIME EXPIRED. Summarize what was accomplished and list incomplete tasks.'
      );
    });

    it('should not request summary when shouldStop is true', async () => {
      mockRunner.phaseManager.isTimeExpired.mockReturnValue(true);
      mockRunner.shouldStop = true;

      await loop.handleTimeExpiration();

      expect(mockRunner.client.continueConversation).not.toHaveBeenCalled();
    });

    it('should not request summary when time not expired', async () => {
      mockRunner.phaseManager.isTimeExpired.mockReturnValue(false);
      mockRunner.shouldStop = false;

      await loop.handleTimeExpiration();

      expect(mockRunner.client.continueConversation).not.toHaveBeenCalled();
    });

    it('should track token usage from response', async () => {
      mockRunner.phaseManager.isTimeExpired.mockReturnValue(true);
      mockRunner.shouldStop = false;
      mockRunner.client.continueConversation.mockResolvedValue({ tokensIn: 100, tokensOut: 200 });

      await loop.handleTimeExpiration();

      expect(mockRunner.contextManager.trackTokenUsage).toHaveBeenCalledWith(100, 200);
    });

    it('should handle errors gracefully', async () => {
      mockRunner.phaseManager.isTimeExpired.mockReturnValue(true);
      mockRunner.shouldStop = false;
      mockRunner.client.continueConversation.mockRejectedValue(new Error('Network error'));

      // Should not throw
      await expect(loop.handleTimeExpiration()).resolves.not.toThrow();
    });

    it('should track zero tokens when not provided', async () => {
      mockRunner.phaseManager.isTimeExpired.mockReturnValue(true);
      mockRunner.shouldStop = false;
      mockRunner.client.continueConversation.mockResolvedValue({});

      await loop.handleTimeExpiration();

      expect(mockRunner.contextManager.trackTokenUsage).not.toHaveBeenCalled();
    });
  });
});
