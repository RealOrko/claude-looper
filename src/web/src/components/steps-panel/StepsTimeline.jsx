/**
 * StepsTimeline Component
 * Visual timeline of step statuses
 */
import React from 'react';
import { statusColors } from './constants.js';

export default function StepsTimeline({ steps, recentlyChanged, onStepClick }) {
  return (
    <div className="steps-timeline">
      <h3>Timeline</h3>
      <div className="timeline">
        {steps.map((step, index) => {
          const colorClass = statusColors[step.status] || 'pending';
          const hasChanged = recentlyChanged.has(step.number);
          return (
            <div
              key={step.number || index}
              className={`timeline-item ${colorClass} ${hasChanged ? 'pulse' : ''}`}
              title={`Step ${step.number}: ${step.description}`}
              onClick={() => onStepClick(step)}
              style={{ cursor: 'pointer' }}
            >
              <div className="timeline-marker" />
            </div>
          );
        })}
      </div>
    </div>
  );
}
