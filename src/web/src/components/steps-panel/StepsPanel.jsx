/**
 * StepsPanel Component
 * Main component that displays steps in DAG or list view
 */
import React, { useState, useCallback } from 'react';
import { Circle } from 'lucide-react';
import DAGVisualization from '../DAGVisualization';
import StepDetailView from '../StepDetailView';
import StepsSummary from './StepsSummary.jsx';
import StepListItem from './StepListItem.jsx';
import StepsTimeline from './StepsTimeline.jsx';
import { useDagLayout } from './useDagLayout.js';
import { useStepTracking } from './useStepTracking.js';
import { calculateStepStats } from './utils.js';

export default function StepsPanel({ state, logs = [], retryHistory = [] }) {
  const { plan, currentStep, stepChanges } = state;
  const steps = plan?.steps || [];

  const [expandedSteps, setExpandedSteps] = useState(new Set());
  const [viewMode, setViewMode] = useState('dag');
  const [selectedStep, setSelectedStep] = useState(null);

  // Custom hooks
  const dagLayout = useDagLayout(steps);
  const { recentlyChanged, statusTransitions } = useStepTracking(steps, stepChanges);

  // Calculate stats
  const { completed, failed, inProgress, pending } = calculateStepStats(steps);

  // Event handlers
  const handleStepClick = useCallback((step) => {
    setSelectedStep(step);
  }, []);

  const handleCloseDetail = useCallback(() => {
    setSelectedStep(null);
  }, []);

  const toggleStep = useCallback((stepNumber) => {
    setExpandedSteps(prev => {
      const next = new Set(prev);
      if (next.has(stepNumber)) {
        next.delete(stepNumber);
      } else {
        next.add(stepNumber);
      }
      return next;
    });
  }, []);

  if (steps.length === 0) {
    return (
      <div className="steps-panel empty">
        <div className="empty-state">
          <Circle size={48} className="empty-icon" />
          <h3>No Plan Yet</h3>
          <p>Steps will appear here once a plan is created.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="steps-panel">
      <StepsSummary
        steps={steps}
        completed={completed}
        inProgress={inProgress}
        pending={pending}
        failed={failed}
        viewMode={viewMode}
        setViewMode={setViewMode}
      />

      {viewMode === 'dag' && (
        <DAGVisualization
          nodes={dagLayout.nodes}
          edges={dagLayout.edges}
          width={dagLayout.width}
          height={dagLayout.height}
          currentStep={currentStep}
          recentlyChanged={recentlyChanged}
          statusTransitions={statusTransitions}
          onNodeClick={handleStepClick}
        />
      )}

      {viewMode === 'list' && (
        <div className="steps-list">
          {steps.map((step, index) => (
            <StepListItem
              key={step.number || index}
              step={step}
              index={index}
              isExpanded={expandedSteps.has(step.number)}
              hasChanged={recentlyChanged.has(step.number)}
              onToggle={toggleStep}
              onDetailClick={handleStepClick}
            />
          ))}
        </div>
      )}

      <StepsTimeline
        steps={steps}
        recentlyChanged={recentlyChanged}
        onStepClick={handleStepClick}
      />

      {selectedStep && (
        <StepDetailView
          step={selectedStep}
          onClose={handleCloseDetail}
          logs={logs}
          retryHistory={retryHistory}
        />
      )}
    </div>
  );
}
