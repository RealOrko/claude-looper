/**
 * Custom hook for step change tracking and animations
 */
import { useState, useEffect, useRef } from 'react';

export function useStepTracking(steps, stepChanges) {
  const [recentlyChanged, setRecentlyChanged] = useState(new Set());
  const [statusTransitions, setStatusTransitions] = useState([]);
  const prevStepsRef = useRef([]);

  useEffect(() => {
    // If we have stepChanges from WebSocket, use those
    if (stepChanges?.changedSteps?.length > 0) {
      setRecentlyChanged(new Set(stepChanges.changedSteps));
      setStatusTransitions(prev => [
        ...prev.slice(-20),
        ...(stepChanges.statusTransitions || []),
      ]);

      const timer = setTimeout(() => {
        setRecentlyChanged(new Set());
      }, 1500);
      return () => clearTimeout(timer);
    }

    // Fallback: detect changes locally
    const prevSteps = prevStepsRef.current;
    const changedStepNumbers = new Set();

    steps.forEach(step => {
      const prevStep = prevSteps.find(p => p.number === step.number);
      if (!prevStep || prevStep.status !== step.status) {
        changedStepNumbers.add(step.number);
      }
    });

    // Detect new steps
    steps.forEach(step => {
      const prevStep = prevSteps.find(p => p.number === step.number);
      if (!prevStep) {
        changedStepNumbers.add(step.number);
      }
    });

    if (changedStepNumbers.size > 0) {
      setRecentlyChanged(changedStepNumbers);
      const timer = setTimeout(() => {
        setRecentlyChanged(new Set());
      }, 1500);
      return () => clearTimeout(timer);
    }

    prevStepsRef.current = [...steps];
  }, [steps, stepChanges]);

  return { recentlyChanged, statusTransitions };
}
