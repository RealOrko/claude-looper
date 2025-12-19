/**
 * Main Loop - handles the core execution loop for autonomous running
 */

export class MainLoop {
  constructor(runner) {
    this.runner = runner;
  }

  /** Execute the main iteration loop */
  async execute() {
    const r = this.runner;
    let goalAchievementCycles = 0;
    const maxGoalCycles = 10;
    let finalVerification = null;

    while (!r.shouldStop && !r.phaseManager.isTimeExpired()) {
      r.consecutiveAbortErrors = 0;
      while (!r.shouldStop && !r.phaseManager.isTimeExpired() && !r.planner.isComplete()) {
        await r.iterationHandler.executeIteration();
      }
      if (r.shouldStop || r.phaseManager.isTimeExpired()) break;

      goalAchievementCycles++;
      if (goalAchievementCycles > maxGoalCycles) {
        r.onProgress({ type: 'max_retry_cycles_reached', cycles: goalAchievementCycles, message: 'Max goal achievement cycles reached' });
        break;
      }

      const cycleVerification = await r.verificationHandler.verifyGoalAchievement(goalAchievementCycles);
      finalVerification = cycleVerification;
      if (cycleVerification?.overallPassed) break;

      if (!r.phaseManager.isTimeExpired() && !r.shouldStop) {
        await r.planManager.createGapPlan(goalAchievementCycles, cycleVerification);
      }
    }
    return finalVerification;
  }

  /** Handle time expiration */
  async handleTimeExpiration() {
    const r = this.runner;
    if (r.phaseManager.isTimeExpired() && !r.shouldStop) {
      try {
        const result = await r.client.continueConversation('TIME EXPIRED. Summarize what was accomplished and list incomplete tasks.');
        if (result.tokensIn || result.tokensOut) {
          r.contextManager.trackTokenUsage(result.tokensIn || 0, result.tokensOut || 0);
        }
      } catch (e) { /* ignore */ }
    }
  }
}

export default MainLoop;
