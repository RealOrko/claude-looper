/**
 * MetricsPanel Component
 * Main component that composes all metric sections
 */
import React, { useMemo } from 'react';
import PerformanceOverview from './PerformanceOverview.jsx';
import TimeAnalysis from './TimeAnalysis.jsx';
import ComplexityAnalysis from './ComplexityAnalysis.jsx';
import RetryModeSection from './RetryModeSection.jsx';
import SupervisionSection from './SupervisionSection.jsx';
import ErrorsSection from './ErrorsSection.jsx';
import PlanSummary from './PlanSummary.jsx';
import SystemStatus from './SystemStatus.jsx';
import {
  calculateDerivedMetrics,
  calculateStepTimings,
  calculateComplexityStats,
  calculateRetryHistory,
} from './utils.js';

export default function MetricsPanel({ state }) {
  const {
    metrics, plan, errors, supervision, completedSteps, failedSteps,
    retryMode, timeElapsed, timeRemaining, timeLimit, iteration, status
  } = state;

  // Calculate derived metrics
  const derivedMetrics = useMemo(() => calculateDerivedMetrics({
    metrics, plan, errors, completedSteps, failedSteps,
    retryMode, timeElapsed, iteration, timeLimit
  }), [metrics, plan, errors, completedSteps, failedSteps, retryMode, timeElapsed, iteration, timeLimit]);

  // Step timing data for chart
  const stepTimings = useMemo(
    () => calculateStepTimings(completedSteps),
    [completedSteps]
  );

  // Complexity statistics
  const complexityStats = useMemo(
    () => calculateComplexityStats(completedSteps),
    [completedSteps]
  );

  // Retry history
  const retryHistory = useMemo(
    () => calculateRetryHistory(retryMode),
    [retryMode]
  );

  return (
    <div className="metrics-panel">
      <PerformanceOverview
        metrics={metrics}
        derivedMetrics={derivedMetrics}
        timeElapsed={timeElapsed}
        iteration={iteration}
      />

      <TimeAnalysis
        derivedMetrics={derivedMetrics}
        timeRemaining={timeRemaining}
        timeLimit={timeLimit}
        stepTimings={stepTimings}
      />

      <ComplexityAnalysis complexityStats={complexityStats} />

      <RetryModeSection
        retryMode={retryMode}
        derivedMetrics={derivedMetrics}
        retryHistory={retryHistory}
      />

      <SupervisionSection
        metrics={metrics}
        derivedMetrics={derivedMetrics}
        supervision={supervision}
      />

      <ErrorsSection
        errors={errors}
        failedSteps={failedSteps}
        derivedMetrics={derivedMetrics}
      />

      <PlanSummary plan={plan} derivedMetrics={derivedMetrics} />

      <SystemStatus status={status} state={state} metrics={metrics} />
    </div>
  );
}
