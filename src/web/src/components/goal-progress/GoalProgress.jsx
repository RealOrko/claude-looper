/**
 * Goal Progress Component
 * Main component that composes all goal progress sub-components
 */
import React from 'react';
import GoalStatusSection from './GoalStatusSection.jsx';
import ProgressOverview from './ProgressOverview.jsx';
import StepBreakdownSection from './StepBreakdownSection.jsx';
import ConfidenceSection from './ConfidenceSection.jsx';
import TimeSection from './TimeSection.jsx';
import IterationsSection from './IterationsSection.jsx';
import FinalReportSection from './FinalReportSection.jsx';
import { useGoalProgress } from './useGoalProgress.js';

export default function GoalProgress({ state }) {
  const {
    goal, subGoals, status, iteration, verification,
    timeLimit, retryMode, finalReport, metrics,
  } = state;

  const {
    expandedSections, toggleSection,
    totalSteps, completed, failed, progressPercent,
    confidence, confidenceConfig, confidenceTrend,
    elapsedMs, remainingMs, timePercent,
    stepBreakdown, complexityBreakdown, recentTransitions,
  } = useGoalProgress(state);

  return (
    <div className="goal-progress">
      <GoalStatusSection
        goal={goal}
        subGoals={subGoals}
        status={status}
        iteration={iteration}
      />

      <ProgressOverview
        progressPercent={progressPercent}
        completed={completed}
        failed={failed}
        totalSteps={totalSteps}
        iteration={iteration}
        elapsedMs={elapsedMs}
      />

      <StepBreakdownSection
        totalSteps={totalSteps}
        stepBreakdown={stepBreakdown}
        complexityBreakdown={complexityBreakdown}
        recentTransitions={recentTransitions}
        isExpanded={expandedSections.has('breakdown')}
        onToggle={() => toggleSection('breakdown')}
      />

      <ConfidenceSection
        confidence={confidence}
        confidenceConfig={confidenceConfig}
        confidenceTrend={confidenceTrend}
        verification={verification}
      />

      <TimeSection
        elapsedMs={elapsedMs}
        remainingMs={remainingMs}
        timePercent={timePercent}
        timeLimit={timeLimit}
      />

      <IterationsSection
        iteration={iteration}
        elapsedMs={elapsedMs}
        retryMode={retryMode}
        metrics={metrics}
      />

      <FinalReportSection finalReport={finalReport} />
    </div>
  );
}
