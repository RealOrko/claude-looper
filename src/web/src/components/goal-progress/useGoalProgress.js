/**
 * Custom hook for goal progress calculations and state
 */
import { useMemo, useState } from 'react';
import { confidenceLevels } from './icons.js';
import { calculateStepBreakdown, calculateComplexityBreakdown } from './utils.js';

export function useGoalProgress(state) {
  const {
    plan, verification, completedSteps, failedSteps, progress,
    timeElapsed, timeRemaining, stepChanges, confidenceHistory, finalReport,
  } = state;

  const [expandedSections, setExpandedSections] = useState(new Set(['progress', 'confidence']));
  const [showAllIterations, setShowAllIterations] = useState(false);

  const toggleSection = (section) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(section)) {
        next.delete(section);
      } else {
        next.add(section);
      }
      return next;
    });
  };

  // Calculate overall progress
  const totalSteps = plan?.steps?.length || 0;
  const completed = completedSteps?.length || 0;
  const failed = failedSteps?.length || 0;
  const progressPercent = totalSteps > 0 ? Math.round((completed / totalSteps) * 100) : (progress || 0);

  // Determine confidence level from verification or estimate
  const confidence = useMemo(() => {
    if (verification?.goal?.confidence) return verification.goal.confidence;
    if (verification?.confidence) return verification.confidence;
    if (finalReport?.finalVerification?.confidence) return finalReport.finalVerification.confidence;
    // Estimate based on progress and failures
    if (completed > 0 && failed === 0 && progressPercent >= 80) return 'HIGH';
    if (progressPercent >= 50 || (completed > failed)) return 'MEDIUM';
    if (failed > completed) return 'LOW';
    return 'UNKNOWN';
  }, [verification, finalReport, completed, failed, progressPercent]);

  const confidenceConfig = confidenceLevels[confidence] || confidenceLevels.UNKNOWN;

  // Calculate time info
  const elapsedMs = timeElapsed || 0;
  const remainingMs = timeRemaining || 0;
  const totalTimeMs = elapsedMs + remainingMs;
  const timePercent = totalTimeMs > 0 ? Math.round((elapsedMs / totalTimeMs) * 100) : 0;

  // Step breakdowns
  const stepBreakdown = useMemo(() => calculateStepBreakdown(plan), [plan]);
  const complexityBreakdown = useMemo(() => calculateComplexityBreakdown(plan), [plan]);

  // Recent status transitions
  const recentTransitions = useMemo(() => {
    const transitions = stepChanges?.statusTransitions || [];
    return transitions.slice(-5).reverse();
  }, [stepChanges]);

  // Confidence trend (up, down, stable)
  const confidenceTrend = useMemo(() => {
    if (confidenceHistory?.length < 2) return 'stable';
    const recent = confidenceHistory.slice(-2);
    const prev = confidenceLevels[recent[0]]?.value || 0;
    const curr = confidenceLevels[recent[1]]?.value || 0;
    if (curr > prev) return 'up';
    if (curr < prev) return 'down';
    return 'stable';
  }, [confidenceHistory]);

  return {
    expandedSections, toggleSection, showAllIterations, setShowAllIterations,
    totalSteps, completed, failed, progressPercent,
    confidence, confidenceConfig, confidenceTrend,
    elapsedMs, remainingMs, timePercent,
    stepBreakdown, complexityBreakdown, recentTransitions,
  };
}
